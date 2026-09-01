import { isAuthenticated } from '@/lib/auth/guard'
import { loadGoalsVersion } from '@/lib/db/queries'

/**
 * The direction board's "has anything changed?" endpoint, for the editor.
 *
 * The same stamp the wallpaper polls at /goals/display/<colleague>/version,
 * behind a session instead of a display token. /goals is the editor: it is
 * reached by a person who is logged in, never by Lively, so there is no
 * anonymous surface to admit here — exactly the split described on
 * app/api/snapshot/version/route.ts.
 *
 * Why a second route rather than reusing the wallpaper's: that one lives under
 * a [colleague] segment and answers for a named board. The editor belongs to
 * no colleague, and pointing it at someone's display URL would tie the whole
 * page to whichever name happened to be first in the roster.
 *
 * AUTH. proxy.ts already turns away a request with no session cookie, and this
 * repeats the check for the reason lib/auth/guard.ts exists: a Route Handler
 * is reachable by direct fetch, so Proxy is the first line and this is the
 * last. The response carries no board content — a timestamp and a row count —
 * so even a leaked stamp reveals nothing beyond "something changed".
 */
export async function GET() {
  if (!(await isAuthenticated())) {
    return new Response('Unauthorized', { status: 401 })
  }

  const version = await loadGoalsVersion()

  return Response.json(
    { version },
    {
      // A cached stamp is an editor that never updates, which is the entire
      // bug this endpoint exists to fix.
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  )
}
