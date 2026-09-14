'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { motion, LayoutGroup, useReducedMotion } from 'motion/react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragOverEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
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
import { Button } from '@/components/crm/Button'
import { AssigneePicker, ColorSlider, DateStepper } from '@/components/crm/FormFields'
import { ConfirmDialog } from '@/components/crm/ConfirmDialog'
import { useCRMStore } from '@/lib/store'
import { useFormat } from '@/lib/hooks/useFormat'
import {
  Check, Circle, AlertCircle, Calendar, Building2, Pencil,
  Archive, Trash2, RotateCcw, ChevronDown, GripVertical,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Task, Priority, ColleagueId } from '@/lib/types'
import { priorityDot, priorityRamp, priorityChip } from '@/lib/stage-config'
import { colleagues } from '@/lib/colleagues'
import { playCheckChime } from '@/lib/sound'
import { useTranslations } from '@/lib/hooks/useTranslations'

/** How long the strike takes to sweep the title, in ms. */
const STRIKE_MS = 320
/** How long the row takes to fly to the completed column, in seconds. */
const FLIGHT_S = 0.7
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical']

// Hoisted so useSensor's identity is stable across renders — see the same
// constants in PipelineBoard.tsx/StrategyBoard.tsx for why an inline object
// here breaks a drag after its first dragOver.
const MOUSE_ACTIVATION_CONSTRAINT = { distance: 6 }
const TOUCH_ACTIVATION_CONSTRAINT = { delay: 250, tolerance: 8 }
const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter: sortableKeyboardCoordinates }

