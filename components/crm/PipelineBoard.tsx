'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { LeadCard } from './LeadCard'
import { Company, Contact, Opportunity, Stage } from '@/lib/types'
import { cn } from '@/lib/utils'
import { stageColors } from '@/lib/stage-config'
import { useTranslations } from '@/lib/hooks/useTranslations'
import { useBoardPan } from '@/lib/hooks/useBoardPan'
import { useCRMStore } from '@/lib/store'

const STAGES: Stage[] = [
  'New', 'Researched', 'Contacted', 'Warm',
  'Meeting Booked', 'Proposal Sent', 'Negotiation', 'Won', 'Lost'
]

/** Column edge tint per stage. The stage's own label colours come from the
 *  shared `stageColors` pill, so this only carries the border. */
const stageBorder: Record<Stage, string> = {
  'New': 'border-border-subtle',
  'Researched': 'border-blue-500/40',
  'Contacted': 'border-sky-500/40',
  'Warm': 'border-orange-500/40',
  'Meeting Booked': 'border-violet-500/40',
  'Proposal Sent': 'border-amber-500/40',
  'Negotiation': 'border-yellow-500/40',
  'Won': 'border-success/40',
  'Lost': 'border-danger/40',
}

/** Distance from a board edge, in px, at which dragging starts to scroll. */
const EDGE_ZONE = 130
/** Scroll step at the outermost edge, in px per frame (~1400px/s at 60fps). */
const MAX_SPEED = 24

/**
 * Edge auto-scroll for the board while a card is in hand.
 *
 * dnd-kit ships its own `autoScroll`, but across nine columns it creeps —
 * measured at ~100px/s against 710px of overflow, which reads as broken long
 * before a card reaches the late stages, and raising `acceleration` barely
 * moved it. This drives `scrollLeft` straight off the pointer instead: nothing
 * until the pointer enters `EDGE_ZONE`, then a squared ramp to `MAX_SPEED` at
 * the very edge, so the far end is about half a second away while the middle
 * of the zone stays controllable.
 *
 * dnd-kit still observes the resulting scroll events to keep droppable rects
 * in sync, so the drop target under the pointer stays correct throughout.
 */
function useEdgeAutoScroll(ref: React.RefObject<HTMLDivElement | null>, active: boolean) {
  const pointerX = useRef<number | null>(null)

  // Tracked continuously rather than only while dragging: a drag can start and
  // then hold still at an edge, and a listener attached on activation would
  // never learn where the pointer is — the board would sit motionless until
  // the user jiggled the mouse.
  useEffect(() => {
    const track = (event: PointerEvent) => {
      pointerX.current = event.clientX
    }
    window.addEventListener('pointermove', track)
    window.addEventListener('pointerdown', track)
    return () => {
      window.removeEventListener('pointermove', track)
      window.removeEventListener('pointerdown', track)
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!active || !el) return

    let frame = requestAnimationFrame(function step() {
      frame = requestAnimationFrame(step)

      const x = pointerX.current
      if (x === null) return

      const { left, right } = el.getBoundingClientRect()
      // Signed: negative inside the left zone, positive inside the right one.
      const ratio =
        x > right - EDGE_ZONE ? (x - (right - EDGE_ZONE)) / EDGE_ZONE
        : x < left + EDGE_ZONE ? (x - (left + EDGE_ZONE)) / EDGE_ZONE
        : 0
      if (ratio === 0) return

      el.scrollLeft += Math.sign(ratio) * Math.min(Math.abs(ratio), 1) ** 2 * MAX_SPEED
    })

    return () => cancelAnimationFrame(frame)
  }, [active, ref])
}

/** Keeps the phone-only edge cue honest as the user swipes across the board. */
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

export interface PipelineRow {
  opportunity: Opportunity
  company: Company
  contact: Contact
}

interface ColumnProps {
  stage: Stage
  cards: PipelineRow[]
  onCardClick: (row: PipelineRow) => void
  availableLeads: PipelineRow[]
  onAddToStage: (opportunityId: string, stage: Stage) => void
  isOver: boolean
}

