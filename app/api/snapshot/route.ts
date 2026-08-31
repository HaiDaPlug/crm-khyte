import { isAuthenticated } from '@/lib/auth/guard'
import { loadSnapshot, loadSnapshotVersion } from '@/lib/db/queries'

/**
 * A fresh working set for a browser that already has one.
 *
 * Only reached after ./version reports a stamp the client has not seen, so
 * this runs on a real change rather than on a timer. The root layout still
 * serves the first copy — this is the re-read, and it deliberately does not
 * go through the layout: refreshing the route tree would hand the provider a
 * new snapshot prop that the store ignores, because the store is built once
 * per mount and never rebuilt (see lib/store/provider).
 *
 * The stamp is read BEFORE the rows, not after, and that ordering is
 * load-bearing. A write landing between the two reads then leaves the stamp
 * slightly behind the data, so the next poll re-applies a change already
 * present — harmless. Reading the stamp last would put it ahead of the data
 * and the client would mark that change seen without ever having received it.
 */
export async function GET() {
  if (!(await isAuthenticated())) {
    return new Response('Unauthorized', { status: 401 })
  }

  const version = await loadSnapshotVersion()
  const snapshot = await loadSnapshot()

  return Response.json(
    { version, snapshot },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  )
}
