import 'server-only'

import { getDb } from './pg'

/**
 * The board's numbers, computed rather than typed.
 *
 * Two kinds, and the distinction is the whole design:
 *
 *   CURRENT STATE — intäkt, kunder, pipeline, and (despite living under the
 *   'meeting_booked' metric key) möten bokade. Recomputed from `opportunities`
 *   on every read. Moving a deal out of Won lowers revenue again, exactly as
 *   moving a card out of Meeting Booked lowers that count again — the number
 *   describes how things stand, not what once happened. No log involved.
 *
 *   EVENTS — prospects reached out, leads added. Counted from `crm_events`
 *   within the current week. "We contacted twelve prospects" stays true even
 *   after some of them go to Lost, because it describes something that
 *   happened, not where things stand now.
 *
 * meeting_booked used to be an EVENT — see loadMeetingsBookedNow for why it
 * moved. The `crm_events` rows for it are still written (lib/db/events.ts)
 * and still feed the export's dated history; they are simply no longer what
 * the live weekly card reads. Getting the two kinds the wrong way round is
 * the easy mistake elsewhere: a revenue figure counted from events would
 * never fall, and prospects-contacted read from current stages would drop
 * every time one progressed past Contacted.
 */

/** Monday 00:00 local, the start of the week a moment belongs to. */
export function weekStart(now: Date): Date {
  const start = new Date(now)
  // getDay(): 0 = Sunday. Shift so Monday is day 0 and Sunday closes the week.
  const daysSinceMonday = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - daysSinceMonday)
  start.setHours(0, 0, 0, 0)
  return start
}

/** `YYYY-MM-DD` for a Date, in local terms — matches the `date` columns. */
export function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export interface DerivedTotals {
  /** Summed value of deals currently at Won. */
  revenue: number
  /** Count of deals currently at Won. */
  customers: number
  /** Summed value of open deals on the board — not Won, not Lost. */
  pipeline: number
}

/**
 * The bottom row: revenue, customers, open pipeline.
 *
 * One pass over `opportunities` with a filtered aggregate rather than three
 * queries. `deal_value` is nullable, so every sum is coalesced — a Won deal
 * with no value counts toward customers but contributes nothing to revenue,
 * which is the honest reading.
 */
export async function loadDerivedTotals(): Promise<DerivedTotals> {
  const sql = getDb()

  const [row] = await sql`
    select
      coalesce(sum(deal_value) filter (where stage = 'Won'), 0)          as revenue,
      count(*)                 filter (where stage = 'Won')              as customers,
      coalesce(
        sum(deal_value) filter (where in_pipeline and stage not in ('Won', 'Lost')),
        0
      )                                                                  as pipeline
    from opportunities
  `

  const r = row as unknown as Record<string, string | number>
  return {
    revenue: Number(r.revenue),
    customers: Number(r.customers),
    pipeline: Number(r.pipeline),
  }
}

/**
 * How many opportunities are sitting at 'Meeting Booked' right now.
 *
 * Deliberately current state, not an event tally: the operator reading the
 * "Möten bokade" card wants it to agree with what the pipeline board shows in
 * that column at the same moment, not a running total of bookings made this
 * week regardless of what happened to them since. A card booked and then
 * walked back to Kontaktad should stop counting immediately, the same way a
 * deal leaving Won immediately lowers revenue in loadDerivedTotals above.
 *
 * `meeting_booked` events are still recorded (lib/db/events.ts) for the
 * export's dated history, but nothing here reads them — this is a straight
 * count of `opportunities.stage`.
 */
export async function loadMeetingsBookedNow(): Promise<number> {
  const sql = getDb()

  const [row] = await sql`
    select count(*) as total from opportunities where stage = 'Meeting Booked'
  `
  return Number((row as unknown as { total: string | number }).total)
}

/**
 * The same count, split by who currently owns each card.
 *
 * Attributed by `opportunities.followed_up_by` — the current owner — rather
 * than by colleague on a past event, because there is no "who booked it"
 * event this reads at all. A card with no owner falls under `unassigned`,
 * matching how `countEventsByColleagueSince` treats an event with none.
 */
export async function loadMeetingsBookedNowByColleague(): Promise<Record<string, number>> {
  const sql = getDb()

  // followed_up_by is the crm_colleague enum, not text — coalescing it
  // straight against the 'unassigned' literal fails with "invalid input value
  // for enum crm_colleague" because Postgres tries to read the literal as
  // that enum first. Casting to text before the coalesce is what
  // countEventsByColleagueSince gets for free, since crm_events.colleague is
  // already plain text.
  const rows = await sql`
    select coalesce(followed_up_by::text, 'unassigned') as who, count(*) as total
    from opportunities
    where stage = 'Meeting Booked'
    group by followed_up_by
  `

  const byWho: Record<string, number> = {}
  for (const row of rows as unknown as Array<{ who: string; total: string | number }>) {
    byWho[row.who] = Number(row.total)
  }
  return byWho
}

