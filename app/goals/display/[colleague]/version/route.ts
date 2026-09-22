import { COLLEAGUE_IDS } from '@/lib/colleagues'
import { displayOrganization } from '@/lib/auth/display-access'
import { DISPLAY_TOKEN_PARAM } from '@/lib/auth/display-token'
import { loadGoalsVersion } from '@/lib/db/queries'
import type { ColleagueId } from '@/lib/types'

/**
 * The wallpaper's "has anything changed?" endpoint.
 *
 * Returns a stamp that changes whenever the direction board does. The board
 * polls this every few seconds and reloads only when the value differs from the
 * one it was rendered with — see BoardRefresh. One indexed aggregate beats
 * re-rendering the page just to discover nothing moved.
 *
 * AUTH. This sits under /goals/display/<colleague>, so proxy.ts already accepts
 * a valid `?k=` token on the path — but Proxy matching a prefix is not the same
 * as this endpoint deciding who may read it, and a Route Handler is reachable
 * by direct fetch. The check is repeated here for the same reason
 * lib/auth/guard.ts exists rather than trusting Proxy: this is the last line,
 * not the first. Either the colleague's own token or a real session opens it,
 * mirroring the two ways the board itself is reachable — and, as on the page,
 * the check is also where the organization comes from. Token first, then
 * session, in the same order the page resolves it, so the stamp describes the
 * same organization's board the page rendered; a stamp for a different
 * workspace would either never match or reload the board forever.
 *
 * The response carries no board content — only a timestamp and a row count —
 * so even a leaked stamp reveals nothing beyond "something changed".
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ colleague: string }> }
) {
  const { colleague } = await params

  if (!COLLEAGUE_IDS.includes(colleague as ColleagueId)) {
    return new Response('Not found', { status: 404 })
  }

  const token = new URL(request.url).searchParams.get(DISPLAY_TOKEN_PARAM)
  // Same resolution as the page, membership check included: a revoked
  // member's link stops polling the moment it stops rendering.
  const organizationId = await displayOrganization(colleague, token ?? undefined)

  if (!organizationId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const version = await loadGoalsVersion(organizationId)

  return Response.json(
    { version },
    {
      // Must not be cached anywhere: a cached stamp is a board that never
      // updates, which is precisely the bug this endpoint exists to fix.
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  )
}
