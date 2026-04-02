'use client'

import { useState } from 'react'
import { Filter, X, ChevronDown } from 'lucide-react'
import { Stage, Priority } from '@/lib/types'
import { cn } from '@/lib/utils'

const stages: Stage[] = ['New', 'Researched', 'Contacted', 'Warm', 'Meeting Booked', 'Proposal Sent', 'Negotiation', 'Won', 'Lost']
const priorities: Priority[] = ['critical', 'high', 'medium', 'low']

const priorityDots: Record<Priority, string> = {
  critical: 'bg-red-500',
  high: 'bg-accent',
  medium: 'bg-blue-400',
  low: 'bg-muted',
}

interface FilterBarProps {
  selectedStages: Stage[]
  selectedPriorities: Priority[]
  onStageChange: (stages: Stage[]) => void
  onPriorityChange: (priorities: Priority[]) => void
}

export function FilterBar({ selectedStages, selectedPriorities, onStageChange, onPriorityChange }: FilterBarProps) {
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
            'flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-[12px] font-medium transition-all border',
            hasFilters
              ? 'bg-accent text-background border-accent'
              : open
                ? 'bg-foreground text-background border-foreground'
                : 'bg-surface text-muted-foreground border-border hover:border-border-accent'
          )}
        >
          <Filter size={12} />
          Filter
          {hasFilters && (
            <span className="bg-white/20 text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center ml-0.5">
              {filterCount}
            </span>
          )}
          <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
        </button>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 h-8 px-2.5 rounded-lg text-[12px] text-muted hover:text-foreground transition-colors"
          >
            <X size={11} />
            Clear all
          </button>
        )}

        {hasFilters && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {selectedStages.map(stage => (
              <button
                key={stage}
                onClick={() => toggleStage(stage)}
                className="flex items-center gap-1 h-7 px-2.5 rounded-lg bg-surface-raised text-[11px] font-medium text-muted-foreground border border-border hover:border-border-accent transition-colors"
              >
                {stage}
                <X size={9} className="text-muted" />
              </button>
            ))}
            {selectedPriorities.map(priority => (
              <button
                key={priority}
                onClick={() => togglePriority(priority)}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-surface-raised text-[11px] font-medium text-muted-foreground border border-border hover:border-border-accent transition-colors capitalize"
              >
                <span className={cn('w-1.5 h-1.5 rounded-full', priorityDots[priority])} />
                {priority}
                <X size={9} className="text-muted" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={cn(
        'overflow-hidden transition-all duration-200 ease-out',
        open ? 'max-h-[200px] opacity-100 mt-3' : 'max-h-0 opacity-0 mt-0'
      )}>
        <div className="p-4 bg-surface border border-border rounded-xl flex flex-wrap gap-6 animate-fade-in">
          <div>
            <p className="label-mono mb-2.5">Stage</p>
            <div className="flex flex-wrap gap-1.5">
              {stages.map(stage => (
                <button
                  key={stage}
                  onClick={() => toggleStage(stage)}
                  className={cn(
                    'h-7 px-2.5 rounded-lg text-[11px] font-medium transition-all border',
                    selectedStages.includes(stage)
                      ? 'bg-accent text-background border-accent'
                      : 'bg-transparent text-muted-foreground border-border hover:border-border-accent'
                  )}
                >
                  {stage}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label-mono mb-2.5">Priority</p>
            <div className="flex flex-wrap gap-1.5">
              {priorities.map(priority => (
                <button
                  key={priority}
                  onClick={() => togglePriority(priority)}
                  className={cn(
                    'h-7 px-2.5 rounded-lg text-[11px] font-medium transition-all border capitalize flex items-center gap-1.5',
                    selectedPriorities.includes(priority)
                      ? 'bg-accent text-background border-accent'
                      : 'bg-transparent text-muted-foreground border-border hover:border-border-accent'
                  )}
                >
                  <span className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    selectedPriorities.includes(priority) ? 'bg-background/60' : priorityDots[priority]
                  )} />
                  {priority}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
