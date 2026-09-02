'use client'

import { Flame, CalendarClock, CalendarCheck } from 'lucide-react'
import type { ColleagueId } from '@/lib/types'
import { COLLEAGUE_IDS, colleagues } from '@/lib/colleagues'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

/**
 * One-tap answers to the questions actually asked of this table, above the
 * stage/priority panel rather than inside it.
 *
 * These are presets over the same rows the filter panel narrows, not a second
 * filtering system: a chip and the panel compose, so "Heta" plus a stage filter
 * means both. Each is a question with an obvious answer — who is behind on
 * follow-ups, what did we touch this week — that previously took opening a
 * panel and ticking several boxes.
 *
 * There is deliberately no "Mina" chip. The app has one shared password and no
 * accounts (see the auth gate), so nothing knows who is looking; a "mine" that
 * silently meant one hardcoded person would be worse than its absence. Filtering
 * by colleague is explicit instead — the avatar row below.
 */

export type QuickFilter = 'thisWeek' | 'needsFollowUp' | 'hot'

interface QuickFiltersProps {
  active: QuickFilter[]
  onChange: (next: QuickFilter[]) => void
  colleague: ColleagueId | null
  onColleagueChange: (next: ColleagueId | null) => void
  className?: string
}

const CHIPS: Array<{ id: QuickFilter; icon: typeof Flame }> = [
  { id: 'thisWeek', icon: CalendarCheck },
  { id: 'needsFollowUp', icon: CalendarClock },
  { id: 'hot', icon: Flame },
]

export function QuickFilters({
  active,
  onChange,
  colleague,
  onColleagueChange,
  className,
}: QuickFiltersProps) {
  const { t } = useTranslations()

  const toggle = (id: QuickFilter) => {
    onChange(active.includes(id) ? active.filter((f) => f !== id) : [...active, id])
  }

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible sm:pb-0',
        className
      )}
    >
      {CHIPS.map(({ id, icon: Icon }) => {
        const on = active.includes(id)
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(id)}
            className={cn(
              'flex h-11 shrink-0 touch-manipulation items-center gap-1.5 rounded-lg border px-3 text-[13.5px] font-medium transition-all sm:h-9',
              on
                ? 'border-accent bg-accent text-background'
                : 'border-border bg-surface text-muted-foreground hover:border-border-accent'
            )}
          >
            <Icon size={13} aria-hidden="true" />
            {t.quickFilters[id]}
          </button>
        )
      })}

      {/* Hairline between the presets and the person filter — they answer
          different questions and shouldn't read as one row of equals. */}
      <span className="mx-1 h-6 w-px shrink-0 bg-border-subtle" aria-hidden="true" />

      {COLLEAGUE_IDS.map((id) => {
        const on = colleague === id
        const person = colleagues[id]
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            // Selecting the active one clears it — the row doubles as its own
            // "all" control, so there is no fourth chip to explain.
            onClick={() => onColleagueChange(on ? null : id)}
            className={cn(
              'flex h-11 shrink-0 touch-manipulation items-center gap-1.5 rounded-lg border pl-1.5 pr-3 text-[13.5px] font-medium transition-all sm:h-9',
              on
                ? 'border-accent bg-accent text-background'
                : 'border-border bg-surface text-muted-foreground hover:border-border-accent'
            )}
          >
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
              style={{ background: person.color }}
              aria-hidden="true"
            >
              {person.name.charAt(0)}
            </span>
            {person.name}
          </button>
        )
      })}
    </div>
  )
}
