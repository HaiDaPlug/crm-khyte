import 'server-only'

import type { Queryable } from '@/lib/crm/database'
import { crmDatabase } from '@/lib/crm/database'
import { isDirectDbConfigured } from '@/lib/db/pg'
import { isTransientRead, withRetry } from '@/lib/db/retry'
import { getAuthContext } from './context'
import { verifyDisplayToken } from './display-token'

/**
 * Whose board a display request may read.
 *
 * proxy.ts admits a well-signed token without I/O; this is the check that
 * costs a query and is therefore made once, by the page and its version
 * route, rather than on every prefetch. A token names the membership that
 * minted it and that membership's credential generation at the time (see
 * ./display-token); the membership has to still be active under the same
 * generation. Revoking a member is meant to end their access everywhere, and
 * a wallpaper link they copied while a member is exactly the kind of access
 * that would otherwise outlive them — or come back when they are re-added.
 */

/**
 * The organization a token opens, or null when the token is bad, its minting
 * membership is no longer active, or that membership's generation has moved
 * on. Pure of Next so the PGlite suite can exercise the revocation rule.
 */
export async function resolveDisplayGrant(
  db: Queryable,
  colleague: string | undefined,
  token: string | undefined
): Promise<string | null> {
  const grant = verifyDisplayToken(colleague, token)
  if (!grant) return null

  // Active AND the same generation the link was minted under. A membership
  // revoked and re-added is active again, but its generation has moved on,
  // so a link from before the revoke stays dead.
  const [row] = await db.query<{ organization_id: string }>(
    `select organization_id from organization_members
     where id = $1 and organization_id = $2 and status = 'active' and credential_generation = $3`,
    [grant.memberId, grant.organizationId, grant.credentialGeneration]
  )
  return row ? row.organization_id : null
}

/**
 * The organization a display route renders for: the token's, when it verifies
 * and its minter is still a member; otherwise the session's, when there is
 * one. Token first, so a wallpaper link keeps working in a browser that also
 * happens to be logged into some other workspace — the link says whose board
 * it is. Null means the login page, which a wallpaper cannot fill in and a
 * person can.
 */
export async function displayOrganization(
  colleague: string | undefined,
  token: string | undefined
): Promise<string | null> {
  if (isDirectDbConfigured && verifyDisplayToken(colleague, token)) {
    const granted = await withRetry(
      'display grant read',
      () => resolveDisplayGrant(crmDatabase(), colleague, token),
      isTransientRead
    )
    if (granted) return granted
  }
  return (await getAuthContext())?.organizationId ?? null
}
