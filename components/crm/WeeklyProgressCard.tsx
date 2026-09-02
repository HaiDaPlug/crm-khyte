'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import type { ColleagueId, CrmEventKind, WeeklyProgress } from '@/lib/types'
import { COLLEAGUE_IDS, colleagues } from '@/lib/colleagues'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

/**
 * Progress on one non-negotiable, shown where the work happens.
 *
 * Two periods, and the difference is deliberate:
 *
 *   WEEK — measured against the target set on /goals. The targets are read,
 *   never set, here: one place defines "how many leads a week", so this card,
 *   the direction editor and the wallpaper cannot drift apart. Renders nothing
 *   if no weekly goal is bound to the metric, rather than inventing a target.
 *
 *   DAY — a bare tally with no target and no bar. A weekly number divided by
 *   five is a figure nobody agreed to, and a morning that starts slowly is not
 *   a day being failed. It always renders, including at zero.
 *
 * Both open a per-person breakdown on click. Picking someone narrows the card to
 * their number and is lifted to the page, so the table below follows — one
 * notion of "looking at Erik" rather than two that can disagree.
 *
 * Counts come from the event log and are attributed by the colleague recorded on
 * each event, not by the prospect's current owner: reassigning a prospect must
 * not move last week's calls between people.
 */

/**
 * Module-level cache, shared by every card on the page.
 *
 * Both cards read the same payload, so the fetch is hoisted here rather than run
 * per card — two cards would otherwise poll the same endpoint on their own
 * timers.
 */
let cached: WeeklyProgress | null = null
const subscribers = new Set<(p: WeeklyProgress) => void>()
let polling = false

async function refresh() {
  try {
    const res = await fetch('/api/goals/weekly', { cache: 'no-store' })
    if (!res.ok) return
    const data = (await res.json()) as WeeklyProgress
    cached = data
    subscribers.forEach((fn) => fn(data))
  } catch {
    // A card that fails to load is a card that isn't drawn. This is ambient
    // encouragement, not data being worked from — it must never take a page
    // down with it.
  }
}

function useWeeklyProgress(): WeeklyProgress | null {
  const [progress, setProgress] = useState<WeeklyProgress | null>(cached)

  useEffect(() => {
    subscribers.add(setProgress)
    refresh()

    if (!polling) {
      polling = true
      const timer = setInterval(refresh, 60_000)
      return () => {
        subscribers.delete(setProgress)
        clearInterval(timer)
        polling = false
      }
    }

    return () => {
      subscribers.delete(setProgress)
    }
  }, [])

  return progress
}

/** `unassigned` included — see countEventsByColleagueSince. */
type BreakdownKey = ColleagueId | 'unassigned'

interface CardProps {
  metricKind: CrmEventKind
  /** Whose numbers to show; null is the whole team. Owned by the page. */
  colleague: ColleagueId | null
  onColleagueChange: (next: ColleagueId | null) => void
  className?: string
}

/**
 * The shared shell: label, number, optional bar, and the breakdown popover.
 *
 * One component behind both cards so the two can never drift in behaviour —
 * only the number, the bar and the label differ.
 */
