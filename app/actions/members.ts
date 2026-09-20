'use server'

import { randomBytes } from 'node:crypto'
import { z } from 'zod'

import { requireOwner } from '@/lib/auth/guard'
import { IdentityError, createAccount, findAccountByEmail, setPassword } from '@/lib/auth/identity'
import { crmDatabase } from '@/lib/crm/database'
import { CrmError } from '@/lib/crm/errors'
import { isDirectDbConfigured } from '@/lib/db/pg'
import {
  assertCanAddMember,
  claimAccount,
  resetCredentials,
  revokeMember as revokeMembership,
  updateMember as updateMembership,
} from '@/lib/org/members'
import type { OrganizationMember } from '@/lib/types'

/**
 * Owner-only management of who belongs to the organization.
 *
 * Every action starts with requireOwner(), which both authenticates and pins
 * the organization: a member id is only ever looked up inside the caller's
 * own organization, so an owner of one workspace cannot touch another's
 * roster by guessing an id.
 *
 * THE ACCOUNT IS GLOBAL; THE OWNER IS NOT. One Supabase Auth login serves
 * every organization a person belongs to, while an owner's authority stops
 * at their own roster. So an owner may administer an account — attach it,
 * replace its password — only while their organization is the account's
 * sole active home. An account that is active elsewhere is refused on both
 * counts: attaching it must wait for an invitation the person accepts
 * themselves (a later stage), and its password is theirs to change. Without
 * that line, an owner of one organization could reset a shared account's
 * password and log in as that person into another organization.
 *
 * No email is sent. Adding someone creates or takes over their account with
 * a temporary password that is returned exactly once, to the owner, who
 * hands it over. That is the simplest honest invitation for a team that sits
 * together; a mailed invite is a later stage.
 */

export type MemberActionError =
  | 'unauthorized'
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
  | 'not_found'
  | 'failed'

export type MemberResult =
  | { ok: true; member: OrganizationMember; temporaryPassword: string | null }
  | { ok: false; error: MemberActionError }

const colleague = z.enum(['erik', 'abdi', 'hai'])
const role = z.enum(['owner', 'member'])

const addInput = z.object({
  email: z.email().max(320),
  displayName: z.string().trim().min(1).max(80),
  role,
  colleague: colleague.nullable(),
})

const updateInput = z.object({
  memberId: z.uuid(),
  displayName: z.string().trim().min(1).max(80).optional(),
  role: role.optional(),
  colleague: colleague.nullable().optional(),
})

const memberIdInput = z.object({ memberId: z.uuid() })

/** Sixteen base64url characters — well past GoTrue's minimum and typeable. */
function temporaryPassword(): string {
  return randomBytes(12).toString('base64url')
}

/** What postgres.js attaches to a constraint violation. */
type PgError = { code?: string; constraint_name?: string }

