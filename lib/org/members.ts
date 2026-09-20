import 'server-only'

import { randomUUID } from 'node:crypto'

import type { Database, Queryable } from '@/lib/crm/database'
import { CrmError } from '@/lib/crm/errors'
import type {
  ColleagueId,
  MemberRole,
  MemberStatus,
  Organization,
  OrganizationMember,
  Viewer,
  Workspace,
} from '@/lib/types'

/**
 * Who belongs to an organization.
 *
 * Every function here takes the organization explicitly and never trusts a
 * member id on its own: a member row is only ever read or changed *within*
 * the organization the caller's context names. Session, connection and
 * pending-code revocation live here too, because revoking a membership
 * without cutting everything that acts as that member would leave a person
 * with access the roster says they no longer have.
 *
 * TWO INVARIANTS, AND THE LOCKS THAT KEEP THEM.
 *
 *   - An organization always has at least one active owner. Counting owners
 *     and then changing one is a race between two owners acting at once; both
 *     could count two and each remove the other. Every writer that touches
 *     owner state first takes the organization's advisory lock, so the count
 *     and the change happen inside one serialized step.
 *   - An account is administered by one organization at a time. One Supabase
 *     Auth login serves every organization a person belongs to, while an
 *     owner's authority stops at their own roster — so attaching an account
 *     or replacing its password is only allowed while the caller's
 *     organization is the account's sole active home. Two organizations
 *     checking that at the same moment could both pass; every writer that
 *     administers an account first takes the account's advisory lock.
 *
 * Lock order is organization advisory lock, then account advisory lock,
 * then row locks — everywhere in this module, in the MCP token exchange and
 * revocation (lib/mcp/oauth.ts) and in the tool commit (lib/crm/service.ts).
 * Row locks last matters as much as the two advisory locks: a writer holding
 * a membership row for update while waiting for the account lock would
 * deadlock against the token exchange, which holds the account lock while
 * its connection insert needs that membership row. So every writer that
 * needs an account lock learns the account from a plain read first, takes
 * the locks, and only then re-reads its rows for update and revalidates
 * every condition — a row can have changed while the lock was waited for.
 *
 * CREDENTIAL GENERATION. Wallpaper links, OAuth codes and MCP connections all
 * record `organization_members.credential_generation` when they are minted,
 * and are refused once it no longer matches. Revoking, reactivating and
 * resetting a password each rotate it, so a credential from before any of
 * those cannot come back to life when the same membership row is active
 * again. Sessions are plain rows and are simply revoked.
 */

type MemberRow = {
  id: string
  user_id: string
  role: MemberRole
  status: MemberStatus
  email: string
  display_name: string
  colleague: ColleagueId | null
  created_at: string
  revoked_at: string | null
}

function fromMemberRow(row: MemberRow): OrganizationMember {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    email: row.email,
    displayName: row.display_name,
    ...(row.colleague ? { colleague: row.colleague } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.revoked_at ? { revokedAt: new Date(row.revoked_at).toISOString() } : {}),
  }
}

const MEMBER_COLUMNS =
  'id, user_id, role, status, email, display_name, colleague, created_at::text as created_at, revoked_at::text as revoked_at'

/* ———— locks ———— */

/** Serializes every change to an organization's roster. Take before lockAccount. */
export async function lockOrganization(db: Queryable, organizationId: string): Promise<void> {
  await db.query('select pg_advisory_xact_lock(hashtext($1))', [`khyte:org:${organizationId}`])
}

/** Serializes every administration of one account, across organizations. */
export async function lockAccount(db: Queryable, userId: string): Promise<void> {
  await db.query('select pg_advisory_xact_lock(hashtext($1))', [`khyte:user:${userId}`])
}

/* ———— reads ———— */

/** Every membership of the organization, active and revoked, owners first. */
export async function listMembers(db: Queryable, organizationId: string): Promise<OrganizationMember[]> {
  const rows = await db.query<MemberRow>(
    `select ${MEMBER_COLUMNS} from organization_members
     where organization_id = $1
     order by status = 'active' desc, role = 'owner' desc, created_at asc`,
    [organizationId]
  )
  return rows.map(fromMemberRow)
}

/** The organization, the viewer and the roster — what the chrome renders. */
export async function loadWorkspace(
  db: Queryable,
  context: { organization: Organization; viewer: Viewer }
): Promise<Workspace> {
  return {
    organization: context.organization,
    viewer: context.viewer,
    members: await listMembers(db, context.organization.id),
  }
}