function CountCard({
  label,
  actual,
  target,
  breakdown,
  colleague,
  onColleagueChange,
  className,
}: {
  label: string
  actual: number
  /** Undefined for the day card — no target means no bar and no green state. */
  target?: number
  breakdown: Record<string, number>
  colleague: ColleagueId | null
  onColleagueChange: (next: ColleagueId | null) => void
  className?: string
}) {
  const { t } = useTranslations()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const hit = target !== undefined && actual >= target
  const pct = target !== undefined && target > 0
    ? Math.min(100, Math.round((actual / target) * 100))
    : 0

  // Everyone with activity, biggest first, plus the unattributed bucket last —
  // it is a caveat on the total rather than a person to compare against.
  const rows = (
    [...COLLEAGUE_IDS, 'unassigned'] as BreakdownKey[]
  )
    .map((id) => ({ id, n: breakdown[id] ?? 0 }))
    .filter((r) => r.n > 0 || r.id !== 'unassigned')
    .sort((a, b) =>
      a.id === 'unassigned' ? 1 : b.id === 'unassigned' ? -1 : b.n - a.n
    )

  const label_ = colleague ? colleagues[colleague].name : label

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'w-full rounded-xl border bg-surface px-4 py-3 text-left transition-colors',
          'hover:border-border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          hit ? 'border-success/40' : 'border-border',
          colleague && 'border-accent/50'
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1">
            <span className="label-mono min-w-0 truncate">{label_}</span>
            <ChevronDown
              size={11}
              aria-hidden="true"
              className={cn('shrink-0 text-foreground/40 transition-transform', open && 'rotate-180')}
            />
          </span>
          <span className="shrink-0 font-mono text-[14px] tabular-nums">
            <span className={cn('font-semibold', hit ? 'text-success' : 'text-foreground')}>
              {actual}
            </span>
            {target !== undefined && <span className="text-foreground/50">/{target}</span>}
          </span>
        </div>

        {target !== undefined ? (
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-background-raised"
            role="progressbar"
            aria-valuenow={actual}
            aria-valuemin={0}
            aria-valuemax={target}
            aria-label={`${label_}: ${actual} ${t.weeklyProgress.of} ${target}`}
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-500 ease-out',
                hit ? 'bg-success' : 'bg-accent'
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : (
          // Keeps both cards the same height without the day pretending to
          // have a target to fill.
          <div className="mt-2 h-1.5" aria-hidden="true" />
        )}
      </button>

      {/* The active person, as a removable tag. Clearing it puts the card back
          to the team total — and, because the page owns this, un-narrows the
          table with it. */}
      {colleague && (
        <button
          type="button"
          onClick={() => onColleagueChange(null)}
          aria-label={t.weeklyProgress.showAll}
          className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-surface-raised text-foreground/70 transition-colors hover:border-danger/50 hover:text-danger"
        >
          <X size={11} />
        </button>
      )}

      {open && (
        <div
          id={panelId}
          className="absolute right-0 top-[calc(100%+6px)] z-30 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
        >
          <button
            type="button"
            onClick={() => {
              onColleagueChange(null)
              setOpen(false)
            }}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors hover:bg-surface-raised',
              colleague === null && 'bg-surface-raised'
            )}
          >
            <span className="text-foreground/85">{t.weeklyProgress.everyone}</span>
            <span className="font-mono text-[13px] font-semibold tabular-nums text-foreground">
              {actual >= 0 && colleague === null
                ? actual
                : Object.values(breakdown).reduce((a, b) => a + b, 0)}
            </span>
          </button>

          {rows.map((row) => {
            const isPerson = row.id !== 'unassigned'
            const person = isPerson ? colleagues[row.id as ColleagueId] : null
            return (
              <button
                key={row.id}
                type="button"
                // The unattributed bucket names no one, so there is nobody to
                // filter to — it is shown for the arithmetic, not as a choice.
                disabled={!isPerson}
                onClick={() => {
                  if (!isPerson) return
                  onColleagueChange(
                    colleague === row.id ? null : (row.id as ColleagueId)
                  )
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors',
                  isPerson ? 'hover:bg-surface-raised' : 'cursor-default opacity-60',
                  colleague === row.id && 'bg-surface-raised'
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {person ? (
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{ background: person.color }}
                      aria-hidden="true"
                    >
                      {person.name.charAt(0)}
                    </span>
                  ) : (
                    <span className="size-5 shrink-0 rounded-full border border-dashed border-border" aria-hidden="true" />
                  )}
                  <span className="truncate text-foreground/85">
                    {person ? person.name : t.weeklyProgress.unassigned}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-foreground">
                  {row.n}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** This week's count against the target set on /goals. */
export function WeeklyProgressCard({
  metricKind,
  colleague,
  onColleagueChange,
  className,
}: CardProps) {
  const { t } = useTranslations()
  const progress = useWeeklyProgress()

  if (!progress) return null

  const goal = progress.goals.find((g) => g.metricKind === metricKind)
  if (!goal || goal.metricTarget === undefined) return null

  const breakdown = progress.byColleague[metricKind] ?? {}
  const actual = colleague
    ? (breakdown[colleague] ?? 0)
    : (progress.counts[metricKind] ?? 0)

  return (
    <CountCard
      label={t.weeklyProgress.week}
      actual={actual}
      // The target stays the team's even when narrowed to one person: it is a
      // team goal, and silently dividing it by three would invent a per-person
      // target nobody set.
      target={goal.metricTarget}
      breakdown={breakdown}
      colleague={colleague}
      onColleagueChange={onColleagueChange}
      className={className}
    />
  )
}

/** Today's tally for the same metric — no target, no bar. */
export function DailyCountCard({
  metricKind,
  colleague,
  onColleagueChange,
  className,
}: CardProps) {
  const { t } = useTranslations()
  const progress = useWeeklyProgress()

  if (!progress) return null

  const breakdown = progress.todayByColleague[metricKind] ?? {}
  const actual = colleague
    ? (breakdown[colleague] ?? 0)
    : (progress.today[metricKind] ?? 0)

  return (
    <CountCard
      label={t.weeklyProgress.today}
      actual={actual}
      breakdown={breakdown}
      colleague={colleague}
      onColleagueChange={onColleagueChange}
      className={className}
    />
  )
}
