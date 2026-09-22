import { getAuthContext } from '@/lib/auth/context'
import { loadJournalVersion } from '@/lib/db/queries'

/**
 * The Journal's "has anything changed?" endpoint.
 *
 * The snapshot's version route next door, aimed at the other half of the data.
 * Journal entries never ship with the working set, so the snapshot stamp says
 * nothing about them — a colleague writing an entry, editing one or deleting
 * one moves this stamp and only this one. components/journal/JournalSync polls
 * it while a Journal surface is on screen and re-reads the feeds it finds
 * loaded when the answer differs from what it is holding.
 *
 * AUTH. Identical to the snapshot route's, for the same reason: a Route
 * Handler is reachable by direct fetch, so proxy.ts turning away
 * unauthenticated requests is the first line and this is the last. The context
 * that passes is also what scopes the stamp — it is computed over this
 * organization's entries only, so another workspace's writing neither wakes
 * this browser nor shows up in the count. The response carries no Journal
 * text, only a timestamp and a row count.
 */
export async function GET() {
  const context = await getAuthContext()
  if (!context) {
    return new Response('Unauthorized', { status: 401 })
  }

  const version = await loadJournalVersion(context.organizationId)

  return Response.json(
    { version },
    {
      // A cached stamp is a feed that never updates, which is the entire
      // bug this endpoint exists to fix.
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  )
}
