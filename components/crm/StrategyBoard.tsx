'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragOverEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  DragStartEvent,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, ChevronRight, Plus, X } from 'lucide-react'
import { StrategyCard, StrategyColumn } from '@/lib/types'
import { useCRMStore } from '@/lib/store'
import { cn, newId } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

/**
 * Lane colours are positional, not semantic. Headlines are free text, so there
 * is nothing to key a colour off — the palette only keeps adjacent lanes
 * visually separable, and repeats past six.
 */
const LANE_ACCENTS = [
  { border: 'border-red-500/20', dot: 'bg-red-500/50' },
  { border: 'border-blue-500/20', dot: 'bg-blue-500/50' },
  { border: 'border-orange-500/20', dot: 'bg-orange-500/50' },
  { border: 'border-violet-500/20', dot: 'bg-violet-500/50' },
  { border: 'border-success/20', dot: 'bg-success/50' },
  { border: 'border-accent/20', dot: 'bg-accent/50' },
]

const laneAccent = (index: number) => LANE_ACCENTS[index % LANE_ACCENTS.length]

/** Keeps the phone-only edge cue in sync with the native horizontal scroller. */
function useForwardScrollAffordance(
  ref: React.RefObject<HTMLDivElement | null>,
  contentKey: number
) {
  const [canScrollForward, setCanScrollForward] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const update = () => {
      setCanScrollForward(el.scrollWidth - el.scrollLeft - el.clientWidth > 8)
    }

    const frame = requestAnimationFrame(update)
    const observer = new ResizeObserver(update)
    observer.observe(el)
    el.addEventListener('scroll', update, { passive: true })

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [contentKey, ref])

  return canScrollForward
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
        'min-h-11 touch-manipulation select-none rounded-xl border border-border bg-surface p-3.5 text-[14.5px] leading-snug text-foreground/85 [-webkit-touch-callout:none]',
        'cursor-grab active:cursor-grabbing',
        'transition-all duration-150 active:border-border-accent focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 sm:hover:border-border-accent',
        isDragging && 'opacity-30 shadow-md'
      )}
    >
      {card.content}
    </div>
  )
}

interface StrategyColumnViewProps {
  column: StrategyColumn
  index: number
  cards: StrategyCard[]
  isOver: boolean
  onAddCard: (columnId: string, content: string) => void
  onRename: (columnId: string, title: string) => void
  onDelete: (columnId: string) => void
}

