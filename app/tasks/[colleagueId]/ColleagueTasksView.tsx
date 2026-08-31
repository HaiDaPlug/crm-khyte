'use client'

import { useMemo, useState } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/crm/Button'
import { AddTaskModal } from '@/components/crm/AddTaskModal'
import { ColleaguePicker } from '@/components/crm/ColleaguePicker'
import { TaskBoard, taskCounts } from '@/components/crm/TaskBoard'
import { useCRMStore } from '@/lib/store'
import { colleagues } from '@/lib/colleagues'
import { ColleagueId } from '@/lib/types'
import { Plus } from 'lucide-react'
import { useTranslations } from '@/lib/hooks/useTranslations'

export function ColleagueTasksView({ colleagueId }: { colleagueId: ColleagueId }) {
  const { t } = useTranslations()
  const allTasks = useCRMStore((s) => s.tasks)
  const [addTaskOpen, setAddTaskOpen] = useState(false)

  const person = colleagues[colleagueId]
  const tasks = useMemo(
    () => allTasks.filter((task) => task.assignee === colleagueId),
    [allTasks, colleagueId]
  )
  const { active, completed } = taskCounts(tasks)

  return (
    <>
      <Topbar />
      <main className="flex-1 animate-fade-in-up px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white"
              style={{ background: person.color }}
            >
              {person.name.charAt(0)}
            </span>
            <div>
              <h2 className="text-[28px] font-jakarta font-semibold text-foreground tracking-[-0.02em] leading-none sm:text-[30px]">
                {person.name}
              </h2>
              <p className="text-[15px] text-foreground/60 mt-1.5 font-mono tabular-nums">
                {t.tasks.summary(active, completed)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ColleaguePicker active={colleagueId} />
            <Button onClick={() => setAddTaskOpen(true)} className="h-11 flex-1 sm:h-[38px] sm:flex-none">
              <Plus size={15} />
              {t.tasks.addTask}
            </Button>
          </div>
        </div>

        <TaskBoard tasks={tasks} />
      </main>

      <AddTaskModal open={addTaskOpen} onClose={() => setAddTaskOpen(false)} />
    </>
  )
}
