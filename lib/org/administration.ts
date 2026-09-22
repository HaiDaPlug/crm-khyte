import 'server-only'

import type { AuthContext } from '@/lib/auth/context'
import { IdentityError } from '@/lib/auth/identity'
import type { Database, Queryable } from '@/lib/crm/database'
import { CrmError } from '@/lib/crm/errors'
import type { ActionScope, ColleagueId, MemberRole, OrganizationMember } from '@/lib/types'
import {
  assertCanAddMember,
  claimAccount,
  findActiveMembership,
  findActiveMembershipWithGeneration,
  hasCredentialGeneration,
  resetCredentials,
} from './members'

/**
 * The owner-facing member flows, with their two external effects — creating
 * an account, replacing a password — behind an injected identity provider.
 *
 * Kept apart from app/actions/members.ts so the flows can be exercised in
 * the PGlite suite with a fake provider and a fake administrator: the
 * Server Action is then only the gate (session, scope, input parsing) plus a
 * call in here. Nothing in this module reads a cookie or a header.
 *
 * THE ONE THING SQL CANNOT UNDO. Both flows call the identity provider from
 * inside a locked transaction, after the membership write and before the
 * revocations. A provider failure rolls the membership back and the world
 * is unchanged. A failure *after* the provider call — the revocations, the
 * commit, or merely the acknowledgement of a commit that landed — leaves
 * the provider's change in place with an unknown database outcome. So after
 * any such failure the flow reads the database again and answers from what
 * it finds — and it looks for ITS OWN commit, by the generation the claim
 * chose, never for "any" membership. Two owners adding the same new address
 * at once is the case that rule exists for: the first is still waiting for
 * the account service when the second claims the account and sets its own
 * password; the first then meets already_member, and the membership it
 * sees is not its own. Its password is stale, and it must say so
 * (`claim_superseded`) rather than hand it over. Only when the read finds
 * no membership at all does the flow report an unfinished state
 * (`membership_unsaved`); a reset likewise answers from the generation it
 * chose. Nothing is inferred from the exception.
 */

export type MemberActionError =
  | 'unauthorized'
  | 'context_mismatch'
  | 'invalid_input'
  | 'not_configured'
  | 'unavailable'
  | 'already_member'
  | 'colleague_taken'
  | 'email_taken'
  | 'weak_password'
  | 'last_owner'
  | 'revoked_member'
  | 'belongs_elsewhere'
  | 'shared_account'
  | 'membership_unsaved'
  | 'claim_superseded'
  | 'reset_unconfirmed'
  | 'not_found'
  | 'failed'

export type MemberResult =
  | { ok: true; member: OrganizationMember; temporaryPassword: string | null }
  | { ok: false; error: MemberActionError }

/** The account service, as the flows need it. lib/auth/identity.ts is the
 *  real one; the suite passes a fake that records what it was asked. */
export interface IdentityProvider {
  findAccountByEmail(db: Queryable, email: string): Promise<{ userId: string; email: string } | null>
  createAccount(input: { email: string; password: string; displayName: string }): Promise<{ userId: string }>
  setPassword(userId: string, password: string): Promise<void>
}

/** Who is administering, as the gate resolved them. */
export interface Administrator {
  organizationId: string
  userId: string
}

export interface AddMemberRequest {
  email: string
  displayName: string
  role: MemberRole
  colleague: ColleagueId | null
}

/**
 * Whether the scope a browser sent matches the session that arrived. Pure,
 * so the rule the CRM, goals and member actions all apply is one function.
 */
export function scopeMatches(context: Pick<AuthContext, 'organizationId' | 'userId'>, scope: ActionScope): boolean {
  return scope.organizationId === context.organizationId && scope.userId === context.userId
}

/** What postgres.js attaches to a constraint violation. */
type PgError = { code?: string; constraint_name?: string }

export function memberErrorCode(cause: unknown): MemberActionError {
  if (cause instanceof CrmError) {
    switch (cause.code) {
      case 'already_member':
      case 'colleague_taken':
      case 'last_owner':
      case 'revoked_member':
      case 'belongs_elsewhere':
      case 'shared_account':
      case 'not_found':
        return cause.code
      case 'forbidden':
        return 'unauthorized'
    }
  }
  if (cause instanceof IdentityError) {
    switch (cause.code) {
      case 'email_taken':
      case 'weak_password':
      case 'not_configured':
      case 'unavailable':
      case 'not_found':
        return cause.code
    }
  }
  // Two owners racing on the same label or the same person: the pre-checks
  // both passed and the database's unique indexes decided. Name the rule
  // that won rather than reporting a generic failure.
  const pg = cause as PgError | null
  if (pg?.code === '23505') {
    if (pg.constraint_name === 'organization_members_colleague_idx') return 'colleague_taken'
    if (pg.constraint_name?.includes('organization_id_user_id')) return 'already_member'
  }
  console.error('[khyte] member action failed:', cause instanceof Error ? cause.message : String(cause))
  return 'failed'
}