/** The active membership of one account in one organization, if any. */
export async function findActiveMembership(
  db: Queryable,
  organizationId: string,
  userId: string
): Promise<OrganizationMember | null> {
  const [row] = await db.query<MemberRow>(
    `select ${MEMBER_COLUMNS} from organization_members
     where organization_id = $1 and user_id = $2 and status = 'active'`,
    [organizationId, userId]
  )
  return row ? fromMemberRow(row) : null
}

/** One active member of the organization, for owner-only account operations. */
export async function findActiveMember(
  db: Queryable,
  organizationId: string,
  memberId: string
): Promise<OrganizationMember | null> {
  const [row] = await db.query<MemberRow>(
    `select ${MEMBER_COLUMNS} from organization_members
     where id = $1 and organization_id = $2 and status = 'active'`,
    [memberId, organizationId]
  )
  return row ? fromMemberRow(row) : null
}

/**
 * Whether the account is an active member of any organization but this one
 * — the question every account administration asks under the account lock.
 */
export async function hasActiveMembershipElsewhere(
  db: Queryable,
  userId: string,
  organizationId: string
): Promise<boolean> {
  const [row] = await db.query<{ id: string }>(
    `select id from organization_members
     where user_id = $1 and organization_id <> $2 and status = 'active' limit 1`,
    [userId, organizationId]
  )
  return Boolean(row)
}

/**
 * The checks a membership write will make, run ahead of creating an account
 * so a refusal leaves nothing behind. The write repeats them under its locks;
 * this is the early answer, not the guard.
 */
export async function assertCanAddMember(
  db: Queryable,
  input: { organizationId: string; userId: string | null; colleague: ColleagueId | null }
): Promise<void> {
  if (input.userId) {
    const [existing] = await db.query<{ status: MemberStatus }>(
      'select status from organization_members where organization_id = $1 and user_id = $2',
      [input.organizationId, input.userId]
    )
    if (existing?.status === 'active') {
      throw new CrmError('already_member', 'This account is already a member of the organization.')
    }
  }
  if (input.colleague) {
    const [taken] = await db.query<{ user_id: string }>(
      `select user_id from organization_members
       where organization_id = $1 and colleague = $2 and status = 'active'`,
      [input.organizationId, input.colleague]
    )
    if (taken && taken.user_id !== input.userId) {
      throw new CrmError('colleague_taken', 'Another active member already carries that roster label.')
    }
  }
}

/** Active memberships of one account, oldest first — for choosing a
 *  workspace at login. */
export async function listMembershipsForUser(
  db: Queryable,
  userId: string
): Promise<Array<{ organizationId: string; organizationName: string; role: MemberRole }>> {
  const rows = await db.query<{ organization_id: string; name: string; role: MemberRole }>(
    `select m.organization_id, o.name, m.role
     from organization_members m
     join organizations o on o.id = m.organization_id
     where m.user_id = $1 and m.status = 'active'
     order by m.created_at asc`,
    [userId]
  )
  return rows.map((r) => ({ organizationId: r.organization_id, organizationName: r.name, role: r.role }))
}

/* ———— credential revocation ———— */

/** Ends every browser session of one account, in every organization. */
export async function revokeSessionsForUser(db: Queryable, userId: string): Promise<number> {
  const rows = await db.query<{ id: string }>(
    'update app_sessions set revoked_at = now() where user_id = $1 and revoked_at is null returning id',
    [userId]
  )
  return rows.length
}

/** Ends every MCP connection one account approved for one organization. */
export async function revokeConnectionsForUser(
  db: Queryable,
  userId: string,
  organizationId: string
): Promise<number> {
  const rows = await db.query<{ id: string }>(
    `update crm_oauth_connections set revoked_at = now()
     where user_id = $1 and organization_id = $2 and revoked_at is null returning id`,
    [userId, organizationId]
  )
  return rows.length
}

/**
 * Throws away authorization codes one account has approved but not yet
 * exchanged — in one organization, or everywhere when none is given. A code
 * lives five minutes; a person removed or reset inside those minutes must
 * not be able to finish connecting afterwards.
 */
export async function discardCodesForUser(
  db: Queryable,
  userId: string,
  organizationId: string | null
): Promise<number> {
  const rows = await db.query<{ code_hash: string }>(
    `delete from crm_oauth_codes
     where user_id = $1 and ($2::uuid is null or organization_id = $2) returning code_hash`,
    [userId, organizationId]
  )
  return rows.length
}

/* ———— writes ———— */

