'use server'

import { randomBytes } from 'node:crypto'
import { z } from 'zod'

import type { AuthContext } from '@/lib/auth/context'
import { requireOwner } from '@/lib/auth/guard'
import { createAccount, findAccountByEmail, setPassword } from '@/lib/auth/identity'
import { crmDatabase } from '@/lib/crm/database'
import { isDirectDbConfigured } from '@/lib/db/pg'
import {
  addMemberFlow,
  memberErrorCode,
  resetPasswordFlow,
  scopeMatches,
  type MemberActionError,
  type MemberResult,
} from '@/lib/org/administration'
import { revokeMember as revokeMembership, updateMember as updateMembership } from '@/lib/org/members'

export type { MemberActionError, MemberResult } from '@/lib/org/administration'

/**
 * Owner-only management of who belongs to the organization.
 *
 * These are the gates; the flows live in lib/org/administration.ts so the
 * suite can drive them with a fake identity provider. Every action passes
 * the same gate the CRM actions do: the caller is an active owner, and the
 * scope the browser believes it is acting in matches the session that
 * arrived. A Settings dialog opened while viewing one workspace, then
 * submitted after another tab logged in as someone else, would otherwise
 * add its draft to the new owner's organization — a perfectly authenticated
 * write to the wrong place. The scope is an expectation to verify, never an
 * authority: nothing is looked up by it, and it is checked before any
 * account lookup or Supabase Auth call.
 *
 * THE ACCOUNT IS GLOBAL; THE OWNER IS NOT. One Supabase Auth login serves
 * every organization a person belongs to, while an owner's authority stops
 * at their own roster. So an owner may administer an account — attach it,
 * replace its password — only while their organization is the account's
 * sole active home (lib/org/members.ts enforces it under locks).
 *
 * No email is sent. Adding someone creates or takes over their account with
 * a temporary password that is returned exactly once, to the owner, who
 * hands it over. That is the simplest honest invitation for a team that sits
 * together; a mailed invite is a later stage.
 */

const colleague = z.enum(['erik', 'abdi', 'hai'])
const role = z.enum(['owner', 'member'])

const scopeInput = z.object({ organizationId: z.uuid(), userId: z.uuid() })

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

/** The real account service, in the shape the flows take. */
const identity = { findAccountByEmail, createAccount, setPassword }

/**
 * The gate every action passes: an active owner, acting in the workspace
 * the browser expected. Returns the context to act as, or the error to
 * answer with. A mismatch is answered before the action's own input is
 * even parsed, so a stale tab never reaches an account lookup.
 */
async function gate(scope: unknown): Promise<AuthContext | MemberActionError> {
  let context: AuthContext
  try {
    context = await requireOwner()
  } catch {
    return 'unauthorized'
  }
  const expected = scopeInput.safeParse(scope)
  if (!expected.success) return 'invalid_input'
  if (!scopeMatches(context, expected.data)) return 'context_mismatch'
  if (!isDirectDbConfigured) return 'not_configured'
  return context
}

export async function addMember(input: unknown, scope: unknown): Promise<MemberResult> {
  const context = await gate(scope)
  if (typeof context === 'string') return { ok: false, error: context }

  const parsed = addInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  return addMemberFlow(
    crmDatabase(),
    identity,
    { organizationId: context.organizationId, userId: context.userId },
    parsed.data,
    temporaryPassword()
  )
}

export async function updateMember(input: unknown, scope: unknown): Promise<MemberResult> {
  const context = await gate(scope)
  if (typeof context === 'string') return { ok: false, error: context }

  const parsed = updateInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  try {
    const { memberId, ...changes } = parsed.data
    const member = await updateMembership(crmDatabase(), context.organizationId, memberId, changes, { actingUserId: context.userId })
    return { ok: true, member, temporaryPassword: null }
  } catch (cause) {
    return { ok: false, error: memberErrorCode(cause) }
  }
}

/**
 * Revokes a member. Their sessions, connections, pending codes and wallpaper
 * links go with it, so an owner revoking themselves is logged out by their
 * own action — allowed, as long as another owner remains.
 */
export async function revokeMember(input: unknown, scope: unknown): Promise<MemberResult> {
  const context = await gate(scope)
  if (typeof context === 'string') return { ok: false, error: context }

  const parsed = memberIdInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  try {
    const member = await revokeMembership(crmDatabase(), context.organizationId, parsed.data.memberId, { actingUserId: context.userId })
    return { ok: true, member, temporaryPassword: null }
  } catch (cause) {
    return { ok: false, error: memberErrorCode(cause) }
  }
}

/**
 * Replaces a member's password with a fresh temporary one, returned once,
 * and ends every session, connection, pending code and wallpaper link the
 * old one was behind. Refused when the account also belongs to another
 * organization. The app sends no recovery email in this release, so for a
 * person whose only workspace this is, an owner resetting and handing over
 * the new password is how a lock-out ends.
 */
export async function resetMemberPassword(input: unknown, scope: unknown): Promise<MemberResult> {
  const context = await gate(scope)
  if (typeof context === 'string') return { ok: false, error: context }

  const parsed = memberIdInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  return resetPasswordFlow(
    crmDatabase(),
    identity,
    { organizationId: context.organizationId, userId: context.userId },
    parsed.data.memberId,
    temporaryPassword()
  )
}