function PipelineColumn({ stage, cards, onCardClick, availableLeads, onAddToStage, isOver }: ColumnProps) {
  const { t } = useTranslations()
  const { setNodeRef } = useDroppable({ id: stage })
  const border = stageBorder[stage]
  const [pickerOpen, setPickerOpen] = useState(false)

  return (
    <div className={cn(
      'flex w-[calc(100%-2rem)] max-w-[320px] shrink-0 snap-start snap-always flex-col overflow-hidden rounded-xl border transition-all duration-200',
      'sm:w-[260px] sm:max-w-none sm:snap-normal',
      border,
      'bg-surface',
      isOver && 'ring-1 ring-accent/30 border-accent/40'
    )}>
      <div className="px-3 py-3 border-b border-border-subtle bg-surface-raised/50">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('inline-flex items-center h-7 px-2.5 rounded-md text-[14px] font-medium truncate', stageColors[stage])}>
            {t.stages[stage]}
          </span>
          <span className="text-[13px] font-mono text-foreground/60 tabular-nums shrink-0 pr-0.5">
            {cards.length}
          </span>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 p-2.5 space-y-2 min-h-[120px] transition-colors duration-150',
          'bg-background/60',
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
          isOver ? (
            <div className="h-[104px] flex items-center justify-center rounded-lg border-2 border-dotted border-accent/50 bg-accent-light transition-colors duration-150">
              <p className="text-[13.5px] text-accent">{t.crm.board.dropHere}</p>
            </div>
          ) : (
            <div className="relative">
              {/* A lightly-tinted, empty card silhouette rather than a label —
                  the tint alone signals "a card belongs here", and opens a
                  picker of off-board leads to drop straight into this stage. */}
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                aria-label={`${t.pipeline.addLeads} · ${t.stages[stage]}`}
                className="group relative z-50 flex h-[104px] w-full touch-manipulation items-center justify-center rounded-lg border-2 border-dotted border-border bg-white/[0.04] transition-colors duration-150 active:bg-white/[0.08] focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 sm:hover:border-accent/40 sm:hover:bg-white/[0.08]"
              >
                <Plus size={18} className="text-accent transition-colors duration-150 sm:text-foreground/30 sm:group-hover:text-accent" />
              </button>

              {pickerOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} />
                  <div className="relative z-40 mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-xl animate-scale-in sm:absolute sm:left-0 sm:right-0 sm:top-full">
                    <div className="px-3 py-2 border-b border-border-subtle bg-surface-raised/50">
                      <p className="label-mono !text-white">{t.pipeline.offBoard}</p>
                    </div>
                    <div className="max-h-[260px] overflow-y-auto p-1.5">
                      {availableLeads.length === 0 ? (
                        <p className="text-[13px] text-foreground/60 text-center py-5">
                          {t.pipeline.allOnBoard}
                        </p>
                      ) : (
                        availableLeads.map((row) => (
                          <button
                            key={row.opportunity.id}
                            type="button"
                            onClick={() => {
                              onAddToStage(row.opportunity.id, stage)
                              setPickerOpen(false)
                            }}
                            className="min-h-11 w-full touch-manipulation rounded-lg px-2.5 py-2 text-left transition-colors active:bg-accent-light focus-visible:bg-accent-light focus-visible:outline-none sm:hover:bg-accent-light"
                          >
                            <p className="text-[13.5px] font-medium text-foreground truncate">
                              {row.company.name}
                            </p>
                            <p className="text-[12px] text-foreground/60 truncate">
                              {row.contact.name}
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )
        )}
      </div>
    </div>
  )
}

interface PipelineBoardProps {
  rows: PipelineRow[]
  onCardClick: (row: PipelineRow) => void
  onStageChange?: (opportunityId: string, newStage: Stage, targetIndex?: number) => void
  /** Leads not yet on the board — offered by each column's empty-slot picker. */
  availableLeads: PipelineRow[]
  onAddToStage: (opportunityId: string, stage: Stage) => void
}

export function PipelineBoard({ rows, onCardClick, onStageChange, availableLeads, onAddToStage }: PipelineBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overStage, setOverStage] = useState<string | null>(null)
  const pauseRemoteSync = useCRMStore((s) => s.pauseRemoteSync)
  const resumeRemoteSync = useCRMStore((s) => s.resumeRemoteSync)
  const boardRef = useRef<HTMLDivElement>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const canScrollForward = useForwardScrollAffordance(boardRef, rows.length)

  useEdgeAutoScroll(boardRef, activeId !== null)
  // Panning is for the empty-handed case; while a card is in flight the
  // edge auto-scroller owns the board. Wheel-to-horizontal is skipped over a
  // card itself, so a normal two-finger scroll there still scrolls the page
  // instead of yanking the whole board sideways — only empty column space
  // and the gaps between columns convert to a pan.
  useBoardPan(boardRef, {
    disabled: activeId !== null,
    wheelExcludeSelector: '[aria-roledescription="sortable"]',
  })

  // Cards derive straight from the store-backed rows so drags and newly
  // added leads stay in sync with every other page
  const getCardsByStage = (stage: Stage): PipelineRow[] => {
    return rows
      .filter(r => r.opportunity.stage === stage)
      .sort((a, b) => a.opportunity.order - b.opportunity.order)
  }

  // A remote snapshot merged mid-drag would rebuild the columns around the
  // card being held — dnd-kit is tracking a row that the merge replaces. Held
  // off for the length of the drag; both endings below resume it.
  const handleDragStart = (event: DragStartEvent) => {
    pauseRemoteSync()
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
      const targetRow = rows.find(r => r.opportunity.id === overId)
      if (targetRow) setOverStage(targetRow.opportunity.stage)
    }
  }

  // Escape (and any other cancelled drag) fires this instead of onDragEnd.
  // Without it `activeId` never cleared: the column stayed highlighted and the
  // board stayed un-pannable until another drag started.
  const handleDragCancel = () => {
    resumeRemoteSync()
    setActiveId(null)
    setOverStage(null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    resumeRemoteSync()
    setActiveId(null)
    setOverStage(null)

    if (!over) return

    const draggedId = active.id as string
    const overId = over.id as string
    const targetStage = STAGES.find(s => s === overId)

    let newStage: Stage | undefined
    // Dropped on a card: land at that card's position, pushing it (and
    // everything after) down one. Dropped on the empty column body instead
    // (targetStage matched): there's no card to index against, so append.
    let targetIndex: number | undefined
    if (targetStage) {
      newStage = targetStage
    } else {
      const targetRow = rows.find(r => r.opportunity.id === overId)
      if (targetRow) {
        newStage = targetRow.opportunity.stage
        targetIndex = getCardsByStage(newStage)
          .filter(r => r.opportunity.id !== draggedId)
          .findIndex(r => r.opportunity.id === overId)
        if (targetIndex === -1) targetIndex = undefined
      }
    }

    if (newStage) {
      onStageChange?.(draggedId, newStage, targetIndex)
    }
  }

  const activeRow = activeId ? rows.find(r => r.opportunity.id === activeId) : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      // Left on as a floor beneath useEdgeAutoScroll. Both read the same
      // pointer and scroll the same container in the same direction, so they
      // add rather than fight; the rAF loop dominates, and if it ever fails to
      // start this still creeps the board along instead of doing nothing.
      autoScroll={{ threshold: { x: 0.2, y: 0.15 }, acceleration: 18, interval: 5 }}
    >
      <div className="relative">
        <div
          ref={boardRef}
          className={cn(
            'board-scroll flex min-h-0 cursor-grab items-start gap-3 overflow-x-auto overscroll-x-contain pb-4 pr-8 touch-manipulation',
            'sm:min-h-[calc(100dvh-160px)] sm:items-stretch sm:pr-0',
            activeId === null ? 'snap-x snap-mandatory sm:snap-none' : 'snap-none'
          )}
        >
          {STAGES.map(stage => (
            <PipelineColumn
              key={stage}
              stage={stage}
              cards={getCardsByStage(stage)}
              onCardClick={onCardClick}
              availableLeads={availableLeads}
              onAddToStage={onAddToStage}
              isOver={overStage === stage && activeId !== null}
            />
          ))}
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
        {activeRow ? (
          <div className="rotate-2 opacity-90 scale-105">
            <LeadCard
              opportunity={activeRow.opportunity}
              company={activeRow.company}
              contact={activeRow.contact}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