/**
 * Adds a person: creates their account, or takes over one that belongs
 * nowhere else, always with `password` as the fresh temporary password.
 *
 * The early checks run before an account is created so a refusal leaves no
 * orphan; the claim asks them again under its locks. See the header for
 * what happens after a failure that follows the provider call.
 */
export async function addMemberFlow(
  db: Database,
  identity: IdentityProvider,
  admin: Administrator,
  request: AddMemberRequest,
  password: string
): Promise<MemberResult> {
  const email = request.email.trim().toLowerCase()
  let userId: string | null = null
  let externalSideEffect = false
  /** The generation claimAccount stamped on the membership it wrote — the
   *  only thing that identifies this operation's commit afterwards. */
  let claimed: string | null = null

  try {
    const account = await identity.findAccountByEmail(db, email)
    await assertCanAddMember(db, {
      organizationId: admin.organizationId,
      userId: account?.userId ?? null,
      colleague: request.colleague,
    })

    // A brand-new account is created with the password already set; the
    // claim below then has nothing to replace. An existing one is replaced
    // inside the claim, after the locks have established it belongs nowhere
    // else. Either way the external world has changed once the flag is set.
    if (account) {
      userId = account.userId
    } else {
      userId = (await identity.createAccount({ email, password, displayName: request.displayName })).userId
      externalSideEffect = true
    }

    const member = await claimAccount(
      db,
      {
        organizationId: admin.organizationId,
        userId,
        email: account?.email ?? email,
        displayName: request.displayName,
        role: request.role,
        colleague: request.colleague,
      },
      { actingUserId: admin.userId },
      async (_member, generation) => {
        // Reached only once the membership row is written with this
        // generation, so from here on a commit is recognisable as ours.
        claimed = generation
        if (!account) return
        await identity.setPassword(userId!, password)
        externalSideEffect = true
      }
    )

    return { ok: true, member, temporaryPassword: password }
  } catch (cause) {
    if (!externalSideEffect || !userId) return { ok: false, error: memberErrorCode(cause) }

    // The account was created or its password replaced, and then something
    // failed — possibly only the acknowledgement of a commit that landed.
    // Ask the database rather than trust the exception, and ask for THIS
    // claim's commit: a membership carrying the generation this claim
    // stamped is ours, and the password is good.
    const ownGeneration = claimed as string | null
    const own = ownGeneration
      ? await findActiveMembershipWithGeneration(db, admin.organizationId, userId, ownGeneration).catch(() => null)
      : null
    if (own) return { ok: true, member: own, temporaryPassword: password }

    // An active membership that is not ours means another operation took
    // this account in while this one was waiting on the account service —
    // typically a second owner adding the same address. Their password is
    // the one the account has; this one's is stale and must not be shown.
    const other = await findActiveMembership(db, admin.organizationId, userId).catch(() => null)
    if (other) {
      console.error('[khyte] add superseded by a concurrent claim of the same account:', cause instanceof Error ? cause.message : String(cause))
      return { ok: false, error: 'claim_superseded' }
    }

    console.error('[khyte] account created/updated but membership not saved:', cause instanceof Error ? cause.message : String(cause))
    return { ok: false, error: 'membership_unsaved' }
  }
}

/**
 * Replaces a member's password with `password` and ends everything the old
 * one was behind. After a failure that follows the provider call, the
 * generation this reset chose is either on the row (committed) or not.
 */
export async function resetPasswordFlow(
  db: Database,
  identity: IdentityProvider,
  admin: Administrator,
  memberId: string,
  password: string
): Promise<MemberResult> {
  let replaced: { member: OrganizationMember; generation: string } | null = null
  try {
    const member = await resetCredentials(
      db,
      { organizationId: admin.organizationId, memberId },
      { actingUserId: admin.userId },
      async (target, nextGeneration) => {
        await identity.setPassword(target.userId, password)
        replaced = { member: target, generation: nextGeneration }
      }
    )
    return { ok: true, member, temporaryPassword: password }
  } catch (cause) {
    const done = replaced as { member: OrganizationMember; generation: string } | null
    if (!done) return { ok: false, error: memberErrorCode(cause) }
    const committed = await hasCredentialGeneration(db, done.member.id, done.generation).catch(() => false)
    if (committed) return { ok: true, member: done.member, temporaryPassword: password }
    console.error('[khyte] password replaced but credential reset not saved:', cause instanceof Error ? cause.message : String(cause))
    return { ok: false, error: 'reset_unconfirmed' }
  }
}
