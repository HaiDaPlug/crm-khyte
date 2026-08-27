import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The wallpaper's way past the gate.
 *
 * Lively Wallpaper renders a URL in a bare Chromium embed. It has its own
 * cookie jar, no way to show a login form, and no reliable persistence across
 * reboots — so the shared-password session in ./session cannot reach it. The
 * link itself has to carry the credential.
 *
 * `?k=<token>` on a display route is checked here. The token is not a random
 * string compared against an env var: it is an HMAC of the route's colleague
 * signed with DISPLAY_SECRET, so one leaked link opens exactly one person's
 * board and nothing else. Rotating DISPLAY_SECRET invalidates every link at
 * once, which is the right blunt instrument for a wallpaper.
 *
 * SCOPE. This is deliberately weaker than a session and must stay confined to
 * read-only display routes — proxy.ts is what enforces that, by only
 * consulting this for /goals/display/* and never for a Server Action. Anyone
 * holding the link sees that board's numbers; treat it as a secret URL, not as
 * an identity. There is no expiry, because a wallpaper that goes blank in a
 * month is worse than useless.
 *
 * Note this file is NOT `server-only`, unlike ./session — proxy.ts imports it,
 * and Proxy is not a server component. It still only ever runs on the Node.js
 * runtime (Next 16 runs Proxy there; see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md),
 * so node:crypto resolves and the secret never reaches a browser bundle.
 */

/** The query parameter carrying the token. Short, because this gets typed. */
export const DISPLAY_TOKEN_PARAM = 'k'

/** Routes a display token is accepted on. Everything else needs a session. */
export const DISPLAY_PATH_PREFIX = '/goals/display'

function getSecret(): string | undefined {
  return process.env.DISPLAY_SECRET
}

/**
 * The token for one colleague's board.
 *
 * Truncated to 32 base64url characters — 192 bits, far past guessing, and
 * short enough that the whole URL still fits in Lively's input field.
 */
export function displayToken(colleague: string): string | undefined {
  const secret = getSecret()
  if (!secret) return undefined
  return createHmac('sha256', secret).update(colleague).digest('base64url').slice(0, 32)
}

/** Constant-time compare; same reasoning and shape as ./session's. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

/**
 * True when `token` is the one issued for `colleague`.
 *
 * Returns false when DISPLAY_SECRET is unset rather than throwing: an
 * unconfigured deployment should refuse wallpaper links and fall through to
 * the normal login redirect, not 500 on every request that carries a `?k=`.
 */
export function verifyDisplayToken(
  colleague: string | undefined,
  token: string | undefined
): boolean {
  if (!colleague || !token) return false
  const expected = displayToken(colleague)
  if (!expected) return false
  return safeEqual(token, expected)
}

/**
 * Pulls the colleague out of `/goals/display/<colleague>`.
 *
 * Proxy sees a raw pathname, not route params, so the segment is read here
 * rather than trusting a value from elsewhere. Anything with extra segments or
 * characters outside the roster's shape is rejected — the token is bound to
 * this exact string, so a mismatch simply fails to verify, but rejecting early
 * keeps the HMAC input from being arbitrary attacker-controlled text.
 */
export function colleagueFromDisplayPath(pathname: string): string | undefined {
  if (!pathname.startsWith(`${DISPLAY_PATH_PREFIX}/`)) return undefined
  const segment = pathname.slice(DISPLAY_PATH_PREFIX.length + 1)
  if (!segment || !/^[a-z0-9-]{1,40}$/.test(segment)) return undefined
  return segment
}