/** The acting owner, re-checked inside the lock: an owner revoked a moment
 *  ago must not finish an administration they started. */
async function assertActingOwner(db: Queryable, organizationId: string, actingUserId: string): Promise<void> {
  const [row] = await db.query<{ id: string }>(
    `select id from organization_members
     where organization_id = $1 and user_id = $2 and role = 'owner' and status = 'active'`,
    [organizationId, actingUserId]
  )
  if (!row) throw new CrmError('forbidden', 'Only an active owner of the organization can do this.')
}

export interface AddMemberInput {
  organizationId: string
  userId: string
  email: string
  displayName: string
  role: MemberRole
  colleague: ColleagueId | null
}

/**
 * Who is administering. Omitted only by the members script, which answers to
 * whoever holds the database connection string rather than to a membership.
 */
export interface Administration {
  actingUserId?: string
}

/**
 * The membership write itself: insert, or reactivate a revoked row.
 *
 * Reactivation rather than a second row: the unique (organization, user) key
 * means a person has one membership per organization for life, and the
 * history of it having been revoked is worth more than a fresh row. The
 * generation rotates on reactivation, so nothing minted before the revoke
 * comes back with it. An active membership is refused — the caller meant to
 * edit, not add. Runs inside the caller's locked transaction.
 */
async function upsertMembership(tx: Queryable, input: AddMemberInput): Promise<OrganizationMember> {
  const [existing] = await tx.query<MemberRow>(
    `select ${MEMBER_COLUMNS} from organization_members
     where organization_id = $1 and user_id = $2 for update`,
    [input.organizationId, input.userId]
  )
  if (existing?.status === 'active') {
    throw new CrmError('already_member', 'This account is already a member of the organization.')
  }

  if (input.colleague) {
    const [taken] = await tx.query<{ id: string }>(
      `select id from organization_members
       where organization_id = $1 and colleague = $2 and status = 'active' and id <> $3`,
      [input.organizationId, input.colleague, existing?.id ?? '00000000-0000-4000-8000-000000000000']
    )
    if (taken) throw new CrmError('colleague_taken', 'Another active member already carries that roster label.')
  }

  const [row] = existing
    ? await tx.query<MemberRow>(
        `update organization_members
         set status = 'active', revoked_at = null, role = $3, email = $4, display_name = $5, colleague = $6,
             credential_generation = gen_random_uuid()
         where id = $1 and organization_id = $2
         returning ${MEMBER_COLUMNS}`,
        [existing.id, input.organizationId, input.role, input.email, input.displayName, input.colleague]
      )
    : await tx.query<MemberRow>(
        `insert into organization_members (organization_id, user_id, role, email, display_name, colleague)
         values ($1, $2, $3, $4, $5, $6)
         returning ${MEMBER_COLUMNS}`,
        [input.organizationId, input.userId, input.role, input.email, input.displayName, input.colleague]
      )

  return fromMemberRow(row)
}

/**
 * Adds an account to the organization, or reactivates a revoked membership,
 * under the organization and account locks. This is the bare roster write;
 * it does not ask whether the account belongs elsewhere — claimAccount does,
 * and is what the owner-facing paths use.
 */
export async function addMember(
  db: Database,
  input: AddMemberInput,
  administration: Administration = {}
): Promise<OrganizationMember> {
  return db.transaction(async (tx) => {
    await lockOrganization(tx, input.organizationId)
    if (administration.actingUserId) await assertActingOwner(tx, input.organizationId, administration.actingUserId)
    await lockAccount(tx, input.userId)
    return upsertMembership(tx, input)
  })
}

/**
 * The owner-facing add: takes an account into this organization as its sole
 * home, replacing its password on the way in.
 *
 * One transaction under the account lock, so two organizations claiming the
 * same account at once are serialized: the second sees the first's active
 * membership and is refused before it touches the password. The order inside
 * is deliberate — membership first, then the external password change, then
 * the revocations — so a password call that fails rolls the membership back
 * and nothing has changed; while a failure *after* the password call leaves
 * the account with a new password and no saved membership, which the caller
 * reports as `membership_unsaved` (the password callback's own bookkeeping
 * tells it which side of the line it is on) and which a retry repairs, since
 * a retry replaces the password again. A SQL transaction cannot undo a call
 * to Supabase Auth; this ordering is what makes that survivable.
 */
