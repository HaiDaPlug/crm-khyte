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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus } from 'lucide-react'
import { StrategyCard, StrategyColumn } from '@/lib/types'
import { cn } from '@/lib/utils'

const COLUMNS: StrategyColumn[] = [
  'Pain Points', 'Stakeholders', 'Objections',
  'Offer Angle', 'Proof', 'Next Actions'
]

const columnConfig: Record<StrategyColumn, { accent: string; icon: string }> = {
  'Pain Points': { accent: 'border-red-500/20', icon: '⚡' },
  'Stakeholders': { accent: 'border-blue-500/20', icon: '👥' },
  'Objections': { accent: 'border-orange-500/20', icon: '🛡' },
  'Offer Angle': { accent: 'border-violet-500/20', icon: '💡' },
  'Proof': { accent: 'border-success/20', icon: '✓' },
  'Next Actions': { accent: 'border-accent/20', icon: '→' },
}

function SortableStrategyCard({ card }: { card: StrategyCard }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'bg-surface border border-border rounded-lg p-2.5 text-[12px] text-foreground leading-relaxed',
        'cursor-grab active:cursor-grabbing select-none',
        'hover:border-border-accent transition-all duration-150',
        isDragging && 'opacity-30 shadow-md'
      )}
    >
      {card.content}
    </div>
  )
}

interface StrategyColumnViewProps {
  column: StrategyColumn
  cards: StrategyCard[]
  isOver: boolean
  onAddCard: (column: StrategyColumn, content: string) => void
}

function StrategyColumnView({ column, cards, isOver, onAddCard }: StrategyColumnViewProps) {
  const { setNodeRef } = useDroppable({ id: column })
  const config = columnConfig[column]
  const [adding, setAdding] = useState(false)
  const [newContent, setNewContent] = useState('')

  const handleAdd = () => {
    if (newContent.trim()) {
      onAddCard(column, newContent.trim())
      setNewContent('')
      setAdding(false)
    }
  }

  return (
    <div className={cn(
      'flex flex-col border rounded-xl overflow-hidden w-[200px] shrink-0 transition-all duration-200',
      config.accent,
      'bg-surface',
      isOver && 'ring-1 ring-accent/30 border-accent/40'
    )}>
      <div className="px-3 py-2.5 border-b border-border-subtle bg-surface-raised/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px]">{config.icon}</span>
            <span className="text-[12px] font-medium text-foreground">{column}</span>
          </div>
          <span className="text-[10px] font-mono text-muted bg-background-raised px-1.5 py-0.5 rounded-md">
            {cards.length}
          </span>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 p-2 space-y-1.5 min-h-[100px] bg-background/30 transition-colors duration-150',
          isOver && 'bg-accent-light'
        )}
      >
        <SortableContext items={cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map(card => (
            <SortableStrategyCard key={card.id} card={card} />
          ))}
        </SortableContext>

        {cards.length === 0 && !adding && (
          <div className="h-12 flex items-center justify-center">
            <p className={cn(
              'text-[11px] transition-colors',
              isOver ? 'text-accent' : 'text-muted/30'
            )}>
              {isOver ? 'Drop here' : 'Drop here'}
            </p>
          </div>
        )}

        {adding ? (
          <div className="animate-fade-in">
            <textarea
              autoFocus
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd() }
                if (e.key === 'Escape') { setAdding(false); setNewContent('') }
              }}
              placeholder="Type and press Enter..."
              className="w-full text-[12px] p-2 bg-surface border border-border rounded-lg resize-none outline-none focus:border-accent/40 placeholder:text-muted text-foreground"
              rows={2}
            />
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] text-muted hover:text-muted-foreground rounded-lg hover:bg-surface-raised transition-colors"
          >
            <Plus size={10} />
            Add
          </button>
        )}
      </div>
    </div>
  )
}

interface StrategyBoardProps {
  cards: StrategyCard[]
  opportunityId: string
  onAddCard?: (card: StrategyCard) => void
}

export function StrategyBoard({ cards: initialCards, opportunityId, onAddCard }: StrategyBoardProps) {
  const [cards, setCards] = useState<StrategyCard[]>(initialCards)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<string | null>(null)

  const getCardsByColumn = (column: StrategyColumn) =>
    cards.filter(c => c.column === column).sort((a, b) => a.order - b.order)

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event
    if (!over) { setOverColumn(null); return }
    const overId = over.id as string
    const targetCol = COLUMNS.find(c => c === overId)
    if (targetCol) {
      setOverColumn(targetCol)
    } else {
      const targetCard = cards.find(c => c.id === overId)
      if (targetCard) setOverColumn(targetCard.column)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    setOverColumn(null)
    if (!over) return

    const activeCardId = active.id as string
    const overId = over.id as string
    const targetColumn = COLUMNS.find(c => c === overId)

    if (targetColumn) {
      setCards(prev =>
        prev.map(card =>
          card.id === activeCardId ? { ...card, column: targetColumn } : card
        )
      )
    } else {
      const targetCard = cards.find(c => c.id === overId)
      if (targetCard) {
        setCards(prev =>
          prev.map(card =>
            card.id === activeCardId
              ? { ...card, column: targetCard.column, order: targetCard.order }
              : card
          )
        )
      }
    }
  }

  const handleAddCard = (column: StrategyColumn, content: string) => {
    const newCard: StrategyCard = {
      id: `s-${Date.now()}`,
      opportunityId,
      column,
      content,
      order: getCardsByColumn(column).length,
    }
    setCards(prev => [...prev, newCard])
    onAddCard?.(newCard)
  }

  const activeCard = activeId ? cards.find(c => c.id === activeId) : null

  return (
    <DndContext
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map(column => (
          <StrategyColumnView
            key={column}
            column={column}
            cards={getCardsByColumn(column)}
            isOver={overColumn === column && activeId !== null}
            onAddCard={handleAddCard}
          />
        ))}
      </div>

      <DragOverlay>
        {activeCard ? (
          <div className="bg-surface border border-accent/30 rounded-lg p-2.5 text-[12px] text-foreground leading-relaxed shadow-lg rotate-1 w-[200px]">
            {activeCard.content}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
