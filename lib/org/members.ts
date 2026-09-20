import 'server-only'

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
 * the organization the caller's context names. Session and MCP-connection
 * revocation live here too, because revoking a membership without cutting
 * the sessions and connections that act as that member would leave a person
 * with access the roster says they no longer have.
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

export interface AddMemberInput {
  organizationId: string
  userId: string
  email: string
  displayName: string
  role: MemberRole
  colleague: ColleagueId | null
}

/**
 * Adds an account to the organization, or reactivates a revoked membership.
 *
 * Reactivation rather than a second row: the unique (organization, user) key
 * means a person has one membership per organization for life, and the
 * history of it having been revoked is worth more than a fresh row. An
 * active membership is refused — the caller meant to edit, not add.
 */
export async function addMember(db: Queryable, input: AddMemberInput): Promise<OrganizationMember> {
  const [existing] = await db.query<MemberRow>(
    `select ${MEMBER_COLUMNS} from organization_members where organization_id = $1 and user_id = $2`,
    [input.organizationId, input.userId]
  )

  if (existing?.status === 'active') {
    throw new CrmError('already_member', 'This account is already a member of the organization.')
  }

  if (input.colleague) {
    const [taken] = await db.query<{ id: string }>(
      `select id from organization_members
       where organization_id = $1 and colleague = $2 and status = 'active' and id <> $3`,
      [input.organizationId, input.colleague, existing?.id ?? '00000000-0000-4000-8000-000000000000']
    )
    if (taken) throw new CrmError('colleague_taken', 'Another active member already carries that roster label.')
  }

  const [row] = existing
    ? await db.query<MemberRow>(
        `update organization_members
         set status = 'active', revoked_at = null, role = $3, email = $4, display_name = $5, colleague = $6
         where id = $1 and organization_id = $2
         returning ${MEMBER_COLUMNS}`,
        [existing.id, input.organizationId, input.role, input.email, input.displayName, input.colleague]
      )
    : await db.query<MemberRow>(
        `insert into organization_members (organization_id, user_id, role, email, display_name, colleague)
         values ($1, $2, $3, $4, $5, $6)
         returning ${MEMBER_COLUMNS}`,
        [input.organizationId, input.userId, input.role, input.email, input.displayName, input.colleague]
      )

  return fromMemberRow(row)
}

export interface UpdateMemberInput {
  displayName?: string
  role?: MemberRole
  /** `null` clears the roster label; `undefined` leaves it alone. */
  colleague?: ColleagueId | null
}

/**
 * Edits an active membership's name, role or roster label.
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
  input: UpdateMemberInput
): Promise<OrganizationMember> {
  return db.transaction(async (tx) => {
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
 * Revokes a membership and everything acting as it.
 *
 * One transaction: the membership, every browser session of that person in
 * this organization, and every MCP connection they approved for it. The last
 * active owner cannot be revoked — an organization nobody can administer is
 * a dead end, not a state.
 */
export async function revokeMember(
  db: Database,
  organizationId: string,
  memberId: string
): Promise<OrganizationMember> {
  return db.transaction(async (tx) => {
    const [member] = await tx.query<MemberRow>(
      `select ${MEMBER_COLUMNS} from organization_members
       where id = $1 and organization_id = $2 for update`,
      [memberId, organizationId]
    )
    if (!member) throw new CrmError('not_found', 'That member does not exist in this organization.')
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
      `update organization_members set status = 'revoked', revoked_at = now()
       where id = $1 and organization_id = $2
       returning ${MEMBER_COLUMNS}`,
      [memberId, organizationId]
    )
    await tx.query(
      `update app_sessions set revoked_at = now()
       where user_id = $1 and organization_id = $2 and revoked_at is null`,
      [member.user_id, organizationId]
    )
    await tx.query(
      `update crm_oauth_connections set revoked_at = now()
       where user_id = $1 and organization_id = $2 and revoked_at is null`,
      [member.user_id, organizationId]
    )

    return fromMemberRow(updated)
  })
}

/**
 * Whether the account is an active member of any organization but this one.
 *
 * The account is global — one Supabase Auth login serves every organization
 * the person belongs to — while an owner's authority stops at their own
 * roster. So an owner may only administer an account (attach it, replace its
 * password) while their organization is the account's sole active home; a
 * person who also belongs elsewhere manages their own credentials, and
 * joining a further organization waits for an invitation the person accepts
 * themselves (a later stage). Without this rule an owner of one organization
 * could reset a shared account's password and log in as that person into
 * the other organization.
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
 * The checks addMember will make, run ahead of creating an account so a
 * refusal leaves nothing behind. addMember repeats them; this is not the
 * guard, only the early answer.
 */
export async function assertCanAddMember(
  db: Queryable,
  input: { organizationId: string; userId: string | null; colleague: ColleagueId | null }
): Promise<void> {
  if (input.userId) {
    const [existing] = await db.query<{ id: string; status: MemberStatus }>(
      'select id, status from organization_members where organization_id = $1 and user_id = $2',
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

/** Ends every browser session of one account, in every organization. For a
 *  password that has just been replaced: whoever held the old one holds no
 *  session either. */
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
