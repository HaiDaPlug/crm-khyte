import type { Goal } from '@/lib/types'

/**
 * Resolves one goal's number, the single way every surface resolves it.
 *
 * Every goal on the board is "X of Y" — that is the whole model, and the only
 * thing that varies is where X comes from:
 *
 *   COUNTED — `metricKind` is set, so X is this week's tally of that event
 *   kind from crm_events. A weekly non-negotiable cannot drift from what the
 *   CRM recorded, and it resets on Monday because the window moves.
 *
 *   TYPED — no `metricKind`, so X is `metricCurrent`, entered by hand. "Tre
 *   externa bolag: 1 av 3" is a fact the CRM has no way to know; it is still a
 *   count, and it is still checkable.
 *
 * What is deliberately gone is the third case: a bare `progress` percentage
 * with no denominator. See 20260915120000_goal_metric_current.sql — the column
 * still exists and still holds its old values, but nothing resolves against it.
 *
 * Lives here rather than in each renderer because GoalsEditor, DisplayBoard and
 * the timeline all have to agree about the same goal. They previously each
 * carried their own copy of this expression, which is exactly the drift the
 * weekly progress cards were built to avoid.
 */
export interface GoalMeasurement {
  /** The X. Counted from events, typed by hand, or 0 when neither is set. */
  current: number
  /** The Y, or undefined for a goal nobody put a number on. */
  target?: number
  /**
   * Whether to draw a bar.
   *
   * A target of 0 is excluded on purpose: it is not a goal you have met, it is
   * a goal with no scale, and dividing by it gives Infinity. No bar means "not
   * measured", which is the honest reading — the same rule the wallpaper's
   * `Bar` has always documented.
   */
  measured: boolean
  /** Target set and reached. False whenever there is no target to reach. */
  hit: boolean
  /** 0–100, clamped by the caller's bar. Meaningless unless `measured`. */
  percent: number
}

export function measureGoal(
  goal: Goal,
  counts: Record<string, number>
): GoalMeasurement {
  const current = goal.metricKind
    ? (counts[goal.metricKind] ?? 0)
    : (goal.metricCurrent ?? 0)

  const target = goal.metricTarget
  const measured = target !== undefined && target > 0

  return {
    current,
    target,
    measured,
    hit: target !== undefined && current >= target,
    percent: measured ? (current / (target as number)) * 100 : 0,
  }
}
