'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { motion, LayoutGroup, useReducedMotion } from 'motion/react'
import { Button } from '@/components/crm/Button'
import { AssigneePicker, ColorSlider, DateStepper } from '@/components/crm/FormFields'
import { ConfirmDialog } from '@/components/crm/ConfirmDialog'
import { useCRMStore } from '@/lib/store'
import { useFormat } from '@/lib/hooks/useFormat'
import {
  Check, Circle, AlertCircle, Calendar, Building2, Pencil,
  Archive, Trash2, RotateCcw, ChevronDown,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Task, Priority, ColleagueId } from '@/lib/types'
import { priorityDot, priorityRamp } from '@/lib/stage-config'
import { colleagues } from '@/lib/colleagues'
import { playCheckChime } from '@/lib/sound'
import { useTranslations } from '@/lib/hooks/useTranslations'

/** How long the strike takes to sweep the title, in ms. */
const STRIKE_MS = 320
/** How long the row takes to fly to the completed column, in seconds. */
const FLIGHT_S = 0.7
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical']

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
      layout
      layoutId={`task-${task.id}`}
      transition={{
        layout: { duration: FLIGHT_S, ease: [0.22, 1, 0.36, 1] },
      }}
      // Lifted only while in flight, so it passes over the column edges
      // instead of under them.
      style={{ position: 'relative', zIndex: striking ? 30 : 0 }}
      className={cn(
        'relative flex items-start gap-3 bg-surface px-3 py-3.5 group transition-opacity duration-500 sm:px-4 sm:py-4',
        task.completed && 'opacity-40'
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
          {task.priority === 'critical' ? (
            <span className="rounded-md bg-danger-muted px-1.5 py-0.5 text-[12px] font-mono font-semibold uppercase tracking-wide text-danger">
              {t.priorities[task.priority]}
            </span>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: priorityDot[task.priority] }} />
              <span className="text-[13.5px] text-foreground/65 font-mono">{t.priorities[task.priority]}</span>
            </div>
          )}
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

function TaskColumn({
  icon: Icon,
  label,
  tone,
  tasks,
  onClear,
}: {
  icon: LucideIcon
  label: string
  tone: ColumnTone
  tasks: Task[]
  /** Header action for filing the whole column away at once. */
  onClear?: () => void
}) {
  const { t } = useTranslations()
  const c = columnTone[tone]

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
        layout
        transition={{ layout: { duration: FLIGHT_S, ease: [0.22, 1, 0.36, 1] } }}
        className={cn('bg-surface border rounded-xl divide-y divide-border-subtle', c.border)}
      >
        {tasks.length === 0 ? (
          <div className="h-[104px] flex items-center justify-center">
            <p className="text-[13.5px] text-foreground/60">{t.tasks.noTasks}</p>
          </div>
        ) : (
          tasks.map((task) => <TaskItem key={task.id} task={task} />)
        )}
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
  const [archiveOpen, setArchiveOpen] = useState(false)

  // Three buckets, matching the three columns. "On pace" is everything still
  // open and not yet past due — today's work and what's ahead of it — so the
  // middle column is only ever the things that actually slipped.
  const { onPace, late, completed, archived } = useMemo(() => {
    const now = new Date()
    const todayStr = now.toDateString()
    const byDue = (a: Task, b: Task) => +new Date(a.dueDate) - +new Date(b.dueDate)

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

    return {
      onPace: onPace.sort(byDue),
      late: late.sort(byDue),
      completed,
      archived: archived.sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '')),
    }
  }, [tasks])

  return (
    <>
      <LayoutGroup>
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3 lg:gap-5">
          <TaskColumn icon={Circle} label={t.tasks.onPace} tone="pace" tasks={onPace} />
          <TaskColumn icon={AlertCircle} label={t.tasks.overdue} tone="late" tasks={late} />
          <TaskColumn
            icon={Check}
            label={t.tasks.completed}
            tone="done"
            tasks={completed}
            onClear={() => completed.forEach((task) => archiveTask(task.id))}
          />
        </div>
      </LayoutGroup>

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
