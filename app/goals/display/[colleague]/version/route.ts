import { COLLEAGUE_IDS } from '@/lib/colleagues'
import { isAuthenticated } from '@/lib/auth/guard'
import { DISPLAY_TOKEN_PARAM, verifyDisplayToken } from '@/lib/auth/display-token'
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
 * not the first. Either a real session or the colleague's own token opens it,
 * mirroring the two ways the board itself is reachable.
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
  const allowed =
    verifyDisplayToken(colleague, token ?? undefined) || (await isAuthenticated())

  if (!allowed) {
    return new Response('Unauthorized', { status: 401 })
  }

  const version = await loadGoalsVersion()

  return Response.json(
    { version },
    {
      // Must not be cached anywhere: a cached stamp is a board that never
      // updates, which is precisely the bug this endpoint exists to fix.
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  )
}
