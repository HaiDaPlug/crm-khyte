import { getAuthContext } from '@/lib/auth/context'
import { loadWeeklyProgress } from '@/lib/db/queries'

/**
 * The weekly non-negotiables and this week's counts, for the progress cards on
 * /leads and /prospects.
 *
 * WHY A ROUTE AND NOT THE SNAPSHOT. Those pages are client components fed
 * entirely by the store, which is built from `loadSnapshot()` in the root
 * layout. Adding goals to that snapshot would read them on every page load —
 * including the many routes with no card to show — and hand them to the client
 * tree regardless. A route lets the two pages that want this ask for it.
 *
 * AUTH. Same split as the other goal routes: proxy.ts turns away a request with
 * no session cookie and this repeats the check, because a Route Handler is
 * reachable by direct fetch. The response carries the team's weekly targets and
 * progress, so it stays behind the session rather than the display token — the
 * wallpaper's anonymous surface has no business with it. The context that
 * passes the check is also the organization the goals and counts are read
 * for; nothing on the request can name a different one.
 */
export async function GET() {
  const context = await getAuthContext()
  if (!context) {
    return new Response('Unauthorized', { status: 401 })
  }

  const progress = await loadWeeklyProgress(context.organizationId)

  return Response.json(progress, {
    // A cached count is a card that stops moving as the week fills up, which is
    // the whole point of showing it.
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
