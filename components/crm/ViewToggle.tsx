'use client'

import { Table2, Kanban } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ViewMode = 'table' | 'board'

interface ViewToggleProps {
  view: ViewMode
  onChange: (view: ViewMode) => void
}

export function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center bg-surface rounded-lg p-0.5 border border-border">
      <button
        onClick={() => onChange('table')}
        className={cn(
          'flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] font-medium transition-all duration-150',
          view === 'table'
            ? 'bg-surface-raised text-foreground border border-border-accent'
            : 'text-muted hover:text-muted-foreground border border-transparent'
        )}
      >
        <Table2 size={12} />
        Table
      </button>
      <button
        onClick={() => onChange('board')}
        className={cn(
          'flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] font-medium transition-all duration-150',
          view === 'board'
            ? 'bg-surface-raised text-foreground border border-border-accent'
            : 'text-muted hover:text-muted-foreground border border-transparent'
        )}
      >
        <Kanban size={12} />
        Board
      </button>
    </div>
  )
}
