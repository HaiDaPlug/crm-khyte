'use client'

import { useState } from 'react'
import { Filter, X, ChevronDown } from 'lucide-react'
import { Stage, Priority } from '@/lib/types'
import { cn } from '@/lib/utils'
import { priorityDot } from '@/lib/stage-config'
import { useTranslations } from '@/lib/hooks/useTranslations'

const stages: Stage[] = ['New', 'Researched', 'Contacted', 'Warm', 'Meeting Booked', 'Proposal Sent', 'Negotiation', 'Won', 'Lost']
const priorities: Priority[] = ['critical', 'high', 'medium', 'low']

interface FilterBarProps {
  selectedStages: Stage[]
  selectedPriorities: Priority[]
  onStageChange: (stages: Stage[]) => void
  onPriorityChange: (priorities: Priority[]) => void
}

export function FilterBar({ selectedStages, selectedPriorities, onStageChange, onPriorityChange }: FilterBarProps) {
  const { t } = useTranslations()
  const [open, setOpen] = useState(false)

  const toggleStage = (stage: Stage) => {
    if (selectedStages.includes(stage)) {
      onStageChange(selectedStages.filter(s => s !== stage))
    } else {
      onStageChange([...selectedStages, stage])
    }
  }

  const togglePriority = (priority: Priority) => {
    if (selectedPriorities.includes(priority)) {
      onPriorityChange(selectedPriorities.filter(p => p !== priority))
    } else {
      onPriorityChange([...selectedPriorities, priority])
    }
  }

  const hasFilters = selectedStages.length > 0 || selectedPriorities.length > 0
  const filterCount = selectedStages.length + selectedPriorities.length

  const clearFilters = () => {
    onStageChange([])
    onPriorityChange([])
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            'flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-medium transition-all border',
            hasFilters
              ? 'bg-accent text-background border-accent'
              : open
                ? 'bg-foreground text-background border-foreground'
                : 'bg-surface text-muted-foreground border-border hover:border-border-accent'
          )}
        >
          <Filter size={14} />
          {t.crm.filter.filter}
          {hasFilters && (
            <span className="bg-background/20 text-[11px] font-bold min-w-[19px] h-[19px] rounded-full flex items-center justify-center ml-0.5 tabular-nums">
              {filterCount}
            </span>
          )}
          <ChevronDown size={13} className={cn('transition-transform', open && 'rotate-180')} />
        </button>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 h-9 px-3 rounded-lg text-[13px] text-foreground/65 hover:text-foreground transition-colors"
          >
            <X size={13} />
            {t.crm.filter.clearAll}
          </button>
        )}

        {hasFilters && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {selectedStages.map(stage => (
              <button
                key={stage}
                onClick={() => toggleStage(stage)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-surface-raised text-[12.5px] font-medium text-foreground/85 border border-border hover:border-border-accent transition-colors"
              >
                {t.stages[stage]}
                <X size={11} className="text-foreground/60" />
              </button>
            ))}
            {selectedPriorities.map(priority => (
              <button
                key={priority}
                onClick={() => togglePriority(priority)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-surface-raised text-[12.5px] font-medium text-foreground/85 border border-border hover:border-border-accent transition-colors capitalize"
              >
                <span className="w-2 h-2 rounded-full" style={{ background: priorityDot[priority] }} />
                {t.priorities[priority]}
                <X size={11} className="text-foreground/60" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={cn(
        'overflow-hidden transition-all duration-200 ease-out',
        open ? 'max-h-[240px] opacity-100 mt-3' : 'max-h-0 opacity-0 mt-0'
      )}>
        <div className="p-4 bg-surface border border-border rounded-xl flex flex-wrap gap-6 animate-fade-in">
          <div>
            <p className="label-mono mb-2.5">{t.crm.filter.stage}</p>
            <div className="flex flex-wrap gap-1.5">
              {stages.map(stage => (
                <button
                  key={stage}
                  onClick={() => toggleStage(stage)}
                  className={cn(
                    'h-8 px-3 rounded-lg text-[12.5px] font-medium transition-all border',
                    selectedStages.includes(stage)
                      ? 'bg-accent text-background border-accent'
                      : 'bg-transparent text-muted-foreground border-border hover:border-border-accent'
                  )}
                >
                  {t.stages[stage]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label-mono mb-2.5">{t.crm.filter.priority}</p>
            <div className="flex flex-wrap gap-1.5">
              {priorities.map(priority => (
                <button
                  key={priority}
                  onClick={() => togglePriority(priority)}
                  className={cn(
                    'h-8 px-3 rounded-lg text-[12.5px] font-medium transition-all border capitalize flex items-center gap-1.5',
                    selectedPriorities.includes(priority)
                      ? 'bg-accent text-background border-accent'
                      : 'bg-transparent text-muted-foreground border-border hover:border-border-accent'
                  )}
                >
                  <span
                    className={cn('w-2 h-2 rounded-full', selectedPriorities.includes(priority) && 'bg-background/60')}
                    style={selectedPriorities.includes(priority) ? undefined : { background: priorityDot[priority] }}
                  />
                  {t.priorities[priority]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
