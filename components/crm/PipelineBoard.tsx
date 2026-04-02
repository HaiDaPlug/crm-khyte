'use client'

import { useState } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragOverEvent,
  closestCorners,
  DragStartEvent,
  useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { LeadCard } from './LeadCard'
import { Opportunity, Company, Contact, Stage } from '@/lib/types'
import { cn } from '@/lib/utils'

const STAGES: Stage[] = [
  'New', 'Researched', 'Contacted', 'Warm',
  'Meeting Booked', 'Proposal Sent', 'Negotiation', 'Won', 'Lost'
]

const stageConfig: Record<Stage, { accent: string; dot: string }> = {
  'New': { accent: 'border-border', dot: 'bg-muted' },
  'Researched': { accent: 'border-blue-500/20', dot: 'bg-blue-400' },
  'Contacted': { accent: 'border-sky-500/20', dot: 'bg-sky-400' },
  'Warm': { accent: 'border-orange-500/20', dot: 'bg-orange-400' },
  'Meeting Booked': { accent: 'border-violet-500/20', dot: 'bg-violet-400' },
  'Proposal Sent': { accent: 'border-amber-500/20', dot: 'bg-amber-400' },
  'Negotiation': { accent: 'border-yellow-500/20', dot: 'bg-yellow-400' },
  'Won': { accent: 'border-success/20', dot: 'bg-success' },
  'Lost': { accent: 'border-danger/20', dot: 'bg-danger' },
}

export interface PipelineRow {
  opportunity: Opportunity
  company: Company
  contact: Contact
}

interface ColumnProps {
  stage: Stage
  cards: PipelineRow[]
  onCardClick: (row: PipelineRow) => void
  isOver: boolean
}

function PipelineColumn({ stage, cards, onCardClick, isOver }: ColumnProps) {
  const { setNodeRef } = useDroppable({ id: stage })
  const config = stageConfig[stage]

  return (
    <div className={cn(
      'flex flex-col border rounded-xl overflow-hidden shrink-0 w-[224px] transition-all duration-200',
      config.accent,
      'bg-surface',
      isOver && 'ring-1 ring-accent/30 border-accent/40'
    )}>
      <div className="px-3 py-2.5 border-b border-border-subtle bg-surface-raised/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn('w-2 h-2 rounded-full', config.dot)} />
            <span className="text-[12px] font-medium text-foreground">{stage}</span>
          </div>
          <span className="text-[10px] font-mono text-muted bg-background-raised px-1.5 py-0.5 rounded-md">
            {cards.length}
          </span>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 p-2 space-y-2 min-h-[120px] transition-colors duration-150',
          'bg-background/30',
          isOver && 'bg-accent-light'
        )}
      >
        <SortableContext
          items={cards.map(c => c.opportunity.id)}
          strategy={verticalListSortingStrategy}
        >
          {cards.map(card => (
            <LeadCard
              key={card.opportunity.id}
              opportunity={card.opportunity}
              company={card.company}
              contact={card.contact}
              onClick={() => onCardClick(card)}
            />
          ))}
        </SortableContext>

        {cards.length === 0 && (
          <div className="h-16 flex items-center justify-center">
            <p className={cn(
              'text-[11px] transition-colors duration-150',
              isOver ? 'text-accent' : 'text-muted/30'
            )}>
              {isOver ? 'Drop here' : 'Empty'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

interface PipelineBoardProps {
  rows: PipelineRow[]
  onCardClick: (row: PipelineRow) => void
  onStageChange?: (opportunityId: string, newStage: Stage) => void
}

export function PipelineBoard({ rows, onCardClick, onStageChange }: PipelineBoardProps) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>(
    rows.map(r => r.opportunity)
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overStage, setOverStage] = useState<string | null>(null)

  const getCardsByStage = (stage: Stage): PipelineRow[] => {
    return opportunities
      .filter(o => o.stage === stage)
      .map(opp => {
        const original = rows.find(r => r.opportunity.id === opp.id)!
        return { ...original, opportunity: opp }
      })
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event
    if (!over) {
      setOverStage(null)
      return
    }
    const overId = over.id as string
    const targetStage = STAGES.find(s => s === overId)
    if (targetStage) {
      setOverStage(targetStage)
    } else {
      const targetOpp = opportunities.find(o => o.id === overId)
      if (targetOpp) setOverStage(targetOpp.stage)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    setOverStage(null)

    if (!over) return

    const draggedId = active.id as string
    const overId = over.id as string
    const targetStage = STAGES.find(s => s === overId)

    let newStage: Stage | undefined
    if (targetStage) {
      newStage = targetStage
    } else {
      const targetOpp = opportunities.find(o => o.id === overId)
      if (targetOpp) newStage = targetOpp.stage
    }

    if (newStage) {
      setOpportunities(prev =>
        prev.map(opp =>
          opp.id === draggedId ? { ...opp, stage: newStage! } : opp
        )
      )
      onStageChange?.(draggedId, newStage)
    }
  }

  const activeRow = activeId ? rows.find(r => r.opportunity.id === activeId) : null
  const activeOpp = activeId ? opportunities.find(o => o.id === activeId) : null

  return (
    <DndContext
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4 min-h-[calc(100vh-160px)]">
        {STAGES.map(stage => (
          <PipelineColumn
            key={stage}
            stage={stage}
            cards={getCardsByStage(stage)}
            onCardClick={onCardClick}
            isOver={overStage === stage && activeId !== null}
          />
        ))}
      </div>

      <DragOverlay>
        {activeRow && activeOpp ? (
          <div className="rotate-2 opacity-90 scale-105">
            <LeadCard
              opportunity={activeOpp}
              company={activeRow.company}
              contact={activeRow.contact}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