function errorCode(cause: unknown): MemberActionError {
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

async function owner(): Promise<{ organizationId: string; userId: string } | null> {
  try {
    const context = await requireOwner()
    return { organizationId: context.organizationId, userId: context.userId }
  } catch {
    return null
  }
}

/**
 * Adds a person: creates their account, or takes over one that belongs
 * nowhere else, always with a fresh temporary password.
 *
 * The claim itself — eligibility, the membership write, the password change
 * and the revocations — happens in one locked transaction in
 * lib/org/members.claimAccount, so two organizations claiming the same
 * account at once are serialized and the loser never touches the password.
 * The early checks before an account is created are the same rules asked
 * first, so a refusal leaves no orphaned account whose password nobody was
 * shown; the transaction asks them again under its locks.
 *
 * The one failure a SQL transaction cannot undo is the call to Supabase
 * Auth. If the password was replaced and the membership then failed to
 * save, the owner is told exactly that (`membership_unsaved`) rather than a
 * generic failure: the account is fine, nothing else changed, and adding the
 * person again both saves the membership and issues a fresh password.
 */
export async function addMember(input: unknown): Promise<MemberResult> {
  const context = await owner()
  if (!context) return { ok: false, error: 'unauthorized' }
  if (!isDirectDbConfigured) return { ok: false, error: 'not_configured' }

  const parsed = addInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const email = parsed.data.email.trim().toLowerCase()

  let passwordReplaced = false
  try {
    const db = crmDatabase()
    const account = await findAccountByEmail(db, email)
    await assertCanAddMember(db, {
      organizationId: context.organizationId,
      userId: account?.userId ?? null,
      colleague: parsed.data.colleague,
    })

    const password = temporaryPassword()
    // A brand-new account is created with the password already set; the
    // claim below then has nothing to replace. An existing one is replaced
    // inside the claim, after the locks have established it belongs nowhere
    // else.
    const userId = account
      ? account.userId
      : (await createAccount({ email, password, displayName: parsed.data.displayName })).userId

    const member = await claimAccount(
      db,
      {
        organizationId: context.organizationId,
        userId,
        email: account?.email ?? email,
        displayName: parsed.data.displayName,
        role: parsed.data.role,
        colleague: parsed.data.colleague,
      },
      { actingUserId: context.userId },
      async () => {
        if (!account) return
        await setPassword(userId, password)
        passwordReplaced = true
      }
    )

    return { ok: true, member, temporaryPassword: password }
  } catch (cause) {
    if (passwordReplaced) {
      console.error('[khyte] account password replaced but membership not saved:', cause instanceof Error ? cause.message : String(cause))
      return { ok: false, error: 'membership_unsaved' }
    }
    return { ok: false, error: errorCode(cause) }
  }
}

export async function updateMember(input: unknown): Promise<MemberResult> {
  const context = await owner()
  if (!context) return { ok: false, error: 'unauthorized' }
  if (!isDirectDbConfigured) return { ok: false, error: 'not_configured' }

  const parsed = updateInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  try {
    const { memberId, ...changes } = parsed.data
    const member = await updateMembership(crmDatabase(), context.organizationId, memberId, changes, { actingUserId: context.userId })
    return { ok: true, member, temporaryPassword: null }
  } catch (cause) {
    return { ok: false, error: errorCode(cause) }
  }
}

/**
 * Revokes a member. Their sessions and MCP connections go with it, so an
 * owner revoking themselves is logged out by their own action — allowed, as
 * long as another owner remains.
 */
export async function revokeMember(input: unknown): Promise<MemberResult> {
  const context = await owner()
  if (!context) return { ok: false, error: 'unauthorized' }
  if (!isDirectDbConfigured) return { ok: false, error: 'not_configured' }

  const parsed = memberIdInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  try {
    const member = await revokeMembership(crmDatabase(), context.organizationId, parsed.data.memberId, { actingUserId: context.userId })
    return { ok: true, member, temporaryPassword: null }
  } catch (cause) {
    return { ok: false, error: errorCode(cause) }
  }
}

/**
 * Replaces a member's password with a fresh temporary one, returned once,
 * and ends every session, connection, pending code and wallpaper link the
 * old one was behind (lib/org/members.resetCredentials).
 *
 * Refused when the account also belongs to another organization — see the
 * header. The app sends no recovery email in this release, so for a person
 * whose only workspace this is, an owner resetting and handing over the new
 * password is how a lock-out ends. The same Supabase Auth caveat as add
 * applies: a failure after the password call is reported as
 * `membership_unsaved` — the password changed, the revocations may not have
 * run — and a second reset completes them.
 */
export async function resetMemberPassword(input: unknown): Promise<MemberResult> {
  const context = await owner()
  if (!context) return { ok: false, error: 'unauthorized' }
  if (!isDirectDbConfigured) return { ok: false, error: 'not_configured' }

  const parsed = memberIdInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  const password = temporaryPassword()
  let passwordReplaced = false
  try {
    const member = await resetCredentials(
      crmDatabase(),
      { organizationId: context.organizationId, memberId: parsed.data.memberId },
      { actingUserId: context.userId },
      async (target) => {
        await setPassword(target.userId, password)
        passwordReplaced = true
      }
    )
    return { ok: true, member, temporaryPassword: password }
  } catch (cause) {
    if (passwordReplaced) {
      console.error('[khyte] password replaced but credential reset not saved:', cause instanceof Error ? cause.message : String(cause))
      return { ok: false, error: 'membership_unsaved' }
    }
    return { ok: false, error: errorCode(cause) }
  }
}
