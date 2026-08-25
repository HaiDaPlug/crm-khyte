'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'
import { AssigneePicker, ColorSlider, Field, inputClass } from './FormFields'
import { useCRMStore } from '@/lib/store'
import { ColleagueId, Priority } from '@/lib/types'
import { priorityRamp } from '@/lib/stage-config'
import { cn, newId } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical']

interface AddLeadModalProps {
  open: boolean
  onClose: () => void
}

export function AddLeadModal({ open, onClose }: AddLeadModalProps) {
  const { t } = useTranslations()
  const copy = t.crm.newLeadForm
  const addLead = useCRMStore((s) => s.addLead)

  const nameInputRef = useRef<HTMLInputElement>(null)
  const formId = useId()

  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [connection, setConnection] = useState('')
  const [source, setSource] = useState('')
  const [followedUpBy, setFollowedUpBy] = useState<ColleagueId | undefined>(undefined)
  const [priority, setPriority] = useState<Priority>('medium')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!open) return
    setCompanyName(''); setContactName(''); setConnection(''); setSource('')
    setFollowedUpBy(undefined)
    setPriority('medium'); setNotes('')
    const t = setTimeout(() => nameInputRef.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [open])

  const canSubmit = companyName.trim().length > 0

  const handleSubmit = () => {
    if (!canSubmit) return
    addLead({
      id: newId(),
      companyName: companyName.trim(),
      ...(contactName.trim() ? { contactName: contactName.trim() } : {}),
      ...(connection.trim() ? { connection: connection.trim() } : {}),
      ...(source.trim() ? { source: source.trim() } : {}),
      ...(followedUpBy ? { followedUpBy } : {}),
      priority,
      notes: notes.trim(),
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
      width="w-[480px]"
      onSubmitShortcut={handleSubmit}
      footer={
        <>
          <span aria-hidden="true" className="hidden sm:block" />
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <span className="text-[12px] text-foreground font-mono opacity-60 hidden sm:block">⌘↵</span>
            <button
              type="button"
              onClick={onClose}
              className="h-11 flex-1 touch-manipulation rounded-lg px-3.5 text-[14px] font-medium text-foreground transition-colors hover:bg-surface-raised sm:h-9 sm:flex-none"
            >
              {t.common.cancel}
            </button>
            <Button onClick={handleSubmit} disabled={!canSubmit} className="flex-1 sm:flex-none">
              <Plus size={14} />
              {copy.add}
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-4 px-4 py-5 sm:space-y-5 sm:px-7 sm:py-6">
        <Field label={copy.companyName} required htmlFor={`${formId}-company-name`}>
          <input
            id={`${formId}-company-name`}
            ref={nameInputRef}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Meridian Labs"
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={copy.contactName} htmlFor={`${formId}-contact-name`}>
            <input
              id={`${formId}-contact-name`}
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={copy.connection} htmlFor={`${formId}-connection`}>
            <input
              id={`${formId}-connection`}
              value={connection}
              onChange={(e) => setConnection(e.target.value)}
              placeholder={copy.connectionPlaceholder}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label={copy.source} htmlFor={`${formId}-source`}>
          <input
            id={`${formId}-source`}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={copy.sourcePlaceholder}
            className={inputClass}
          />
        </Field>

        <Field label={copy.followedUpBy}>
          <AssigneePicker
            value={followedUpBy}
            onChange={setFollowedUpBy}
            label={copy.followedUpBy}
            unassignedLabel={t.crm.taskForm.unassigned}
          />
        </Field>

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

        <Field label={copy.notes} htmlFor={`${formId}-notes`}>
          <textarea
            id={`${formId}-notes`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className={cn(inputClass, 'h-auto py-2 resize-none leading-relaxed')}
          />
        </Field>
      </div>
    </Modal>
  )
}