/**
 * How many events of each kind happened since `since`.
 *
 * Returns a plain map so a caller can look up a kind it has no rows for and get
 * 0 rather than undefined — a non-negotiable with no activity yet must render
 * as "0 of 15", not as missing.
 */
export async function countEventsSince(since: Date): Promise<Record<string, number>> {
  const sql = getDb()

  const rows = await sql`
    select kind, count(*) as total
    from crm_events
    where occurred_at >= ${since.toISOString()}
    group by kind
  `

  const counts: Record<string, number> = {}
  for (const row of rows as unknown as Array<{ kind: string; total: string | number }>) {
    counts[row.kind] = Number(row.total)
  }
  return counts
}

/**
 * The same counts, split by who did the work.
 *
 * Attributed by `crm_events.colleague`, recorded when the event happened, rather
 * than by the opportunity's current `followedUpBy`. The log is a record of what
 * each person did; reassigning a prospect must not silently move last week's
 * calls from one person to another.
 *
 * Events with no colleague are counted under the `unassigned` key rather than
 * dropped — roughly a tenth of the log has none, and omitting them would leave
 * a breakdown that visibly fails to add up to the total beside it.
 */
export async function countEventsByColleagueSince(
  since: Date
): Promise<Record<string, Record<string, number>>> {
  const sql = getDb()

  const rows = await sql`
    select kind, coalesce(colleague, 'unassigned') as who, count(*) as total
    from crm_events
    where occurred_at >= ${since.toISOString()}
    group by kind, colleague
  `

  const byKind: Record<string, Record<string, number>> = {}
  for (const row of rows as unknown as Array<{
    kind: string
    who: string
    total: string | number
  }>) {
    byKind[row.kind] ??= {}
    byKind[row.kind][row.who] = Number(row.total)
  }
  return byKind
}

/** Events of each kind within a half-open window — `[from, to)`. */
export async function countEventsBetween(
  from: Date,
  to: Date
): Promise<Record<string, number>> {
  const sql = getDb()

  const rows = await sql`
    select kind, count(*) as total
    from crm_events
    where occurred_at >= ${from.toISOString()}
      and occurred_at <  ${to.toISOString()}
    group by kind
  `

  const counts: Record<string, number> = {}
  for (const row of rows as unknown as Array<{ kind: string; total: string | number }>) {
    counts[row.kind] = Number(row.total)
  }
  return counts
}

/** One non-negotiable's result for a finished week. */
export interface ArchivedCount {
  kind: string
  title: string
  target: number | null
  actual: number
}

/**
 * Freezes every week that has ended and is not yet archived.
 *
 * Runs on read rather than on a schedule. There is no cron in this app, and a
 * wallpaper that reloads all day is a more reliable trigger than one — the
 * first load after midnight on Monday closes the previous week. Catching up
 * several weeks at once is the same loop, so a laptop that was shut for a
 * fortnight still archives correctly rather than losing the gap.
 *
 * The counts could be recomputed from crm_events forever, and mostly they can
 * be. The target cannot: "12 of 15 meetings" needs the 15 that was in force
 * that week, and that number lives on a goal row the operator is free to change
 * next Monday. Freezing both is what makes a past week still mean what it meant.
 *
 * Idempotent by the unique index on week_start — a concurrent second call
 * conflicts and does nothing rather than writing a duplicate week.
 */
export async function archiveFinishedWeeks(now: Date): Promise<number> {
  const sql = getDb()

  // The earliest activity is where history starts; with no events there is
  // nothing to archive and no reason to touch the table.
  const [earliest] = await sql`
    select min(occurred_at) as first_event from crm_events
  `
  const first = (earliest as unknown as { first_event: string | null })?.first_event
  if (!first) return 0

  const currentWeek = weekStart(now)
  let cursor = weekStart(new Date(first))
  let archived = 0

  // Walk whole weeks from the first event up to (not including) this one.
  while (cursor < currentWeek) {
    const next = new Date(cursor)
    next.setDate(next.getDate() + 7)

    const already = await sql`
      select 1 from weekly_snapshots where week_start = ${isoDate(cursor)} limit 1
    `
    if (already.length === 0) {
      const counts = await countEventsBetween(cursor, next)

      // The targets as they stand now. Imperfect for a week archived late —
      // a target changed since then is the one recorded — but the alternative
      // is versioning every goal row, which is far more machinery than a
      // three-person scoreboard warrants.
      const goals = await sql`
        select title, metric_kind, metric_target
        from goals
        where section = 'weekly' and metric_kind is not null
        order by sort_order
      `

      const rows = goals as unknown as Array<{
        title: string
        metric_kind: string
        metric_target: number | null
      }>

      const payload: ArchivedCount[] = rows.map((goal) => ({
        kind: goal.metric_kind,
        title: goal.title,
        target: goal.metric_target,
        actual: counts[goal.metric_kind] ?? 0,
      }))

      await sql`
        insert into weekly_snapshots (week_start, counts)
        values (${isoDate(cursor)}, ${JSON.stringify(payload)}::jsonb)
        on conflict (week_start) do nothing
      `
      archived += 1
    }

    cursor = next
  }

  return archived
}
