'use server'

import { isSupabaseConfigured } from '@/lib/supabase/server'
import { isDirectDbConfigured } from '@/lib/db/pg'
import { isTransientRead, withRetry } from '@/lib/db/retry'
import { requireAuth } from '@/lib/auth/guard'
import { loadEventsForSubjects, type CrmEventRecord } from '@/lib/db/events'

/**
 * The activity log, fetched for the contacted-prospect export.
 *
 * WHY THIS IS AN ACTION AND NOT PART OF THE SNAPSHOT. `crm_events` is history,
 * and the client store holds current state — every screen in the app reads the
 * latter and none of them want the former. Folding a few hundred immutable
 * event rows into `loadSnapshot()` would drag them across the wire on every page
 * load in the session to serve one button that is pressed occasionally. Fetched
 * on demand instead, when the operator actually exports.
 *
 * WHY IT RETURNS ROWS RATHER THAN A FINISHED CSV. Everything the export derives
 * from these events is pure arithmetic over dates, and keeping it in
 * lib/export-prospects.ts means it stays testable without a database and the
 * client store's notes and tasks can be joined in beside it. The server's only
 * job is the part the browser genuinely cannot do — reading the log.
 *
 * SECURITY. Same reasoning as the write actions in ./crm: a Server Action is an
 * endpoint reachable by direct POST, so this checks the session itself rather
 * than trusting that proxy.ts ran. It is the pipeline's activity history, which
 * is exactly the sort of thing that should not be readable by an unauthenticated
 * request.
 */

export type ExportEventsResult =
  | { ok: true; events: Record<string, CrmEventRecord[]> }
  | { ok: false; error: string }

/**
 * Returns a plain object rather than the Map `loadEventsForSubjects` builds:
 * a Map does survive the Server Action boundary, but an object is the shape the
 * caller destructures anyway and it keeps the serialized payload obvious.
 */
export async function loadExportEvents(
  subjectIds: string[]
): Promise<ExportEventsResult> {
  await requireAuth()

  // Without a database the app is running on demo data that has no event log at
  // all. An empty history is the honest answer, and it degrades the export to
  // exactly what it produced before the log was wired in.
  if (!isSupabaseConfigured || !isDirectDbConfigured) {
    return { ok: true, events: {} }
  }

  // Guard against a caller with an empty pipeline before touching the database.
  if (subjectIds.length === 0) return { ok: true, events: {} }

  try {
    const bySubject = await withRetry(
      'export events read',
      () => loadEventsForSubjects(subjectIds),
      isTransientRead
    )
    return { ok: true, events: Object.fromEntries(bySubject) }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    console.error('[khyte] export event history read failed:', message)
    // Reported rather than thrown so the caller can still export the columns
    // that need no log — a CSV without history beats no CSV at all, provided
    // the operator is told which one they got.
    return { ok: false, error: message }
  }
}