function StrategyColumnView({
  column,
  index,
  cards,
  isOver,
  onAddCard,
  onRename,
  onDelete,
}: StrategyColumnViewProps) {
  const { t } = useTranslations()
  const { setNodeRef } = useDroppable({ id: column.id })
  const accent = laneAccent(index)
  const [adding, setAdding] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(column.title)
  // Deleting a headline takes its cards with it, so the button asks first.
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const handleAdd = () => {
    if (newContent.trim()) {
      onAddCard(column.id, newContent.trim())
      setNewContent('')
      setAdding(false)
    }
  }

  const commitRename = () => {
    const next = title.trim()
    if (next && next !== column.title) onRename(column.id, next)
    else setTitle(column.title)
    setRenaming(false)
  }

  return (
    <div className={cn(
      'group/lane flex w-[calc(100%-2rem)] max-w-[300px] shrink-0 snap-start snap-always flex-col overflow-hidden rounded-xl border transition-all duration-200',
      'sm:w-[200px] sm:max-w-none sm:snap-normal',
      accent.border,
      'bg-surface',
      isOver && 'ring-1 ring-accent/30 border-accent/40'
    )}>
      <div className="px-3 py-2.5 border-b border-border-subtle bg-surface-raised/50">
        <div className="flex items-center justify-between gap-1.5">
          {renaming ? (
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                if (e.key === 'Escape') { setTitle(column.title); setRenaming(false) }
              }}
              className="min-h-11 w-full min-w-0 border-b border-accent/40 bg-transparent pb-px text-base font-semibold text-foreground outline-none sm:min-h-0 sm:text-[15px]"
            />
          ) : (
            <>
              <button
                type="button"
                onClick={() => { setTitle(column.title); setRenaming(true) }}
                title={t.strategy.renameHeadline}
                className="flex min-h-11 min-w-0 flex-1 touch-manipulation items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 sm:min-h-0"
              >
                <span className={cn('size-1.5 rounded-full shrink-0', accent.dot)} />
                <span className="text-[15px] font-semibold text-foreground truncate">
                  {column.title}
                </span>
              </button>

              <div className="flex items-center gap-1 shrink-0">
                {confirmingDelete ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onDelete(column.id)}
                      className="flex min-h-11 touch-manipulation items-center gap-1 rounded-md px-1.5 text-[13px] text-danger transition-colors active:bg-danger-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 sm:min-h-0 sm:px-0 sm:hover:text-danger/80"
                    >
                      <Check size={16} className="sm:size-[11px]" />
                      {t.strategy.confirmDelete}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                      aria-label={t.common.cancel}
                      className="flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-md text-foreground/60 transition-colors active:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 sm:size-5 sm:hover:text-foreground"
                    >
                      <X size={16} className="sm:size-[11px]" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-[13px] font-mono text-foreground/60 tabular-nums">
                      {cards.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(true)}
                      title={t.strategy.deleteHeadline}
                      aria-label={t.strategy.deleteHeadline}
                      className={cn(
                        'flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-md text-foreground/60 transition-all active:bg-danger-muted active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 sm:size-5 sm:hover:text-danger',
                        'opacity-100 sm:opacity-0 sm:group-hover/lane:opacity-100 sm:focus-visible:opacity-100'
                      )}
                    >
                      <X size={16} className="sm:size-3" />
                    </button>
                  </>
                )}
              </div>
            </>
          )}
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
              'text-[13.5px] transition-colors',
              isOver ? 'text-accent' : 'text-foreground/60'
            )}>
              {t.crm.board.dropHere}
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
              placeholder={t.crm.board.typeAndEnter}
              className="w-full resize-none rounded-lg border border-border bg-surface p-3 text-base text-foreground outline-none placeholder:text-foreground/45 focus:border-accent/40 sm:text-[14.5px]"
              rows={2}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-11 w-full touch-manipulation items-center justify-center gap-1.5 rounded-lg py-2 text-[13.5px] text-foreground/60 transition-colors active:bg-surface-raised active:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 sm:min-h-0 sm:hover:bg-surface-raised sm:hover:text-foreground"
          >
            <Plus size={15} className="sm:size-2.5" />
            {t.common.add}
          </button>
        )}
      </div>
    </div>
  )
}

/** The dashed lane at the end of the board that becomes a new headline. */
function AddHeadlineLane({ onAdd }: { onAdd: (title: string) => void }) {
  const { t } = useTranslations()
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')

  const commit = () => {
    if (title.trim()) onAdd(title.trim())
    setTitle('')
    setAdding(false)
  }

  if (adding) {
    return (
      <div className="w-[calc(100vw-4rem)] max-w-[300px] shrink-0 snap-start snap-always rounded-xl border border-accent/40 bg-surface px-3 py-2.5 animate-fade-in sm:w-[200px] sm:max-w-none sm:snap-normal">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { setTitle(''); setAdding(false) }
          }}
          placeholder={t.strategy.headlinePlaceholder}
          className="min-h-11 w-full bg-transparent text-base font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-foreground/45 sm:min-h-0 sm:text-[15px]"
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setAdding(true)}
      className={cn(
        'flex min-h-[104px] w-[calc(100vw-4rem)] max-w-[300px] shrink-0 snap-start snap-always touch-manipulation items-center justify-center gap-1.5 sm:w-[200px] sm:max-w-none sm:snap-normal',
        'border border-dashed border-border-subtle rounded-xl text-[13.5px] text-foreground/60',
        'transition-all active:border-border-accent active:bg-surface/50 active:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 sm:hover:border-border-accent sm:hover:bg-surface/50 sm:hover:text-foreground/80'
      )}
    >
      <Plus size={16} className="sm:size-3" />
      {t.strategy.addHeadline}
    </button>
  )
}

interface StrategyBoardProps {
  opportunityId: string
}

