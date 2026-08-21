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
    <div className="flex items-center bg-surface rounded-lg p-0.5 border border-border">
      <button
        onClick={() => onChange('table')}
        className={cn(
          'flex items-center gap-1.5 h-8 px-3.5 rounded-md text-[13px] font-medium transition-all duration-150',
          view === 'table'
            ? 'bg-surface-raised text-foreground border border-border-accent'
            : 'text-foreground/60 hover:text-foreground border border-transparent'
        )}
      >
        <Table2 size={14} />
        {t.crm.view.table}
      </button>
      <button
        onClick={() => onChange('board')}
        className={cn(
          'flex items-center gap-1.5 h-8 px-3.5 rounded-md text-[13px] font-medium transition-all duration-150',
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
