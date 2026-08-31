import { weekStart } from '@/lib/db/board-metrics'

/**
 * Groups a `goal`-family target date into the same bucket the timeline and
 * (for its top three) the wallpaper show it under.
 *
 * The grouping gets coarser the further out the date sits, because that is
 * how the date actually gets used: something due in six weeks or less is
 * tracked week by week, something due later this year is tracked by quarter,
 * and "sometime next year" only ever needs the year. Producing "Vecka 41" for
 * a goal eight months out would be false precision — nobody is watching it
 * week-to-week yet. There is no separate month-level bucket: any date inside
 * the current calendar month is by definition within 31 days, which the
 * ≤42-day week bucket always catches first.
 *
 * Swedish literals, matching the rest of the goals feature — see
 * GoalsEditor.tsx and DisplayBoard.tsx, neither of which is wired into
 * lib/i18n/ yet (documented in docs/current_state.md).
 */

/** The bucket a goal sorts and groups under, plus its display label. */
export interface GoalPeriod {
  /** Sortable ascending — "no deadline" gets a value past any real date. */
  sortKey: string
  label: string
}

export const NO_DEADLINE_SORT_KEY = '9999-99-99'
export const NO_DEADLINE_LABEL = 'Ingen deadline'

/** ISO week number (Monday-start), ISO year, for the "Vecka NN, YYYY" label.
 *  Built off `weekStart` rather than reimplementing Monday-alignment — see
 *  lib/db/board-metrics.ts for why the week always starts on Monday here. */
function isoWeek(date: Date): { week: number; year: number } {
  const monday = weekStart(date)
  // ISO week 1 is the week containing the year's first Thursday, which is the
  // same as the Monday-aligned week containing Jan 4th.
  const thursday = new Date(monday)
  thursday.setDate(thursday.getDate() + 3)
  const isoYear = thursday.getFullYear()

  const jan4 = new Date(isoYear, 0, 4)
  const jan4Monday = weekStart(jan4)
  const week = Math.round((monday.getTime() - jan4Monday.getTime()) / (7 * 86_400_000)) + 1

  return { week, year: isoYear }
}

/**
 * Buckets a target date relative to `now`.
 *
 * Thresholds: within ~6 weeks groups by week (the thing you are actually
 * chasing day to day), within the current year groups by quarter, anything
 * further out groups by year alone.
 */
export function goalPeriodFor(targetDate: string | undefined, now: Date): GoalPeriod {
  if (!targetDate) {
    return { sortKey: NO_DEADLINE_SORT_KEY, label: NO_DEADLINE_LABEL }
  }

  const target = new Date(`${targetDate}T00:00:00`)
  if (Number.isNaN(target.getTime())) {
    return { sortKey: NO_DEADLINE_SORT_KEY, label: NO_DEADLINE_LABEL }
  }

  const days = Math.floor((target.getTime() - now.getTime()) / 86_400_000)
  const sameYear = target.getFullYear() === now.getFullYear()

  if (Math.abs(days) <= 42) {
    const { week, year } = isoWeek(target)
    return { sortKey: `${year}-W${String(week).padStart(2, '0')}`, label: `Vecka ${week}` }
  }

  if (sameYear) {
    const quarter = Math.floor(target.getMonth() / 3) + 1
    return { sortKey: `${target.getFullYear()}-Q${quarter}`, label: `Q${quarter} ${target.getFullYear()}` }
  }

  return { sortKey: `${target.getFullYear()}`, label: `${target.getFullYear()}` }
}