function TaskItem({ task }: { task: Task }) {
  const { t } = useTranslations()
  const fmt = useFormat()
  const toggleTaskComplete = useCRMStore((s) => s.toggleTaskComplete)
  const companies = useCRMStore((s) => s.companies)
  const company = task.relatedCompanyId ? companies.find(c => c.id === task.relatedCompanyId) : null

  const isOverdue = !task.completed && new Date(task.dueDate) < new Date()
  const isToday = !task.completed && new Date(task.dueDate).toDateString() === new Date().toDateString()

  // The row holds its place while the line draws, then the store moves it and
  // the shared layout animation carries it across to the completed column.
  const soundsOn = useCRMStore((s) => s.settings.sounds)
  const updateTask = useCRMStore((s) => s.updateTask)
  const [editing, setEditing] = useState(false)
  const [striking, setStriking] = useState(false)
  const strikeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reduceMotion = useReducedMotion()
  const struck = task.completed || striking

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition: dndTransition,
    isDragging,
  } = useSortable({ id: task.id, disabled: editing })
  const dragStyle = { transform: CSS.Transform.toString(transform), transition: dndTransition }

  useEffect(() => () => {
    if (strikeTimer.current) clearTimeout(strikeTimer.current)
  }, [])

  function handleToggle() {
    // Un-checking is a correction, not an achievement: no chime, no ceremony.
    if (task.completed) {
      toggleTaskComplete(task.id)
      return
    }

    if (soundsOn) playCheckChime()

    if (reduceMotion) {
      toggleTaskComplete(task.id)
      return
    }

    setStriking(true)
    strikeTimer.current = setTimeout(() => toggleTaskComplete(task.id), STRIKE_MS)
  }

  if (editing) {
    return (
      <TaskEditor
        task={task}
        onCancel={() => setEditing(false)}
        onSave={(updates) => {
          updateTask(task.id, updates)
          setEditing(false)
        }}
      />
    )
  }

  return (
    <motion.div
      ref={setNodeRef}
      // A drag in flight is fully driven by dnd-kit's own transform — mixing
      // it with the shared layoutId flight (used for the checkbox-triggered
      // move into Completed) would fight it for the same transform property.
      layout={!isDragging}
      layoutId={`task-${task.id}`}
      transition={{
        layout: { duration: FLIGHT_S, ease: [0.22, 1, 0.36, 1] },
      }}
      // Lifted only while in flight, so it passes over the column edges
      // instead of under them.
      style={{ position: 'relative', zIndex: striking || isDragging ? 30 : 0, ...dragStyle }}
      className={cn(
        'relative flex items-start gap-3 bg-surface px-3 py-3.5 group transition-opacity duration-500 sm:px-4 sm:py-4',
        task.completed && 'opacity-40',
        isDragging && 'opacity-30 shadow-md'
      )}
    >
      {/* Critical tasks get a quiet edge marker — read in peripheral vision,
          without competing with the checkbox for the first thing you see. */}
      {task.priority === 'critical' && !struck && (
        <span
          aria-hidden="true"
          className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full"
          style={{ background: priorityDot.critical }}
        />
      )}

      {/* Handle-only drag: isolated with its own listeners rather than the
          whole row, since the row already owns a click-to-edit affordance
          and a checkbox — a press-and-hold anywhere would fight both. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t.tasks.reorder(task.title)}
        className={cn(
          'mt-0.5 flex size-7 shrink-0 touch-manipulation cursor-grab items-center justify-center self-stretch rounded-lg text-foreground/30 active:cursor-grabbing',
          'transition-opacity duration-150 hover:bg-surface-raised hover:text-foreground/60',
          'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100',
          '-ml-1'
        )}
      >
        <GripVertical size={14} />
      </button>

      <motion.button
        type="button"
        onClick={handleToggle}
        aria-label={
          task.completed ? t.tasks.markIncomplete(task.title) : t.tasks.markComplete(task.title)
        }
        aria-pressed={task.completed}
        whileTap={{ scale: 0.82 }}
        transition={{ type: 'spring', stiffness: 500, damping: 22 }}
        className={cn(
          "relative mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-200 after:absolute after:-inset-3 after:content-['']",
          struck ? 'bg-accent border-accent' : 'border-border hover:border-accent/50'
        )}
      >
        {struck && (
          <motion.span
            initial={task.completed && !striking ? false : { scale: 0, rotate: -35 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 18 }}
            className="flex"
          >
            <Check size={10} className="text-background" strokeWidth={3} />
          </motion.span>
        )}
      </motion.button>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className={cn(
            'relative inline-block max-w-full text-[15px] font-medium leading-snug transition-colors duration-300',
            // Once it has landed the strike is a plain text-decoration, so it is
            // correct on first paint with no JS involved.
            task.completed && 'line-through',
            struck ? 'text-foreground/50' : 'text-foreground'
          )}>
            {task.title}
            {/* Only exists for the 320ms sweep, and only ever while the row is
                still sitting in its original column. */}
            {striking && (
              <motion.span
                aria-hidden="true"
                className="absolute left-0 top-1/2 h-[1.5px] w-full origin-left rounded-full bg-current"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: STRIKE_MS / 1000, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
          </p>

          {/* The assignee is the first thing a glance needs, so it sits as a
              named chip at the head of the card rather than buried as a tiny
              initial in the metadata row. */}
          {task.assignee && (
            <div
              title={colleagues[task.assignee].name}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-raised py-0.5 pl-0.5 pr-2 sm:pr-2.5"
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                style={{ background: colleagues[task.assignee].color }}
              >
                {colleagues[task.assignee].name.charAt(0)}
              </span>
              <span className="hidden text-[12.5px] font-medium text-foreground/75 sm:inline">
                {colleagues[task.assignee].name}
              </span>
            </div>
          )}
        </div>

        {task.description && (
          <p className="mt-1 whitespace-pre-line text-[13.5px] leading-relaxed text-foreground/70">
            {task.description}
          </p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
          <span
            className={cn(
              'rounded-md px-1.5 py-0.5 text-[12px] font-mono tracking-wide',
              task.priority === 'critical' && 'font-semibold uppercase'
            )}
            style={{
              background: priorityChip[task.priority].background,
              color: priorityChip[task.priority].text,
            }}
          >
            {t.priorities[task.priority]}
          </span>
          <div className={cn(
            'flex items-center gap-1.5 text-[13.5px] font-mono',
            isOverdue ? 'text-danger font-medium' : isToday ? 'text-accent' : 'text-foreground/65'
          )}>
            <Calendar size={11} />
            {isToday ? t.tasks.today : fmt.date(task.dueDate)}
          </div>
          {company && (
            <div className="flex min-w-0 items-center gap-1.5 text-[13.5px] text-foreground/65">
              <Building2 size={11} className="shrink-0" />
              <span className="break-words">{company.name}</span>
            </div>
          )}
        </div>
      </div>

      <button
        onClick={() => setEditing(true)}
        aria-label={`${t.common.edit}: ${task.title}`}
        className={cn(
          'flex size-11 -mr-2 -mt-2 shrink-0 items-center justify-center rounded-xl sm:mr-0 sm:-mt-0.5 sm:size-7 sm:rounded-lg',
          'text-foreground/45 hover:text-foreground hover:bg-surface-raised transition-all duration-150',
          'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100'
        )}
      >
        <Pencil size={13} />
      </button>
    </motion.div>
  )
}

/**
 * The row swapped for its own fields. Kept as a separate component so its draft
 * state is created fresh on entry and thrown away on exit — no syncing a draft
 * back to a task that may have changed underneath it.
 */
function TaskEditor({
  task,
  onSave,
  onCancel,
}: {
  task: Task
  onSave: (updates: Partial<Task>) => void
  onCancel: () => void
}) {
  const { t } = useTranslations()
  const archiveTask = useCRMStore((s) => s.archiveTask)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [priority, setPriority] = useState<Priority>(task.priority)
  const [dueDate, setDueDate] = useState(task.dueDate.slice(0, 10))
  const [assignee, setAssignee] = useState<ColleagueId | undefined>(task.assignee)

  const canSave = title.trim().length > 0

  function save() {
    if (!canSave) return
    onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      dueDate,
      assignee,
    })
  }

  // Enter commits from any single-line field; Escape always abandons.
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault()
      save()
    }
  }

  return (
    <div className="bg-surface-raised/40 px-3 py-3.5 sm:px-4 sm:py-4" onKeyDown={onKeyDown}>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t.tasks.placeholder}
        className={cn(
          'h-11 w-full rounded-lg border border-border-subtle bg-background-raised px-2.5 sm:h-9',
          'text-[16px] font-medium text-foreground placeholder:text-foreground/45 sm:text-[15px]',
          'outline-none focus:border-accent/50 transition-[border-color] duration-100'
        )}
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t.tasks.descriptionPlaceholder}
        className={cn(
          'mt-2 h-11 w-full rounded-lg border border-border-subtle bg-background-raised px-2.5 sm:h-9',
          'text-[16px] text-foreground/85 placeholder:text-foreground/45 sm:text-[13.5px]',
          'outline-none focus:border-accent/50 transition-[border-color] duration-100'
        )}
      />

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1.3fr_1fr] sm:items-center">
        <ColorSlider
          steps={PRIORITIES}
          value={priority}
          onChange={setPriority}
          colors={priorityRamp}
          label={t.crm.taskForm.priority}
          valueLabels={t.priorities}
        />
        <DateStepper value={dueDate} onChange={setDueDate} />
      </div>

      <div className="mt-3">
        <AssigneePicker value={assignee} onChange={setAssignee} unassignedLabel={t.crm.taskForm.unassigned} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:items-center">
        {/* The only way off the board. Nothing here deletes — that lives in
            the archive, one deliberate step further away. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => archiveTask(task.id)}
          className="col-span-2 h-11 w-full text-foreground/60 sm:mr-auto sm:h-9 sm:w-auto"
        >
          <Archive size={14} />
          {t.tasks.archive}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-11 w-full sm:h-9 sm:w-auto">
          {t.common.cancel}
        </Button>
        <Button size="sm" onClick={save} disabled={!canSave} className="h-11 w-full sm:h-9 sm:w-auto">
          {t.common.save}
        </Button>
      </div>
    </div>
  )
}

/**
 * A task in the archive. Restoring puts it straight back on the board;
 * deleting is the only permanent action in the app, so it is confirmed and
 * only reachable from here.
 */
function ArchivedRow({ task }: { task: Task }) {
  const { t } = useTranslations()
  const fmt = useFormat()
  const archiveTask = useCRMStore((s) => s.archiveTask)
  const deleteTask = useCRMStore((s) => s.deleteTask)
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="group flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14.5px] text-foreground/70">{task.title}</p>
        {task.archivedAt && (
          <p className="mt-0.5 text-[13px] font-mono text-foreground/45 tabular-nums">
            {fmt.date(task.archivedAt)}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => archiveTask(task.id, false)}
        className={cn(
          'flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium',
          'text-foreground/55 transition-colors duration-150 hover:bg-surface-raised hover:text-foreground'
        )}
      >
        <RotateCcw size={13} />
        {t.tasks.restore}
      </button>

      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`${t.tasks.remove}: ${task.title}`}
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground/35',
          'transition-colors duration-150 hover:bg-danger-muted hover:text-danger'
        )}
      >
        <Trash2 size={14} />
      </button>

      <ConfirmDialog
        open={confirming}
        title={t.tasks.removeTitle}
        description={t.tasks.removeDescription}
        confirmLabel={t.tasks.remove}
        onConfirm={() => {
          setConfirming(false)
          deleteTask(task.id)
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

type ColumnTone = 'pace' | 'late' | 'done'

const columnTone: Record<ColumnTone, { label: string; chip: string; border: string }> = {
  pace: {
    label: 'text-accent',
    chip: 'bg-accent-light text-accent',
    border: 'border-accent/30',
  },
  late: {
    label: 'text-danger',
    chip: 'bg-danger-muted text-danger',
    border: 'border-danger/40',
  },
  done: {
    label: 'text-foreground/60',
    chip: 'bg-surface-raised text-foreground/60 border border-border-subtle',
    border: 'border-border-subtle',
  },
}

/** Droppable id for each column — distinct from task ids so dnd-kit's
 *  collision detection can tell "dropped on the column itself" (file at the
 *  end) apart from "dropped on a specific card" (take that card's place). */
type ColumnId = 'pace' | 'late' | 'done'

function TaskColumn({
  id,
  icon: Icon,
  label,
  tone,
  tasks,
  isOver,
  onClear,
}: {
  id: ColumnId
  icon: LucideIcon
  label: string
  tone: ColumnTone
  tasks: Task[]
  isOver: boolean
  /** Header action for filing the whole column away at once. */
  onClear?: () => void
}) {
  const { t } = useTranslations()
  const c = columnTone[tone]
  const { setNodeRef } = useDroppable({ id })

  return (
    <section className="min-w-0">
      <div className="flex items-center gap-2 mb-2.5 px-1">
        <Icon size={13} className={c.label} />
        <h3 className={cn('text-[12.5px] font-semibold uppercase tracking-[0.12em] font-mono', c.label)}>
          {label}
        </h3>
        <span className={cn('text-[13px] font-mono px-2 py-0.5 rounded-md tabular-nums', c.chip)}>
          {tasks.length}
        </span>
        {onClear && tasks.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className={cn(
              'ml-auto flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium',
              'text-foreground/50 transition-colors duration-150 hover:bg-surface-raised hover:text-foreground'
            )}
          >
            <Archive size={12} />
            {t.tasks.clearCompleted}
          </button>
        )}
      </div>

      <motion.div
        ref={setNodeRef}
        layout
        transition={{ layout: { duration: FLIGHT_S, ease: [0.22, 1, 0.36, 1] } }}
        className={cn(
          'bg-surface border rounded-xl divide-y divide-border-subtle transition-colors duration-150',
          c.border,
          isOver && 'ring-1 ring-accent/30 border-accent/40'
        )}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 ? (
            <div className={cn('h-[104px] flex items-center justify-center', isOver && 'text-accent')}>
              <p className="text-[13.5px] text-foreground/60">
                {isOver ? t.crm.board.dropHere : t.tasks.noTasks}
              </p>
            </div>
          ) : (
            tasks.map((task) => <TaskItem key={task.id} task={task} />)
          )}
        </SortableContext>
      </motion.div>
    </section>
  )
}

