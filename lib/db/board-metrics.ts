import 'server-only'

import { getDb } from './pg'

/**
 * The board's numbers, computed rather than typed.
 *
 * Two kinds, and the distinction is the whole design:
 *
 *   CURRENT STATE — intäkt, kunder, pipeline. Recomputed from `opportunities`
 *   on every read. Moving a deal out of Won lowers revenue again, because the
 *   number describes how things stand, not what once happened. No log involved.
 *
 *   EVENTS — meetings booked, prospects reached out, leads added. Counted from
 *   `crm_events` within the current week. "We booked three meetings" stays true
 *   after all three go to Lost, because it describes something that happened.
 *
 * Getting these two the wrong way round is the easy mistake: a revenue figure
 * counted from events would never fall, and a meeting counter read from current
 * stages would drop every time a deal progressed past Meeting Booked.
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
