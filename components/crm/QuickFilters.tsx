'use client'

import { Flame, CalendarClock, CalendarCheck } from 'lucide-react'
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
 * Filtering by person lives on the count cards instead, which show each
 * person's number as well as filtering by them. There is no "Mina" preset: the
 * app has one shared password and no accounts (see the auth gate), so nothing
 * knows who is looking, and a "mine" that silently meant one hardcoded person
 * would be worse than its absence.
 */

export type QuickFilter = 'thisWeek' | 'needsFollowUp' | 'hot'

interface QuickFiltersProps {
  active: QuickFilter[]
  onChange: (next: QuickFilter[]) => void
  className?: string
}

const CHIPS: Array<{ id: QuickFilter; icon: typeof Flame }> = [
  { id: 'thisWeek', icon: CalendarCheck },
  { id: 'needsFollowUp', icon: CalendarClock },
  { id: 'hot', icon: Flame },
]

export function QuickFilters({ active, onChange, className }: QuickFiltersProps) {
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

      {/* The per-colleague chips that used to sit here are gone. The count
          cards' breakdown does the same filtering *and* shows each person's
          number, so two person-filters on one screen was duplication that could
          also visibly disagree. Selecting someone there still narrows this
          table — the page owns that state. */}
    </div>
  )
}