/**
 * The three-column task board (on pace / overdue / completed) plus the
 * archive drawer beneath it. Takes its task list as a prop so the same board
 * can render either everyone's tasks (`/tasks`) or one colleague's
 * (`/tasks/[colleagueId]`) — the bucketing and rendering logic doesn't care
 * where the list came from.
 */
export function TaskBoard({ tasks }: { tasks: Task[] }) {
  const { t } = useTranslations()
  const archiveTask = useCRMStore((s) => s.archiveTask)
  const moveTask = useCRMStore((s) => s.moveTask)
  const pauseRemoteSync = useCRMStore((s) => s.pauseRemoteSync)
  const resumeRemoteSync = useCRMStore((s) => s.resumeRemoteSync)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<ColumnId | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: MOUSE_ACTIVATION_CONSTRAINT }),
    useSensor(TouchSensor, { activationConstraint: TOUCH_ACTIVATION_CONSTRAINT }),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS)
  )

  // Three buckets, matching the three columns. "On pace" is everything still
  // open and not yet past due — today's work and what's ahead of it — so the
  // middle column is only ever the things that actually slipped.
  const { onPace, late, completed, archived } = useMemo(() => {
    const now = new Date()
    const todayStr = now.toDateString()
    const byOrder = (a: Task, b: Task) => a.order - b.order

    const onPace: Task[] = []
    const late: Task[] = []
    const completed: Task[] = []
    const archived: Task[] = []

    tasks.forEach((task) => {
      // Archived tasks stay in the store so anything referencing them still
      // resolves — they just leave the board for the drawer below it.
      if (task.archivedAt) {
        archived.push(task)
        return
      }
      if (task.completed) {
        completed.push(task)
        return
      }
      const due = new Date(task.dueDate)
      const isToday = due.toDateString() === todayStr
      if (!isToday && due < now) late.push(task)
      else onPace.push(task)
    })

    // `order` is shared across the whole "open" bucket (on-pace + overdue
    // together — see moveTask), so both columns sort by it directly; a drag
    // that crosses the on-pace/overdue line still lands in a sensible spot
    // relative to its new neighbours.
    return {
      onPace: onPace.sort(byOrder),
      late: late.sort(byOrder),
      completed: completed.sort(byOrder),
      archived: archived.sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '')),
    }
  }, [tasks])

  const columnTasks: Record<ColumnId, Task[]> = { pace: onPace, late, done: completed }
  const columnOf = (taskId: string): ColumnId | null => {
    if (onPace.some((t) => t.id === taskId)) return 'pace'
    if (late.some((t) => t.id === taskId)) return 'late'
    if (completed.some((t) => t.id === taskId)) return 'done'
    return null
  }

  // A remote snapshot merged mid-drag would rebuild the columns around the
  // task being held — dnd-kit is tracking a row the merge would replace.
  // Held off for the length of the drag; both endings below resume it. Same
  // pattern as PipelineBoard.tsx.
  const handleDragStart = (event: DragStartEvent) => {
    pauseRemoteSync()
    setActiveId(event.active.id as string)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event
    if (!over) { setOverColumn(null); return }
    const overId = over.id as string
    if (overId === 'pace' || overId === 'late' || overId === 'done') {
      setOverColumn(overId)
    } else {
      setOverColumn(columnOf(overId))
    }
  }

  const handleDragCancel = () => {
    resumeRemoteSync()
    setActiveId(null)
    setOverColumn(null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    resumeRemoteSync()
    setActiveId(null)
    setOverColumn(null)
    if (!over) return

    const draggedId = active.id as string
    const overId = over.id as string
    const completedTarget = (col: ColumnId) => col === 'done'

    // Dropped on a column itself — file it at the end of that column.
    if (overId === 'pace' || overId === 'late' || overId === 'done') {
      moveTask(draggedId, completedTarget(overId))
      return
    }

    // Dropped on another task — take that task's place within its column.
    const targetColumn = columnOf(overId)
    if (!targetColumn || overId === draggedId) return
    const lane = columnTasks[targetColumn].filter((t) => t.id !== draggedId)
    const targetTask = lane.find((t) => t.id === overId)
    moveTask(
      draggedId,
      completedTarget(targetColumn),
      targetTask ? Math.max(lane.indexOf(targetTask), 0) : undefined
    )
  }

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null

  return (
    <>
      <DndContext
        sensors={sensors}
        // See the same switch in PipelineBoard.tsx/StrategyBoard.tsx:
        // closestCorners scores every card in a column as its own collision
        // candidate, so a long column out-scores every other column for the
        // whole drag regardless of where the pointer actually is.
        // pointerWithin hit-tests the pointer's real position instead.
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
      <LayoutGroup>
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3 lg:gap-5">
          <TaskColumn
            id="pace"
            icon={Circle}
            label={t.tasks.onPace}
            tone="pace"
            tasks={onPace}
            isOver={overColumn === 'pace' && activeId !== null}
          />
          <TaskColumn
            id="late"
            icon={AlertCircle}
            label={t.tasks.overdue}
            tone="late"
            tasks={late}
            isOver={overColumn === 'late' && activeId !== null}
          />
          <TaskColumn
            id="done"
            icon={Check}
            label={t.tasks.completed}
            tone="done"
            tasks={completed}
            isOver={overColumn === 'done' && activeId !== null}
            onClear={() => completed.forEach((task) => archiveTask(task.id))}
          />
        </div>
      </LayoutGroup>

      <DragOverlay>
        {activeTask ? (
          <div
            className={cn(
              'flex items-start gap-3 rounded-xl border border-accent/30 bg-surface px-3 py-3.5 shadow-lg sm:px-4 sm:py-4',
            )}
          >
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-border" />
            <p className="text-[15px] font-medium leading-snug text-foreground">
              {activeTask.title}
            </p>
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>

      {/* The archive: a drawer rather than a fourth column, because it is a
          place you visit to undo something, not part of the daily read. */}
      {archived.length > 0 && (
        <section className="mt-8">
          <button
            type="button"
            onClick={() => setArchiveOpen((open) => !open)}
            aria-expanded={archiveOpen}
            className="flex items-center gap-2 px-1 text-foreground/60 transition-colors duration-150 hover:text-foreground"
          >
            <Archive size={13} />
            <h3 className="text-[12.5px] font-semibold uppercase tracking-[0.12em] font-mono">
              {t.tasks.archiveLabel}
            </h3>
            <span className="rounded-md bg-surface-raised px-2 py-0.5 text-[13px] font-mono tabular-nums text-foreground/60 border border-border-subtle">
              {archived.length}
            </span>
            <ChevronDown
              size={14}
              className={cn('transition-transform duration-200', archiveOpen && 'rotate-180')}
            />
          </button>

          {archiveOpen && (
            <div className="mt-2.5 max-w-3xl divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface animate-fade-in">
              {archived.map((task) => (
                <ArchivedRow key={task.id} task={task} />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  )
}

/** Active + completed count, for the page header summary line. */
export function taskCounts(tasks: Task[]) {
  let active = 0
  let completed = 0
  tasks.forEach((task) => {
    if (task.archivedAt) return
    if (task.completed) completed++
    else active++
  })
  return { active, completed }
}
