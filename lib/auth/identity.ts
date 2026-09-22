import 'server-only'

import { createClient } from '@supabase/supabase-js'

import type { Queryable } from '@/lib/crm/database'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/server'

/**
 * The identity provider: Supabase Auth.
 *
 * Accounts, password hashes, and one day password recovery and MFA live in
 * GoTrue. This module is the whole of the app's contact with it, so the
 * provider can be swapped without touching sessions, memberships or scoping —
 * all of which are the app's own (see ./session and ./context).
 *
 * Two clients, on purpose. Password verification uses the publishable key,
 * which is what a browser would use and carries no privilege of its own. Admin
 * operations — creating an account, setting a password — use the secret key
 * and never run on behalf of a request that has not passed requireOwner().
 *
 * The session GoTrue hands back after a successful password check is
 * discarded: the app mints its own (see ./session). It is revoked server-side
 * as a courtesy so GoTrue does not accumulate refresh tokens nobody will use.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

/** Whether accounts can be verified at all. Both keys are needed: one to
 *  check a password, the other to manage accounts. */
export const isIdentityConfigured = Boolean(url && publishableKey) && isSupabaseConfigured

export class IdentityError extends Error {
  constructor(
    public code: 'not_configured' | 'unavailable' | 'email_taken' | 'weak_password' | 'not_found' | 'rejected',
    message: string
  ) {
    super(message)
  }
}

export type CredentialResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: 'invalid' | 'not_configured' | 'unavailable' }

/**
 * Checks an email/password pair against Supabase Auth.
 *
 * Every 4xx collapses to `invalid`: a wrong password, an unknown email and an
 * unconfirmed address must all read the same from outside, or the login form
 * becomes an account-enumeration oracle. Network and 5xx faults are
 * `unavailable`, which the form reports as a different message because the
 * remedy is different (wait, not retype).
 */
export async function verifyCredentials(email: string, password: string): Promise<CredentialResult> {
  if (!isIdentityConfigured) return { ok: false, reason: 'not_configured' }

  const client = createClient(url!, publishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  let response: Awaited<ReturnType<typeof client.auth.signInWithPassword>>
  try {
    response = await client.auth.signInWithPassword({ email, password })
  } catch (cause) {
    console.error('[khyte] identity provider unreachable:', cause instanceof Error ? cause.message : String(cause))
    return { ok: false, reason: 'unavailable' }
  }

  if (response.error || !response.data.user) {
    const status = response.error?.status ?? 0
    // GoTrue's own throttle. Not an enumeration signal — it says nothing
    // about the account — and the remedy is to wait, not to retype, so it
    // must not read as a wrong password.
    if (status === 429) return { ok: false, reason: 'unavailable' }
    if (status >= 400 && status < 500) return { ok: false, reason: 'invalid' }
    console.error('[khyte] identity provider error:', response.error?.message ?? 'no user in response')
    return { ok: false, reason: 'unavailable' }
  }

  const token = response.data.session?.access_token
  if (token) {
    try {
      await getSupabase().auth.admin.signOut(token, 'local')
    } catch {
      // Best effort. An orphaned GoTrue session is harmless; a failed login
      // for a verified password would not be.
    }
  }

  return { ok: true, userId: response.data.user.id, email: response.data.user.email ?? email }
}

/**
 * Creates an account with a known password and no confirmation email.
 *
 * Confirmation is skipped deliberately: an owner adding a teammate has
 * already vouched for the address, and the app sends no email of its own in
 * this release. The teammate changes the temporary password themselves.
 */
export async function createAccount(input: {
  email: string
  password: string
  displayName: string
}): Promise<{ userId: string }> {
  if (!isIdentityConfigured) throw new IdentityError('not_configured', 'Identity provider is not configured.')

  const { data, error } = await getSupabase().auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: input.displayName },
  })

  if (error || !data.user) {
    const code = error?.code ?? ''
    if (code === 'email_exists' || code === 'user_already_exists') {
      throw new IdentityError('email_taken', 'An account with this email already exists.')
    }
    if (code === 'weak_password' || code === 'validation_failed') {
      throw new IdentityError('weak_password', error?.message ?? 'The password was rejected.')
    }
    throw new IdentityError('unavailable', error?.message ?? 'The account could not be created.')
  }

  return { userId: data.user.id }
}

/** Replaces an account's password. Owner-only; the caller shows it once. */
export async function setPassword(userId: string, password: string): Promise<void> {
  if (!isIdentityConfigured) throw new IdentityError('not_configured', 'Identity provider is not configured.')

  const { error } = await getSupabase().auth.admin.updateUserById(userId, { password })
  if (error) {
    if (error.code === 'weak_password' || error.code === 'validation_failed') {
      throw new IdentityError('weak_password', error.message)
    }
    if (error.status === 404) throw new IdentityError('not_found', 'The account no longer exists.')
    throw new IdentityError('unavailable', error.message)
  }
}

/**
 * The account behind an email, read straight from the auth schema.
 *
 * The admin API has no lookup-by-email, and the direct Postgres connection
 * already reaches `auth.users`. Case-insensitive, matching how GoTrue treats
 * addresses.
 */
export async function findAccountByEmail(
  db: Queryable,
  email: string
): Promise<{ userId: string; email: string } | null> {
  const [row] = await db.query<{ id: string; email: string }>(
    'select id, email from auth.users where lower(email) = lower($1) limit 1',
    [email.trim()]
  )
  return row ? { userId: row.id, email: row.email } : null
}