export function StrategyBoard({ opportunityId }: StrategyBoardProps) {
  const { t } = useTranslations()
  const allColumns = useCRMStore((s) => s.strategyColumns)
  const allCards = useCRMStore((s) => s.strategyCards)
  const addStrategyColumn = useCRMStore((s) => s.addStrategyColumn)
  const renameStrategyColumn = useCRMStore((s) => s.renameStrategyColumn)
  const removeStrategyColumn = useCRMStore((s) => s.removeStrategyColumn)
  const addStrategyCard = useCRMStore((s) => s.addStrategyCard)
  const moveStrategyCard = useCRMStore((s) => s.moveStrategyCard)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<string | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const columns = useMemo(
    () =>
      allColumns
        .filter((k) => k.opportunityId === opportunityId)
        .sort((a, b) => a.order - b.order),
    [allColumns, opportunityId]
  )

  const cardsByColumn = useMemo(() => {
    const byColumn = new Map<string, StrategyCard[]>(columns.map((k) => [k.id, []]))
    for (const card of allCards) {
      byColumn.get(card.columnId)?.push(card)
    }
    for (const lane of byColumn.values()) lane.sort((a, b) => a.order - b.order)
    return byColumn
  }, [allCards, columns])
  const canScrollForward = useForwardScrollAffordance(boardRef, columns.length)

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event
    if (!over) { setOverColumn(null); return }
    const overId = over.id as string
    if (cardsByColumn.has(overId)) {
      setOverColumn(overId)
    } else {
      const targetCard = allCards.find((c) => c.id === overId)
      if (targetCard) setOverColumn(targetCard.columnId)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    setOverColumn(null)
    if (!over) return

    const activeCardId = active.id as string
    const overId = over.id as string

    // Dropped on a lane — file it at the end of that lane.
    if (cardsByColumn.has(overId)) {
      moveStrategyCard(activeCardId, overId)
      return
    }

    // Dropped on another card — take that card's place.
    const targetCard = allCards.find((c) => c.id === overId)
    if (!targetCard || targetCard.id === activeCardId) return
    const lane = (cardsByColumn.get(targetCard.columnId) ?? []).filter(
      (c) => c.id !== activeCardId
    )
    moveStrategyCard(
      activeCardId,
      targetCard.columnId,
      Math.max(lane.indexOf(targetCard), 0)
    )
  }

  const handleDragCancel = () => {
    setActiveId(null)
    setOverColumn(null)
  }

  const handleAddColumn = (title: string) => {
    addStrategyColumn({
      id: newId(),
      opportunityId,
      title,
      order: columns.length,
    })
  }

  const handleAddCard = (columnId: string, content: string) => {
    addStrategyCard({
      id: newId(),
      opportunityId,
      columnId,
      content,
      order: cardsByColumn.get(columnId)?.length ?? 0,
    })
  }

  const activeCard = activeId ? allCards.find((c) => c.id === activeId) : null

  // A deal starts with an empty board — the first headline is the whole ask.
  if (columns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-14 px-6 border border-dashed border-border rounded-xl bg-surface/40 animate-fade-in">
        <h3 className="text-[17px] font-jakarta font-semibold text-foreground tracking-[-0.01em]">
          {t.strategy.emptyBoardTitle}
        </h3>
        <p className="mt-2 max-w-[460px] text-[14.5px] text-foreground/60 leading-relaxed">
          {t.strategy.emptyBoardBody}
        </p>
        <div className="mt-5">
          <AddHeadlineLane onAdd={handleAddColumn} />
        </div>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="relative">
        <div
          ref={boardRef}
          className={cn(
            'flex min-h-0 items-start gap-3 overflow-x-auto overscroll-x-contain pb-4 pr-8 touch-manipulation',
            'sm:pr-0',
            activeId === null ? 'snap-x snap-mandatory sm:snap-none' : 'snap-none'
          )}
        >
          {columns.map((column, index) => (
            <StrategyColumnView
              key={column.id}
              column={column}
              index={index}
              cards={cardsByColumn.get(column.id) ?? []}
              isOver={overColumn === column.id && activeId !== null}
              onAddCard={handleAddCard}
              onRename={renameStrategyColumn}
              onDelete={removeStrategyColumn}
            />
          ))}

          <AddHeadlineLane onAdd={handleAddColumn} />
        </div>

        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute right-0 top-12 z-20 flex h-16 w-12 items-center justify-end bg-gradient-to-l from-background via-background/80 to-transparent pr-0.5 transition-opacity sm:hidden',
            canScrollForward ? 'opacity-100' : 'opacity-0'
          )}
        >
          <span className="flex size-11 items-center justify-center rounded-full border border-border-accent bg-surface/95 text-accent shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-sm">
            <ChevronRight size={19} />
          </span>
        </div>
      </div>

      <DragOverlay>
        {activeCard ? (
          <div className="w-[calc(100vw-4rem)] max-w-[300px] rotate-1 rounded-xl border border-accent/30 bg-surface p-3.5 text-[14.5px] leading-snug text-foreground/85 shadow-lg sm:w-[200px] sm:max-w-none">
            {activeCard.content}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