export async function claimAccount(
  db: Database,
  input: AddMemberInput,
  administration: Administration,
  replacePassword: (member: OrganizationMember) => Promise<void>
): Promise<OrganizationMember> {
  return db.transaction(async (tx) => {
    await lockOrganization(tx, input.organizationId)
    if (administration.actingUserId) await assertActingOwner(tx, input.organizationId, administration.actingUserId)
    await lockAccount(tx, input.userId)

    if (await hasActiveMembershipElsewhere(tx, input.userId, input.organizationId)) {
      throw new CrmError('belongs_elsewhere', 'This account is an active member of another organization.')
    }

    const member = await upsertMembership(tx, input)
    await replacePassword(member)
    // Whatever the old password opened is closed with it: every session of
    // the account, and any connection still waiting to be exchanged.
    await revokeSessionsForUser(tx, input.userId)
    await discardCodesForUser(tx, input.userId, null)
    return member
  })
}

/**
 * Replaces an active member's password and ends everything the old one was
 * behind: sessions everywhere, this organization's MCP connections, pending
 * codes, and — through the rotated generation — wallpaper links.
 *
 * Refused for an account that also belongs to another organization: its
 * password is that person's to change. Same transaction-and-lock shape as
 * claimAccount, for the same reasons; the generation is rotated before the
 * external call so that a failure after it still leaves no old credential
 * usable.
 */
export async function resetCredentials(
  db: Database,
  target: { organizationId: string; memberId: string },
  administration: Administration,
  replacePassword: (member: OrganizationMember, nextGeneration: string) => Promise<void>
): Promise<OrganizationMember> {
  // Chosen here rather than by gen_random_uuid() so the caller can tell,
  // after a failure it cannot interpret, whether this reset committed: the
  // row either carries this value or it does not.
  const nextGeneration = randomUUID()
  return db.transaction(async (tx) => {
    await lockOrganization(tx, target.organizationId)
    if (administration.actingUserId) await assertActingOwner(tx, target.organizationId, administration.actingUserId)

    // Plain read to learn the account, locks, then the row for update and
    // every condition again — see the lock order in the header.
    const [peek] = await tx.query<{ user_id: string }>(
      'select user_id from organization_members where id = $1 and organization_id = $2 and status = $3',
      [target.memberId, target.organizationId, 'active']
    )
    if (!peek) throw new CrmError('not_found', 'That member is not an active member of this organization.')
    await lockAccount(tx, peek.user_id)

    const [row] = await tx.query<MemberRow>(
      `select ${MEMBER_COLUMNS} from organization_members
       where id = $1 and organization_id = $2 and status = 'active' for update`,
      [target.memberId, target.organizationId]
    )
    if (!row || row.user_id !== peek.user_id) throw new CrmError('not_found', 'That member is not an active member of this organization.')

    if (await hasActiveMembershipElsewhere(tx, row.user_id, target.organizationId)) {
      throw new CrmError('shared_account', 'This account is an active member of another organization.')
    }

    await tx.query('update organization_members set credential_generation = $2 where id = $1', [row.id, nextGeneration])
    const member = fromMemberRow(row)
    await replacePassword(member, nextGeneration)
    await revokeSessionsForUser(tx, row.user_id)
    await revokeConnectionsForUser(tx, row.user_id, target.organizationId)
    await discardCodesForUser(tx, row.user_id, null)
    return member
  })
}

/** Whether a membership currently carries `generation` — how a caller that
 *  lost the outcome of resetCredentials finds out whether it committed. */
export async function hasCredentialGeneration(db: Queryable, memberId: string, generation: string): Promise<boolean> {
  const [row] = await db.query<{ id: string }>(
    'select id from organization_members where id = $1 and credential_generation = $2',
    [memberId, generation]
  )
  return Boolean(row)
}

export interface UpdateMemberInput {
  displayName?: string
  role?: MemberRole
  /** `null` clears the roster label; `undefined` leaves it alone. */
  colleague?: ColleagueId | null
}

/**
 * Edits an active membership's name, role or roster label, under the
 * organization lock so a demotion cannot race another owner's.
 *
 * Demoting the last active owner is refused for the same reason revoking
 * them is. A roster label already carried by another active member is
 * refused rather than silently reassigned — moving "hai" from one account to
 * another is two deliberate edits, not one.
 */
