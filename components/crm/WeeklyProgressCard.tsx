'use client'

import { useEffect, useState } from 'react'
import type { CrmEventKind, WeeklyProgress } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

/**
 * This week's progress on one non-negotiable, shown where the work happens.
 *
 * The targets live on /goals and are read, never set, here: one place defines
 * "how many leads a week", so this card, the direction editor and the wallpaper
 * cannot drift apart. A page asks for the metric it is about — /leads for
 * `lead_added`, /prospects for `prospect_contacted` — and the card renders
 * nothing at all if no weekly goal is bound to that metric, rather than
 * inventing a target or showing a bare count with no bar to fill.
 *
 * The number is team-wide, matching what `weeklyCounts` has always meant on the
 * board. It counts events, not current state: prospects contacted this week
 * stays true after they progress or go Lost.
 */

/** Module-level cache so navigating between the two pages doesn't refetch. */
let cached: WeeklyProgress | null = null

interface WeeklyProgressCardProps {
  /** Which non-negotiable this page is about. */
  metricKind: CrmEventKind
  className?: string
}

export function WeeklyProgressCard({ metricKind, className }: WeeklyProgressCardProps) {
  const { t } = useTranslations()
  const [progress, setProgress] = useState<WeeklyProgress | null>(cached)

  useEffect(() => {
    let alive = true

    const load = async () => {
      try {
        const res = await fetch('/api/goals/weekly', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as WeeklyProgress
        cached = data
        if (alive) setProgress(data)
      } catch {
        // A card that fails to load is a card that isn't drawn. This is
        // ambient encouragement, not data the operator is working from — it
        // must never take a working page down with it.
      }
    }

    load()
    // Picks up outreach logged in another tab, and rolls the week over without
    // a reload. Deliberately slow: nothing here changes second to second.
    const timer = setInterval(load, 60_000)

    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  if (!progress) return null

  // The first weekly goal bound to this metric. More than one would be a
  // config the editor allows but the card has no way to choose between.
  const goal = progress.goals.find((g) => g.metricKind === metricKind)
  if (!goal || goal.metricTarget === undefined) return null

  const actual = progress.counts[metricKind] ?? 0
  const target = goal.metricTarget
  const hit = actual >= target
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface px-4 py-3',
        hit && 'border-success/40',
        className
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="label-mono truncate">{goal.title}</p>
        <p className="shrink-0 font-mono text-[14px] tabular-nums">
          <span className={cn('font-semibold', hit ? 'text-success' : 'text-foreground')}>
            {actual}
          </span>
          <span className="text-foreground/50">/{target}</span>
        </p>
      </div>

      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-background-raised"
        role="progressbar"
        aria-valuenow={actual}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-label={`${goal.title}: ${actual} ${t.weeklyProgress.of} ${target}`}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500 ease-out',
            hit ? 'bg-success' : 'bg-accent'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
