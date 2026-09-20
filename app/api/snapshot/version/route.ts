import { getAuthContext } from '@/lib/auth/context'
import { loadSnapshotVersion } from '@/lib/db/queries'

/**
 * The CRM's "has anything changed?" endpoint.
 *
 * Returns a stamp that moves whenever any of the working-set tables do — the
 * roster included, since it ships with the snapshot. Every open browser asks
 * this on a short interval and only pulls a fresh snapshot when the answer
 * differs from what it is holding — see components/layout/SnapshotSync. One
 * indexed aggregate beats shipping the whole working set every few seconds to
 * discover nothing moved.
 *
 * AUTH. A Route Handler is reachable by direct fetch, so proxy.ts turning away
 * unauthenticated requests is the first line and this is the last — the same
 * reasoning that puts the check inside the wallpaper's version route rather
 * than trusting the path prefix. There is no display-token variant here: the
 * CRM has no anonymous surface the way /goals/display does.
 *
 * The context that passes the check is also what scopes the stamp: it is
 * computed over this organization's rows only, so a stranger's edit neither
 * wakes this browser nor shows up in the count. The response carries no CRM
 * content — a timestamp and a row count — so a leaked stamp reveals nothing
 * beyond "something changed".
 */
export async function GET() {
  const context = await getAuthContext()
  if (!context) {
    return new Response('Unauthorized', { status: 401 })
  }

  const version = await loadSnapshotVersion(context.organizationId)

  return Response.json(
    { version },
    {
      // A cached stamp is a browser that never updates, which is the entire
      // bug this endpoint exists to fix.
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  )
}