export async function updateMember(
  db: Database,
  organizationId: string,
  memberId: string,
  input: UpdateMemberInput,
  administration: Administration = {}
): Promise<OrganizationMember> {
  return db.transaction(async (tx) => {
    await lockOrganization(tx, organizationId)
    if (administration.actingUserId) await assertActingOwner(tx, organizationId, administration.actingUserId)

    const [member] = await tx.query<MemberRow>(
      `select ${MEMBER_COLUMNS} from organization_members
       where id = $1 and organization_id = $2 for update`,
      [memberId, organizationId]
    )
    if (!member) throw new CrmError('not_found', 'That member does not exist in this organization.')
    if (member.status !== 'active') throw new CrmError('revoked_member', 'A revoked member cannot be edited. Add them again instead.')

    const role = input.role ?? member.role
    if (member.role === 'owner' && role !== 'owner') {
      const [owners] = await tx.query<{ n: number | string }>(
        `select count(*) as n from organization_members
         where organization_id = $1 and role = 'owner' and status = 'active'`,
        [organizationId]
      )
      if (Number(owners.n) <= 1) throw new CrmError('last_owner', 'The organization needs at least one active owner.')
    }

    const colleague = input.colleague === undefined ? member.colleague : input.colleague
    if (colleague && colleague !== member.colleague) {
      const [taken] = await tx.query<{ id: string }>(
        `select id from organization_members
         where organization_id = $1 and colleague = $2 and status = 'active' and id <> $3`,
        [organizationId, colleague, memberId]
      )
      if (taken) throw new CrmError('colleague_taken', 'Another active member already carries that roster label.')
    }

    const [updated] = await tx.query<MemberRow>(
      `update organization_members set display_name = $3, role = $4, colleague = $5
       where id = $1 and organization_id = $2
       returning ${MEMBER_COLUMNS}`,
      [memberId, organizationId, input.displayName ?? member.display_name, role, colleague]
    )
    return fromMemberRow(updated)
  })
}

/**
 * Revokes a membership and everything acting as it.
 *
 * One transaction under the organization lock (the owner count) and the
 * account lock (so a token exchange or tool commit in flight for this person
 * either finishes before the revoke and is then cut, or waits and finds the
 * membership gone): the membership, every browser session of that person in
 * this organization, every MCP connection they approved for it, every code
 * they have not yet exchanged for it, and — through the rotated generation —
 * every wallpaper link they minted. The last active owner cannot be revoked;
 * an organization nobody can administer is a dead end, not a state.
 */
export async function revokeMember(
  db: Database,
  organizationId: string,
  memberId: string,
  administration: Administration = {}
): Promise<OrganizationMember> {
  return db.transaction(async (tx) => {
    await lockOrganization(tx, organizationId)
    if (administration.actingUserId) await assertActingOwner(tx, organizationId, administration.actingUserId)

    // Plain read to learn the account, then the account lock, then the row
    // for update — never the row first. A membership row held for update
    // while waiting for the account lock deadlocks against a token exchange
    // holding that lock and inserting a connection that references the row.
    const [peek] = await tx.query<{ user_id: string; status: MemberStatus }>(
      'select user_id, status from organization_members where id = $1 and organization_id = $2',
      [memberId, organizationId]
    )
    if (!peek) throw new CrmError('not_found', 'That member does not exist in this organization.')
    await lockAccount(tx, peek.user_id)

    const [member] = await tx.query<MemberRow>(
      `select ${MEMBER_COLUMNS} from organization_members
       where id = $1 and organization_id = $2 for update`,
      [memberId, organizationId]
    )
    if (!member || member.user_id !== peek.user_id) throw new CrmError('not_found', 'That member does not exist in this organization.')
    if (member.status === 'revoked') return fromMemberRow(member)

    if (member.role === 'owner') {
      const [owners] = await tx.query<{ n: number | string }>(
        `select count(*) as n from organization_members
         where organization_id = $1 and role = 'owner' and status = 'active'`,
        [organizationId]
      )
      if (Number(owners.n) <= 1) {
        throw new CrmError('last_owner', 'The organization needs at least one active owner.')
      }
    }

    const [updated] = await tx.query<MemberRow>(
      `update organization_members
       set status = 'revoked', revoked_at = now(), credential_generation = gen_random_uuid()
       where id = $1 and organization_id = $2
       returning ${MEMBER_COLUMNS}`,
      [memberId, organizationId]
    )
    await tx.query(
      `update app_sessions set revoked_at = now()
       where user_id = $1 and organization_id = $2 and revoked_at is null`,
      [member.user_id, organizationId]
    )
    await revokeConnectionsForUser(tx, member.user_id, organizationId)
    await discardCodesForUser(tx, member.user_id, organizationId)

    return fromMemberRow(updated)
  })
}
