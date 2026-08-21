'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Modal } from './Modal'
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
          <span aria-hidden="true" />
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-foreground font-mono opacity-60 hidden sm:block">⌘↵</span>
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-3.5 rounded-lg text-[14px] font-medium text-foreground hover:bg-surface-raised transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                'flex items-center gap-1.5 h-9 px-4 rounded-lg text-[14px] font-medium transition-all duration-150',
                canSubmit
                  ? 'bg-accent text-background hover:bg-accent-hover'
                  : 'bg-border text-foreground/70 cursor-not-allowed'
              )}
            >
              <Plus size={14} />
              {copy.add}
            </button>
          </div>
        </>
      }
    >
      <div className="px-6 py-5 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label={copy.name} required>
            <input
              ref={nameInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Meridian Labs"
              className={inputClass}
            />
          </Field>
          <Field label={copy.domain}>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="meridianlabs.io" className={cn(inputClass, 'font-mono text-[14px]')} />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label={copy.industry}>
            <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="SaaS" className={inputClass} />
          </Field>
          <Field label={copy.size}>
            <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="50-200" className={inputClass} />
          </Field>
          <Field label={copy.location}>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Berlin, DE" className={inputClass} />
          </Field>
        </div>

        <Field label={copy.tags}>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={copy.tagsPlaceholder} className={inputClass} />
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
