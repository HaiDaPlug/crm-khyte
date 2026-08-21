'use client'

import { useState, useMemo } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import { useCRMStore } from '@/lib/store'
import { useFormat } from '@/lib/hooks/useFormat'
import { Plus, Check, Circle, AlertCircle, Calendar, Building2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Task, Priority } from '@/lib/types'
import { useTranslations } from '@/lib/hooks/useTranslations'

const priorityConfig: Record<Priority, { dot: string }> = {
  critical: { dot: 'bg-red-500' },
  high: { dot: 'bg-accent' },
  medium: { dot: 'bg-blue-400' },
  low: { dot: 'bg-muted' },
}

function TaskItem({ task }: { task: Task }) {
  const { t } = useTranslations()
  const fmt = useFormat()
  const toggleTaskComplete = useCRMStore((s) => s.toggleTaskComplete)
  const companies = useCRMStore((s) => s.companies)
  const company = task.relatedCompanyId ? companies.find(c => c.id === task.relatedCompanyId) : null

  const isOverdue = !task.completed && new Date(task.dueDate) < new Date()
  const isToday = !task.completed && new Date(task.dueDate).toDateString() === new Date().toDateString()

  return (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3.5 group transition-all duration-150',
        task.completed && 'opacity-40'
      )}
    >
      <button
        onClick={() => toggleTaskComplete(task.id)}
        className={cn(
          'mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-200',
          task.completed
            ? 'bg-accent border-accent'
            : 'border-border hover:border-accent/50'
        )}
      >
        {task.completed && <Check size={10} className="text-background" strokeWidth={3} />}
      </button>

      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-[13px] text-foreground leading-snug',
          task.completed && 'line-through text-muted'
        )}>
          {task.title}
        </p>
        {task.description && (
          <p className="text-[11.5px] text-muted mt-0.5 line-clamp-1">{task.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1.5">
          <div className="flex items-center gap-1.5">
            <span className={cn('w-1.5 h-1.5 rounded-full', priorityConfig[task.priority].dot)} />
            <span className="text-[10px] text-muted font-mono">{t.priorities[task.priority]}</span>
          </div>
          <div className={cn(
            'flex items-center gap-1 text-[10px] font-mono',
            isOverdue ? 'text-danger font-medium' : isToday ? 'text-accent' : 'text-muted'
          )}>
            <Calendar size={9} />
            {isOverdue ? t.tasks.overdue : isToday ? t.tasks.today : fmt.date(task.dueDate)}
          </div>
          {company && (
            <div className="flex items-center gap-1 text-[10px] text-muted">
              <Building2 size={9} />
              {company.name}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AddTaskForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslations()
  const addTask = useCRMStore((s) => s.addTask)
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    const today = new Date()
    const nextWeek = new Date(today)
    nextWeek.setDate(today.getDate() + 7)

    addTask({
      id: crypto.randomUUID(),
      title: title.trim(),
      dueDate: nextWeek.toISOString().split('T')[0],
      completed: false,
      priority,
      createdAt: new Date().toISOString(),
    })
    setTitle('')
    onClose()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-accent/20 rounded-xl p-4 animate-fade-in-up">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t.tasks.placeholder}
        className="w-full text-[14px] text-foreground bg-transparent placeholder:text-muted outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
      />
      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-1.5">
          {(['low', 'medium', 'high', 'critical'] as Priority[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={cn(
                'h-6 px-2 rounded-md text-[10px] font-medium capitalize transition-all border',
                priority === p
                  ? 'bg-accent text-background border-accent'
                  : 'text-muted border-border hover:border-border-accent'
              )}
            >
              {t.priorities[p]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className="text-[12px] text-muted hover:text-foreground transition-colors">
            {t.common.cancel}
          </button>
          <button
            type="submit"
            disabled={!title.trim()}
            className={cn(
              'h-7 px-3 rounded-lg text-[12px] font-medium transition-all',
              title.trim()
                ? 'bg-accent text-background hover:bg-accent-hover'
                : 'bg-border text-muted cursor-not-allowed'
            )}
          >
            {t.tasks.addTask}
          </button>
        </div>
      </div>
    </form>
  )
}

export default function TasksPage() {
  const { t } = useTranslations()
  const tasks = useCRMStore((s) => s.tasks)
  const [showAddForm, setShowAddForm] = useState(false)

  const { overdue, today, upcoming, completed } = useMemo(() => {
    const now = new Date()
    const todayStr = now.toDateString()

    const overdue: Task[] = []
    const today: Task[] = []
    const upcoming: Task[] = []
    const completed: Task[] = []

    tasks.forEach(task => {
      if (task.completed) {
        completed.push(task)
      } else {
        const dueDate = new Date(task.dueDate)
        if (dueDate.toDateString() === todayStr) {
          today.push(task)
        } else if (dueDate < now) {
          overdue.push(task)
        } else {
          upcoming.push(task)
        }
      }
    })

    return { overdue, today, upcoming, completed }
  }, [tasks])

  const totalActive = overdue.length + today.length + upcoming.length

  return (
    <>
      <Topbar title={t.tasks.title} />
      <main className="px-8 py-8 flex-1 max-w-3xl animate-fade-in-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-[22px] font-display text-foreground tracking-tight">{t.tasks.title}</h2>
            <p className="text-[13px] text-muted mt-0.5 font-mono">
              {t.tasks.summary(totalActive, completed.length)}
            </p>
          </div>
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1.5 h-8 px-4 rounded-lg text-[12px] font-medium bg-accent text-background hover:bg-accent-hover transition-colors"
            >
              <Plus size={13} />
              {t.tasks.addTask}
            </button>
          )}
        </div>

        {showAddForm && (
          <div className="mb-5">
            <AddTaskForm onClose={() => setShowAddForm(false)} />
          </div>
        )}

        <div className="space-y-6">
          {overdue.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2 px-4">
                <AlertCircle size={12} className="text-danger" />
                <h3 className="text-[10px] font-semibold text-danger uppercase tracking-wider font-mono">
                  {t.tasks.overdue}
                </h3>
                <span className="text-[10px] font-mono text-danger bg-danger-muted px-1.5 py-0.5 rounded-md">
                  {overdue.length}
                </span>
              </div>
              <div className="bg-surface border border-danger/20 rounded-xl overflow-hidden divide-y divide-border-subtle">
                {overdue.map(task => <TaskItem key={task.id} task={task} />)}
              </div>
            </div>
          )}

          {today.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2 px-4">
                <Circle size={12} className="text-accent" />
                <h3 className="text-[10px] font-semibold text-accent uppercase tracking-wider font-mono">
                  {t.tasks.today}
                </h3>
                <span className="text-[10px] font-mono text-accent bg-accent-light px-1.5 py-0.5 rounded-md">
                  {today.length}
                </span>
              </div>
              <div className="bg-surface border border-accent/15 rounded-xl overflow-hidden divide-y divide-border-subtle">
                {today.map(task => <TaskItem key={task.id} task={task} />)}
              </div>
            </div>
          )}

          {upcoming.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2 px-4">
                <Calendar size={12} className="text-muted" />
                <h3 className="text-[10px] font-semibold text-muted uppercase tracking-wider font-mono">
                  {t.tasks.upcoming}
                </h3>
                <span className="text-[10px] font-mono text-muted bg-surface-raised px-1.5 py-0.5 rounded-md border border-border-subtle">
                  {upcoming.length}
                </span>
              </div>
              <div className="bg-surface border border-border rounded-xl overflow-hidden divide-y divide-border-subtle">
                {upcoming.map(task => <TaskItem key={task.id} task={task} />)}
              </div>
            </div>
          )}

          {completed.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2 px-4">
                <Check size={12} className="text-muted" />
                <h3 className="text-[10px] font-semibold text-muted uppercase tracking-wider font-mono">
                  {t.tasks.completed}
                </h3>
                <span className="text-[10px] font-mono text-muted bg-surface-raised px-1.5 py-0.5 rounded-md border border-border-subtle">
                  {completed.length}
                </span>
              </div>
              <div className="bg-surface border border-border rounded-xl overflow-hidden divide-y divide-border-subtle">
                {completed.map(task => <TaskItem key={task.id} task={task} />)}
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
