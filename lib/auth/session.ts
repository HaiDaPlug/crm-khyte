import 'server-only'

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Session for the single-password gate.
 *
 * There are no user accounts here — one shared password opens the whole
 * workspace — so a "session" carries no identity, only the fact that someone
 * proved they knew the password and when. That makes the cookie a signed
 * timestamp rather than a token that has to be looked up anywhere.
 *
 * The value is `<expiry>.<hmac>`, signed with AUTH_SECRET using HMAC-SHA256.
 * Signing rather than encrypting is deliberate: the payload is a timestamp the
 * user is welcome to read, and what actually matters is that they cannot forge
 * one. Nothing is stored server-side, so there is no session table to keep in
 * sync and nothing to clean up — the tradeoff is that a session cannot be
 * revoked individually. Rotating AUTH_SECRET invalidates every session at
 * once, which is the right blunt instrument for a shared password.
 *
 * node:crypto rather than `jose`: Proxy runs on the Node.js runtime in Next 16
 * (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md),
 * so the built-in is available everywhere this runs. `jose` is only present as
 * a transitive dependency of @supabase/supabase-js and could vanish on any
 * lockfile update.
 */

export const SESSION_COOKIE = 'khyte_session'

/** Seven days. Long enough not to nag a daily user, short enough that a stale
 *  session on a shared machine does not stay open indefinitely. */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

export const SESSION_MAX_AGE = SESSION_MAX_AGE_SECONDS

function getSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error(
      '[khyte] AUTH_SECRET is not set — the auth gate cannot sign sessions. See .env.example.'
    )
  }
  return secret
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

/**
 * Constant-time string compare.
 *
 * `timingSafeEqual` throws on length mismatch, which would itself leak length
 * through the exception, so the lengths are checked first and a mismatch still
 * runs a comparison of equal-length buffers before returning.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

/** Mints a signed session value that expires MAX_AGE from now. */
export function createSession(): string {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000
  const payload = String(expiresAt)
  return `${payload}.${sign(payload)}`
}

/**
 * True when the cookie carries a signature we produced and has not expired.
 *
 * Verifies the signature before reading the timestamp — an unsigned payload is
 * attacker-controlled, so parsing it first would be trusting the very thing
 * under test.
 */
export function verifySession(value: string | undefined): boolean {
  if (!value) return false

  const separator = value.lastIndexOf('.')
  if (separator <= 0) return false

  const payload = value.slice(0, separator)
  const signature = value.slice(separator + 1)

  if (!safeEqual(signature, sign(payload))) return false

  const expiresAt = Number(payload)
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
}

/**
 * Checks a submitted password against AUTH_PASSWORD in constant time.
 *
 * The password is compared directly rather than against a hash: it is a single
 * shared secret held in the environment, not a user record in a database, so
 * there is no store to breach and hashing would only protect the env file from
 * itself. Hash it here if this ever becomes per-user.
 */
export function verifyPassword(submitted: string): boolean {
  const expected = process.env.AUTH_PASSWORD
  if (!expected) {
    throw new Error(
      '[khyte] AUTH_PASSWORD is not set — the auth gate would accept nothing. See .env.example.'
    )
  }
  return safeEqual(submitted, expected)
}

/** Cookie attributes shared by the set and clear paths, so the two cannot
 *  drift — a delete only lands if the attributes match the original set. */
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  // Off over plain HTTP in dev, where the app is reached at localhost or a LAN
  // address and a Secure cookie would simply never be stored.
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const

/** Generates a value suitable for AUTH_SECRET. Used by the setup script. */
export function generateSecret(): string {
  return randomBytes(32).toString('base64url')
}
