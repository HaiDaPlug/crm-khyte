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
 * Where a deal is considered to start.
 *
 * A prospect created directly at `Contacted` has, as far as the log is
 * concerned, crossed everything between here and there — the CRM simply never
 * saw the intermediate clicks. Measuring arrival from the front of the pipeline
 * is what lets creation and dragging produce the same events.
 */
export const PIPELINE_START: Stage = STAGES[0]

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
/**
 * The events a deal arriving at `to` produces, ready to record.
 *
 * Wraps eventsForStageChange with the recording policy both callers need, so
 * the two paths into `Contacted` cannot drift apart:
 *
 *   - a card dragged from an earlier stage (updateOpportunity), and
 *   - a prospect created already at that stage (createOpportunity).
 *
 * The second is how this team actually works — prospects are added to the CRM
 * *after* being contacted, born at `Contacted` with the date filled in, rather
 * than added at `New` and moved later. Creation recorded nothing at all before,
 * which is why a day of outreach could show up as zero.
 *
 * `occurredOn` dates the whole batch, so adding a prospect you called last
 * Tuesday files the contact in last Tuesday's week rather than today's.
 */
export function eventsForArrival(
  from: Stage,
  to: Stage,
  context: { subjectId: string; colleague?: ColleagueId; occurredOn?: string }
): RecordEventInput[] {
  return eventsForStageChange(from, to).map((kind) => ({
    kind,
    subjectId: context.subjectId,
    colleague: context.colleague,
    detail: { from, to },
    occurredOn: context.occurredOn || undefined,
    // Only this kind. The same outreach gets reported twice — by the stage the
    // prospect is filed under and by "senaste kontakt" — whereas a deal can
    // genuinely reach Meeting Booked and Won on one day, and neither of those
    // has a second gesture that also reports it.
    oncePerDay: kind === 'prospect_contacted',
  }))
}

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
  /**
   * When it happened, as `YYYY-MM-DD`. Defaults to now.
   *
   * For a touch the operator dates themselves — logging on Thursday that they
   * called on Tuesday — the week the event belongs to is Tuesday's, not the
   * week it was typed in. The column exists for exactly this; see the note on
   * `occurred_at` in the crm_events migration.
   */
  occurredOn?: string
  /**
   * Drop this event if one of the same kind is already on the log for the same
   * subject on the same day.
   *
   * Opt-in rather than automatic, because it is only right for the kinds two
   * different gestures can both report. See `prospect_contacted` in
   * app/actions/crm.ts: moving a card into Contacted and filling in "senaste
   * kontakt" are the same outreach described twice, and a counter that reads 2
   * because someone did both is worse than useless.
   */
  oncePerDay?: boolean
}

/**
 * Midnight local on the day a `YYYY-MM-DD` string names, or on `now`.
 *
 * Parsed field-by-field rather than through `new Date(string)`, which reads a
 * bare date as UTC midnight — west of Greenwich that lands on the previous
 * local day and files the touch in the wrong week. Local is also what
 * weekStart() and isoDate() in ./board-metrics use, so the whole feature agrees
 * on where a day begins.
 */
function dayStart(occurredOn?: string): Date {
  if (!occurredOn) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today
  }

  const [year, month, day] = occurredOn.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * Whether this kind is already recorded for this subject on this day.
 *
 * A read before an append, which the log's append-only rule permits: the rule
 * forbids editing history, not declining to write the same fact twice.
 *
 * Fails open — a check that errors reports "not recorded" and the event is
 * written. The insert this accompanies has already succeeded, so the database
 * is up and a failure here is an anomaly rather than an outage; under-counting
 * the week is the exact failure this feature exists to prevent, while a stray
 * duplicate is visible on the board and can be reasoned about.
 */
async function alreadyRecorded(
  kind: CrmEventKind,
  subjectId: string,
  start: Date
): Promise<boolean> {
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  try {
    const { data, error } = await getSupabase()
      .from('crm_events')
      .select('id')
      .eq('kind', kind)
      .eq('subject_id', subjectId)
      .gte('occurred_at', start.toISOString())
      .lt('occurred_at', end.toISOString())
      .limit(1)

    if (error) throw new Error(error.message)
    return (data?.length ?? 0) > 0
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    console.error('[khyte] duplicate-event check failed, recording anyway:', message)
    return false
  }
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
    // Resolved once per event so the dedupe window and the stored timestamp
    // are the same instant — checking one day and writing another would let
    // duplicates straight through.
    const dated = events.map((event) => ({ event, start: dayStart(event.occurredOn) }))

    const keep: typeof dated = []
    // Guards the batch against itself. The database check below cannot see a
    // sibling in this same array — neither is written yet — so one update
    // carrying both a move into Contacted and a "senaste kontakt" for today
    // would pass it twice and insert two. No caller does that today; this is
    // what stops the next one from double-counting silently.
    const seen = new Set<string>()

    for (const entry of dated) {
      // Nothing to compare a subject-less event against, so it always writes.
      if (entry.event.oncePerDay && entry.event.subjectId) {
        const key = `${entry.event.kind}:${entry.event.subjectId}:${entry.start.getTime()}`
        if (seen.has(key)) continue
        if (await alreadyRecorded(entry.event.kind, entry.event.subjectId, entry.start)) {
          continue
        }
        seen.add(key)
      }
      keep.push(entry)
    }

    if (keep.length === 0) return

    const { error } = await getSupabase()
      .from('crm_events')
      .insert(
        keep.map(({ event, start }) => ({
          kind: event.kind,
          subject_id: event.subjectId ?? null,
          colleague: event.colleague ?? null,
          detail: event.detail ?? {},
          // Left to the column default when undated, so "now" stays the
          // database's clock rather than the web server's.
          ...(event.occurredOn ? { occurred_at: start.toISOString() } : {}),
        }))
      )

    if (error) throw new Error(error.message)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    console.error('[khyte] activity event not recorded:', message)
  }
}
