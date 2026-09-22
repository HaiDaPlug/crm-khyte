'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { loginReturnTo } from '@/lib/auth/return-to'
import { verifyCredentials } from '@/lib/auth/identity'
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  hashSessionToken,
  mintSession,
  readSessionCookie,
  sessionCookieOptions,
} from '@/lib/auth/session'
import { crmDatabase } from '@/lib/crm/database'
import { isDirectDbConfigured } from '@/lib/db/pg'
import { listMembershipsForUser } from '@/lib/org/members'

/**
 * The gate's two actions.
 *
 * Kept apart from actions/crm.ts on purpose: those are narrow writes called by
 * the client store after an optimistic update, these are form handlers that
 * set cookies and redirect. Different shape, different lifecycle.
 *
 * Login is three steps with three owners. Supabase Auth says whether the
 * password is right (lib/auth/identity). The roster says which organization
 * this person may act in (lib/org/members). The app then mints its own
 * session (lib/auth/session) and records it, so it can be revoked. A correct
 * password with no active membership is not a login — there is no workspace
 * to enter.
 */

export type LoginError =
  | 'empty'
  | 'invalid'
  | 'throttled'
  | 'no_membership'
  | 'not_configured'
  | 'unavailable'

export type LoginState = { error: LoginError } | undefined

const credentials = z.object({
  email: z.string().trim().toLowerCase().min(1).max(320),
  password: z.string().min(1).max(1000),
})

/**
 * Slows down guessing, per server process.
 *
 * One bucket per email, so a script cannot hammer one account. Deliberately
 * NOT a global bucket as well: a shared counter is a shared fuse, and sixty
 * junk requests from anyone would have blown it for every real login on the
 * instance. Spreading guesses across many addresses is bounded elsewhere —
 * Supabase Auth rate-limits the password grant itself (a 429 surfaces as
 * `unavailable`, see lib/auth/identity.ts), and each address still gets only
 * its own ten. Keyed on the submitted email rather than a client-settable
 * forwarded address, which an attacker could rotate freely. In-memory and
 * per-instance, so it resets on deploy; move to a shared store if this ever
 * runs on more than one instance.
 */
const attempts = new Map<string, { count: number; firstAt: number }>()

const WINDOW_MS = 15 * 60 * 1000
const MAX_PER_EMAIL = 10
/** How many addresses to remember before forgetting the oldest. */
const MAX_TRACKED = 2000

function tooManyAttempts(email: string): boolean {
  const now = Date.now()

  // A flood of never-seen addresses must not grow the map without bound.
  // Expired records go first; if the map is still full, the oldest entry is
  // dropped — the cost is forgetting one address's count, never refusing a
  // real person.
  if (attempts.size >= MAX_TRACKED) {
    for (const [key, record] of attempts) {
      if (now - record.firstAt > WINDOW_MS) attempts.delete(key)
    }
    if (attempts.size >= MAX_TRACKED) {
      const oldest = attempts.keys().next().value
      if (oldest !== undefined) attempts.delete(oldest)
    }
  }

  const record = attempts.get(email)
  if (!record || now - record.firstAt > WINDOW_MS) {
    attempts.set(email, { count: 1, firstAt: now })
    return false
  }

  record.count += 1
  return record.count > MAX_PER_EMAIL
}

function clearAttempts(email: string) {
  attempts.delete(email)
}

export async function login(_state: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return { error: 'empty' }
  const { email, password } = parsed.data

  // Sessions live in the database; without one there is nothing to log into.
  if (!isDirectDbConfigured) return { error: 'not_configured' }

  if (tooManyAttempts(email)) return { error: 'throttled' }

  const verified = await verifyCredentials(email, password)
  if (!verified.ok) return { error: verified.reason }

  const db = crmDatabase()
  const memberships = await listMembershipsForUser(db, verified.userId)
  if (memberships.length === 0) return { error: 'no_membership' }

  // A person with several memberships enters the one they joined first.
  // Switching workspaces is a later stage; the session already records which
  // one it is acting in, so nothing here has to change for that.
  const membership = memberships[0]

  const session = mintSession()
  await db.query(
    `insert into app_sessions (user_id, organization_id, token_hash, expires_at)
     values ($1, $2, $3, $4)`,
    [verified.userId, membership.organizationId, hashSessionToken(session.token), session.expiresAt.toISOString()]
  )

  clearAttempts(email)

  const cookieStore = await cookies()

  // A cookie already in the jar names a session this login replaces: the
  // gate is served to signed cookies too (see proxy.ts), so a person can log
  // in over a live or a dead session. Revoke the old row rather than leave a
  // valid token behind for the rest of its seven days. Best effort — a stale
  // or foreign cookie simply matches nothing.
  const previous = readSessionCookie(cookieStore.get(SESSION_COOKIE)?.value)
  if (previous) {
    try {
      await db.query(
        'update app_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null',
        [hashSessionToken(previous.token)]
      )
    } catch (cause) {
      console.error('[khyte] previous session revoke on login failed:', cause instanceof Error ? cause.message : String(cause))
    }
  }

  cookieStore.set(SESSION_COOKIE, session.cookie, {
    ...sessionCookieOptions,
    maxAge: SESSION_MAX_AGE,
  })

  // Outside the try/catch-free path above on purpose: redirect() signals by
  // throwing, so it has to be the last thing the action does.
  redirect(loginReturnTo(formData.get('returnTo')))
}

/**
 * Ends this session server-side, then clears the cookie.
 *
 * Revoking the row is what makes the cookie worthless even if a copy of it
 * survives somewhere; clearing the cookie alone would leave a valid token
 * behind for the rest of its seven days.
 */
export async function logout() {
  const cookieStore = await cookies()
  const session = readSessionCookie(cookieStore.get(SESSION_COOKIE)?.value)

  if (session && isDirectDbConfigured) {
    try {
      await crmDatabase().query(
        'update app_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null',
        [hashSessionToken(session.token)]
      )
    } catch (cause) {
      // The cookie is cleared regardless; the row expires on its own.
      console.error('[khyte] session revoke on logout failed:', cause instanceof Error ? cause.message : String(cause))
    }
  }

  cookieStore.delete({ name: SESSION_COOKIE, ...sessionCookieOptions })
  redirect('/login')
}
