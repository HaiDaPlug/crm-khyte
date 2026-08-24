'use client'

import { Table2, Kanban } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

export type ViewMode = 'table' | 'board'

interface ViewToggleProps {
  view: ViewMode
  onChange: (view: ViewMode) => void
}

export function ViewToggle({ view, onChange }: ViewToggleProps) {
  const { t } = useTranslations()
  return (
    <div
      role="group"
      aria-label={`${t.crm.view.table} / ${t.crm.view.board}`}
      className="flex w-full items-center rounded-lg border border-border bg-surface p-0.5 sm:w-auto"
    >
      <button
        type="button"
        onClick={() => onChange('table')}
        aria-pressed={view === 'table'}
        className={cn(
          'flex h-11 min-w-0 flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-md px-3.5 text-[14px] font-medium transition-all duration-150 sm:h-8 sm:flex-none',
          view === 'table'
            ? 'bg-surface-raised text-foreground border border-border-accent'
            : 'text-foreground/60 hover:text-foreground border border-transparent'
        )}
      >
        <Table2 size={14} />
        {t.crm.view.table}
      </button>
      <button
        type="button"
        onClick={() => onChange('board')}
        aria-pressed={view === 'board'}
        className={cn(
          'flex h-11 min-w-0 flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-md px-3.5 text-[14px] font-medium transition-all duration-150 sm:h-8 sm:flex-none',
          view === 'board'
            ? 'bg-surface-raised text-foreground border border-border-accent'
            : 'text-foreground/60 hover:text-foreground border border-transparent'
        )}
      >
        <Kanban size={14} />
        {t.crm.view.board}
      </button>
    </div>
  )
}
