import 'server-only'

import type { ColleagueId, Stage } from '@/lib/types'
import { getSupabase } from '@/lib/supabase/server'
import { STAGES } from '@/lib/stage-config'

/**
 * Recording CRM activity.
 *
 * WHY THIS IS SERVER-SIDE. Every CRM mutation goes through the optimistic
 * client store, which applies the change locally and then fires a Server
 * Action. Emitting events from the store would log activity that never reached
 * the database — a failed write would still count toward the week. Recording
 * here, inside the action, after the write succeeds, means an event exists if
 * and only if the thing it describes actually happened.
 *
 * WHY TRANSITIONS, NOT STATES. "Meetings booked this week" counts the moment a
 * deal *entered* Meeting Booked, so it must be recorded when the move happens —
 * the opportunity row only ever holds where the deal is now. Dragging a card
 * forward and back must not count twice, which is what `crossedInto` below is
 * for: only a move from an earlier stage to at-or-past the threshold counts.
 * Moving backward records nothing, and moving forward again from below the
 * threshold counts once more, because that genuinely is a second booking.
 */

export type CrmEventKind =
  | 'prospect_contacted'
  | 'meeting_booked'
  | 'lead_added'
  | 'deal_won'

/** Stage order, by index in the canonical list. */
const stageRank = (stage: Stage): number => STAGES.indexOf(stage)

/**
 * True when a move goes from below `threshold` to at-or-above it.
 *
 * 'Lost' sits after 'Won' in STAGES but is not "further along" in any real
 * sense; it is excluded so marking a deal Lost cannot look like progress.
 */
function crossedInto(from: Stage, to: Stage, threshold: Stage): boolean {
  if (to === 'Lost') return false
  const bar = stageRank(threshold)
  return stageRank(from) < bar && stageRank(to) >= bar
}

/**
 * Which events a single stage transition produces.
 *
 * A jump straight from New to Meeting Booked crosses the Contacted threshold
 * too, and records both — the prospect genuinely was contacted, the CRM just
 * never saw an intermediate click.
 */
export function eventsForStageChange(from: Stage, to: Stage): CrmEventKind[] {
  if (from === to) return []

  const kinds: CrmEventKind[] = []
  if (crossedInto(from, to, 'Contacted')) kinds.push('prospect_contacted')
  if (crossedInto(from, to, 'Meeting Booked')) kinds.push('meeting_booked')
  // Won is a specific arrival rather than a threshold crossing: re-entering it
  // from Lost is a real re-close and should count again.
  if (to === 'Won' && from !== 'Won') kinds.push('deal_won')
  return kinds
}

export interface RecordEventInput {
  kind: CrmEventKind
  subjectId?: string
  colleague?: ColleagueId
  detail?: Record<string, unknown>
}

/**
 * Appends events. Never throws.
 *
 * Activity logging must not be able to fail a CRM write: a dropped event costs
 * a number on a board, while a rejected write costs the user their edit. The
 * failure is logged and swallowed.
 */
export async function recordEvents(events: RecordEventInput[]): Promise<void> {
  if (events.length === 0) return

  try {
    const { error } = await getSupabase()
      .from('crm_events')
      .insert(
        events.map((event) => ({
          kind: event.kind,
          subject_id: event.subjectId ?? null,
          colleague: event.colleague ?? null,
          detail: event.detail ?? {},
        }))
      )

    if (error) throw new Error(error.message)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    console.error('[khyte] activity event not recorded:', message)
  }
}
