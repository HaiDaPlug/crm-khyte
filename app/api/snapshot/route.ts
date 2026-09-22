import { getAuthContext } from '@/lib/auth/context'
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
 *
 * AUTH AND SCOPE. The context is both: null is a 401, and a non-null one names
 * the organization the stamp and the rows are read for. There is no
 * organization parameter on this route and there must never be one — the
 * session decides whose working set this is.
 */
export async function GET() {
  const context = await getAuthContext()
  if (!context) {
    return new Response('Unauthorized', { status: 401 })
  }

  const version = await loadSnapshotVersion(context.organizationId)
  const snapshot = await loadSnapshot(context)

  return Response.json(
    { version, snapshot },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  )
}
