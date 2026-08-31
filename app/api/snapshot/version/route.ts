import { isAuthenticated } from '@/lib/auth/guard'
import { loadSnapshotVersion } from '@/lib/db/queries'

/**
 * The CRM's "has anything changed?" endpoint.
 *
 * Returns a stamp that moves whenever any of the eight working-set tables do.
 * Every open browser asks this on a short interval and only pulls a fresh
 * snapshot when the answer differs from what it is holding — see
 * components/layout/SnapshotSync. One indexed aggregate beats shipping the
 * whole working set every few seconds to discover nothing moved.
 *
 * AUTH. A Route Handler is reachable by direct fetch, so proxy.ts turning away
 * unauthenticated requests is the first line and this is the last — the same
 * reasoning that puts the check inside the wallpaper's version route rather
 * than trusting the path prefix. There is no display-token variant here: the
 * CRM has no anonymous surface the way /goals/display does.
 *
 * The response carries no CRM content — a timestamp and a row count — so a
 * leaked stamp reveals nothing beyond "something changed".
 */
export async function GET() {
  if (!(await isAuthenticated())) {
    return new Response('Unauthorized', { status: 401 })
  }

  const version = await loadSnapshotVersion()

  return Response.json(
    { version },
    {
      // A cached stamp is a browser that never updates, which is the entire
      // bug this endpoint exists to fix.
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  )
}
