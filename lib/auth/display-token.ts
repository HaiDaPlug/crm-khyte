import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The wallpaper's way past the gate.
 *
 * Lively Wallpaper renders a URL in a bare Chromium embed. It has its own
 * cookie jar, no way to show a login form, and no reliable persistence across
 * reboots — so the session in ./session cannot reach it. The link itself has
 * to carry the credential.
 *
 * `?k=<token>` on a display route is checked here. The token is
 * `<organization id>.<member id>.<hmac>`: the organization and the membership
 * that minted the link in the clear (both are identifiers, not secrets) and
 * an HMAC over `<organization>:<member>:<colleague>` signed with
 * DISPLAY_SECRET. One leaked link therefore opens exactly one person's board
 * in exactly one organization and nothing else.
 *
 * WHY THE MEMBER IS IN IT. A link is minted by a person and must stop working
 * when that person is no longer a member. The HMAC alone cannot know that —
 * it is the same for the rest of the link's life — so the display routes
 * look the membership up (./display-access) and refuse a link whose minter
 * has been revoked. Other members' links are untouched, which is the point:
 * revoking one person must not blank the whole team's wallpapers. Rotating
 * DISPLAY_SECRET still invalidates every link at once, which remains the
 * right blunt instrument when a link's whereabouts are unknown.
 *
 * SCOPE. This is deliberately weaker than a session and must stay confined to
 * read-only display routes — proxy.ts is what enforces that, by only
 * consulting this for /goals/display/* and never for a Server Action. Anyone
 * holding the link sees that board's numbers; treat it as a secret URL, not as
 * an identity. There is no expiry, because a wallpaper that goes blank in a
 * month is worse than useless; revocation is what ends it.
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getSecret(): string | undefined {
  return process.env.DISPLAY_SECRET
}

function signature(organizationId: string, memberId: string, colleague: string): string | undefined {
  const secret = getSecret()
  if (!secret) return undefined
  // Truncated to 32 base64url characters — 192 bits, far past guessing, and
  // short enough that the whole URL still fits in Lively's input field.
  return createHmac('sha256', secret)
    .update(`${organizationId}:${memberId}:${colleague}`)
    .digest('base64url')
    .slice(0, 32)
}

/** The token one member mints for one colleague's board in one organization. */
export function displayToken(
  organizationId: string,
  memberId: string,
  colleague: string
): string | undefined {
  const sig = signature(organizationId, memberId, colleague)
  return sig ? `${organizationId}.${memberId}.${sig}` : undefined
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

/** What a verified token says: which organization's board, minted by whom. */
export interface DisplayGrant {
  organizationId: string
  memberId: string
}

/**
 * The organization and minting member a token opens `colleague`'s board for,
 * or null. Signature only — whether the member is still active is
 * ./display-access's question, because answering it needs the database.
 *
 * Returns null when DISPLAY_SECRET is unset rather than throwing: an
 * unconfigured deployment should refuse wallpaper links and fall through to
 * the normal login redirect, not 500 on every request that carries a `?k=`.
 */
export function verifyDisplayToken(
  colleague: string | undefined,
  token: string | undefined
): DisplayGrant | null {
  if (!colleague || !token || token.length > 160) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [organizationId, memberId, provided] = parts
  if (!UUID.test(organizationId) || !UUID.test(memberId) || !provided) return null

  const expected = signature(organizationId, memberId, colleague)
  if (!expected) return null
  return safeEqual(provided, expected)
    ? { organizationId: organizationId.toLowerCase(), memberId: memberId.toLowerCase() }
    : null
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

  const rest = pathname.slice(DISPLAY_PATH_PREFIX.length + 1)
  const segments = rest.split('/').filter(Boolean)

  // The colleague, plus at most one sub-path beneath it. The board lives at
  // /goals/display/<colleague> and its change-check at
  // /goals/display/<colleague>/version, and both must be reachable with the
  // same token — the token is bound to the colleague, not to the leaf.
  //
  // Bounded rather than open-ended on purpose: allowing arbitrary depth would
  // let any future route nested under a display path inherit token access by
  // accident. A new sub-route has to be a deliberate decision, not a default.
  if (segments.length === 0 || segments.length > 2) return undefined

  const [colleague] = segments
  if (!/^[a-z0-9-]{1,40}$/.test(colleague)) return undefined

  return colleague
}
