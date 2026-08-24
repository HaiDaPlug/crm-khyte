'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'
import { Field, inputClass } from './FormFields'
import { useCRMStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

interface AddCompanyModalProps {
  open: boolean
  onClose: () => void
}

export function AddCompanyModal({ open, onClose }: AddCompanyModalProps) {
  const { t } = useTranslations()
  const copy = t.crm.companyForm
  const addCompany = useCRMStore((s) => s.addCompany)

  const nameInputRef = useRef<HTMLInputElement>(null)
  const formId = useId()

  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [industry, setIndustry] = useState('')
  const [size, setSize] = useState('')
  const [location, setLocation] = useState('')
  const [tags, setTags] = useState('')

  useEffect(() => {
    if (!open) return
    setName(''); setDomain(''); setIndustry(''); setSize(''); setLocation(''); setTags('')
    const t = setTimeout(() => nameInputRef.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [open])

  const parsedTags = useMemo(
    () => tags.split(',').map((t) => t.trim()).filter(Boolean),
    [tags]
  )

  const canSubmit = name.trim().length > 0

  const handleSubmit = () => {
    if (!canSubmit) return
    addCompany({
      id: crypto.randomUUID(),
      name: name.trim(),
      domain: domain.trim(),
      industry: industry.trim(),
      size: size.trim(),
      location: location.trim(),
      tags: parsedTags,
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={copy.name} required htmlFor={`${formId}-name`}>
            <input
              id={`${formId}-name`}
              ref={nameInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Meridian Labs"
              className={inputClass}
            />
          </Field>
          <Field label={copy.domain} htmlFor={`${formId}-domain`}>
            <input id={`${formId}-domain`} inputMode="url" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="meridianlabs.io" className={cn(inputClass, 'font-mono text-[16px] sm:text-[14px]')} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={copy.industry} htmlFor={`${formId}-industry`}>
            <input id={`${formId}-industry`} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="SaaS" className={inputClass} />
          </Field>
          <Field label={copy.size} htmlFor={`${formId}-size`}>
            <input id={`${formId}-size`} value={size} onChange={(e) => setSize(e.target.value)} placeholder="50-200" className={inputClass} />
          </Field>
          <Field label={copy.location} htmlFor={`${formId}-location`}>
            <input id={`${formId}-location`} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Berlin, DE" className={inputClass} />
          </Field>
        </div>

        <Field label={copy.tags} htmlFor={`${formId}-tags`}>
          <input id={`${formId}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} placeholder={copy.tagsPlaceholder} className={inputClass} />
          {parsedTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {parsedTags.map((t) => (
                <span key={t} className="text-[11.5px] font-mono px-2 py-0.5 bg-accent-light text-accent rounded-md">
                  {t}
                </span>
              ))}
            </div>
          )}
        </Field>
      </div>
    </Modal>
  )
}
