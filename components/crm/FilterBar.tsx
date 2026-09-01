'use client'

import { useId, useState } from 'react'
import { Filter, X, ChevronDown } from 'lucide-react'
import { Stage, Priority } from '@/lib/types'
import { cn } from '@/lib/utils'
import { STAGES, priorityDot } from '@/lib/stage-config'
import { useTranslations } from '@/lib/hooks/useTranslations'

const stages = STAGES
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
  const panelId = useId()
  const stageLabelId = useId()
  const priorityLabelId = useId()

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
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={panelId}
          className={cn(
            'flex h-11 flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-lg border px-4 text-[14px] font-medium transition-all sm:h-9 sm:flex-none',
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
            <span className="bg-background/20 text-[12px] font-bold min-w-[19px] h-[19px] rounded-full flex items-center justify-center ml-0.5 tabular-nums">
              {filterCount}
            </span>
          )}
          <ChevronDown size={13} className={cn('transition-transform', open && 'rotate-180')} />
        </button>

        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex h-11 touch-manipulation items-center gap-1 rounded-lg px-3 text-[14px] text-foreground/65 transition-colors hover:text-foreground sm:h-9"
          >
            <X size={13} />
            {t.crm.filter.clearAll}
          </button>
        )}

        {hasFilters && (
          <div
            aria-label={t.crm.filter.filter}
            className="order-last flex w-full items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:order-none sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0"
          >
            {selectedStages.map(stage => (
              <button
                key={stage}
                type="button"
                onClick={() => toggleStage(stage)}
                className="flex h-11 shrink-0 touch-manipulation items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 text-[13.5px] font-medium text-foreground/85 transition-colors hover:border-border-accent sm:h-8"
              >
                {t.stages[stage]}
                <X size={11} className="text-foreground/60" />
              </button>
            ))}
            {selectedPriorities.map(priority => (
              <button
                key={priority}
                type="button"
                onClick={() => togglePriority(priority)}
                className="flex h-11 shrink-0 touch-manipulation items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 text-[13.5px] font-medium capitalize text-foreground/85 transition-colors hover:border-border-accent sm:h-8"
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
        open ? 'max-h-[720px] opacity-100 mt-3 sm:max-h-[360px]' : 'max-h-0 opacity-0 mt-0'
      )}
        id={panelId}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-4 animate-fade-in sm:flex-row sm:flex-wrap sm:gap-6">
          <div className="min-w-0 flex-1">
            <p id={stageLabelId} className="label-mono mb-2.5">{t.crm.filter.stage}</p>
            <div role="group" aria-labelledby={stageLabelId} className="flex flex-wrap gap-2 sm:gap-1.5">
              {stages.map(stage => (
                <button
                  key={stage}
                  type="button"
                  aria-pressed={selectedStages.includes(stage)}
                  onClick={() => toggleStage(stage)}
                  className={cn(
                    'h-11 touch-manipulation rounded-lg border px-3 text-[13.5px] font-medium transition-all sm:h-8',
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

          <div className="min-w-0">
            <p id={priorityLabelId} className="label-mono mb-2.5">{t.crm.filter.priority}</p>
            <div role="group" aria-labelledby={priorityLabelId} className="flex flex-wrap gap-2 sm:gap-1.5">
              {priorities.map(priority => (
                <button
                  key={priority}
                  type="button"
                  aria-pressed={selectedPriorities.includes(priority)}
                  onClick={() => togglePriority(priority)}
                  className={cn(
                    'flex h-11 touch-manipulation items-center gap-1.5 rounded-lg border px-3 text-[13.5px] font-medium capitalize transition-all sm:h-8',
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
