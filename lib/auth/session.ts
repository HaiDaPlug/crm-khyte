import 'server-only'

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Browser sessions for individual accounts.
 *
 * Supabase Auth verifies the password (see ./identity). The app then mints a
 * session of its own rather than carrying Supabase's JWT around, for two
 * reasons that both matter here:
 *
 *   - proxy.ts runs on every request, prefetches included, and must verify a
 *     cookie without I/O. A signed token does that; a JWT would need a JWKS
 *     fetch or a network round-trip to refresh.
 *   - a single session has to be revocable — logging out, or an owner
 *     revoking a membership — which a bare signed cookie cannot do. So the
 *     token also lives, hashed, in `app_sessions`, and the real check in
 *     ./context looks it up.
 *
 * The cookie value is `<token>.<expiry>.<hmac>`: a 256-bit random token, the
 * expiry as a millisecond timestamp, and an HMAC-SHA256 over the two signed
 * with AUTH_SECRET. Signing rather than encrypting is deliberate — nothing in
 * the payload is secret except the token, and the token is only useful with
 * a valid signature. Rotating AUTH_SECRET invalidates every session at once.
 *
 * node:crypto rather than `jose`: Proxy runs on the Node.js runtime in Next 16
 * (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md),
 * so the built-in is available everywhere this runs.
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

export interface MintedSession {
  /** The random token. Store only its hash — see hashSessionToken. */
  token: string
  expiresAt: Date
  /** The cookie value carrying the token and its signature. */
  cookie: string
}

/** Mints a fresh token and the signed cookie value that carries it. */
export function mintSession(): MintedSession {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000
  const payload = `${token}.${expiresAt}`
  return { token, expiresAt: new Date(expiresAt), cookie: `${payload}.${sign(payload)}` }
}

export interface SessionCookie {
  token: string
  expiresAt: number
}

/**
 * The token inside a cookie whose signature we produced and which has not
 * expired, or null. No I/O — this is what proxy.ts calls on every request.
 *
 * Verifies the signature before reading the timestamp: an unsigned payload is
 * attacker-controlled, so parsing it first would be trusting the very thing
 * under test. Whether the session still exists is ./context's question.
 */
export function readSessionCookie(value: string | undefined): SessionCookie | null {
  if (!value || value.length > 400) return null

  // base64url tokens never contain '.', so the split is unambiguous.
  const parts = value.split('.')
  if (parts.length !== 3) return null
  const [token, expiry, signature] = parts
  if (!token || !expiry || !signature) return null

  if (!safeEqual(signature, sign(`${token}.${expiry}`))) return null

  const expiresAt = Number(expiry)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null

  return { token, expiresAt }
}

/** True when the cookie is well-signed and unexpired. The optimistic check. */
export function verifySession(value: string | undefined): boolean {
  return readSessionCookie(value) !== null
}

/**
 * The keyed hash stored in `app_sessions.token_hash`.
 *
 * Keyed rather than a plain digest so a leaked table of hashes is useless
 * without AUTH_SECRET as well. The `session:` prefix keeps this hash domain
 * separate from anything else signed with the same key.
 */
export function hashSessionToken(token: string): string {
  return createHmac('sha256', getSecret()).update(`session:${token}`).digest('hex')
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
