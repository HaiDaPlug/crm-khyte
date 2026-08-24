'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'
import { AssigneePicker, ColorSlider, Field, inputClass, DateStepper } from './FormFields'
import { useCRMStore } from '@/lib/store'
import { ColleagueId, Priority } from '@/lib/types'
import { priorityRamp } from '@/lib/stage-config'
import { cn, newId } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical']

const defaultDueDate = () =>
  new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

interface AddTaskModalProps {
  open: boolean
  onClose: () => void
}

export function AddTaskModal({ open, onClose }: AddTaskModalProps) {
  const { t } = useTranslations()
  const copy = t.crm.taskForm
  const addTask = useCRMStore((s) => s.addTask)

  const titleInputRef = useRef<HTMLInputElement>(null)
  const formId = useId()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [dueDate, setDueDate] = useState(defaultDueDate)
  const [assignee, setAssignee] = useState<ColleagueId | undefined>(undefined)

  // Fresh form every time the modal opens
  useEffect(() => {
    if (!open) return
    setTitle(''); setDescription(''); setPriority('medium')
    setDueDate(defaultDueDate()); setAssignee(undefined)
    const t = setTimeout(() => titleInputRef.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [open])

  const canSubmit = title.trim().length > 0

  const handleSubmit = () => {
    if (!canSubmit) return
    addTask({
      id: newId(),
      title: title.trim(),
      description: description.trim() || undefined,
      dueDate,
      completed: false,
      priority,
      assignee,
      createdAt: new Date().toISOString(),
    })
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={copy.title}
      subtitle={copy.subtitle}
      width="w-[520px]"
      onSubmitShortcut={handleSubmit}
      footer={
        <>
          <span aria-hidden="true" />
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:items-center">
            <span className="text-[12px] text-foreground font-mono opacity-60 hidden sm:block">⌘↵</span>
            <Button variant="ghost" onClick={onClose} className="w-full sm:w-auto">
              {t.common.cancel}
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full sm:w-auto">
              <Plus size={14} />
              {t.tasks.addTask}
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-4 px-4 py-4 sm:space-y-5 sm:px-6 sm:py-5">
        <Field label={copy.titleLabel} required htmlFor={`${formId}-title`}>
          <input
            id={`${formId}-title`}
            ref={titleInputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.tasks.placeholder}
            className={inputClass}
          />
        </Field>

        <Field label={copy.description} htmlFor={`${formId}-description`}>
          <textarea
            id={`${formId}-description`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.tasks.descriptionPlaceholder}
            rows={2}
            className={cn(inputClass, 'h-auto py-2 resize-none leading-relaxed')}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={copy.priority}>
            <ColorSlider
              steps={PRIORITIES}
              value={priority}
              onChange={setPriority}
              colors={priorityRamp}
              label={copy.priority}
              valueLabels={t.priorities}
            />
          </Field>
          <Field label={copy.dueDate} htmlFor={`${formId}-due-date`}>
            <DateStepper
              id={`${formId}-due-date`}
              value={dueDate}
              onChange={setDueDate}
              inputClassName={cn(inputClass, 'font-mono text-[16px] sm:text-[14px]')}
            />
          </Field>
        </div>

        <Field label={copy.assignee}>
          <AssigneePicker
            value={assignee}
            onChange={setAssignee}
            label={copy.assignee}
            unassignedLabel={copy.unassigned}
          />
        </Field>
      </div>
    </Modal>
  )
}
