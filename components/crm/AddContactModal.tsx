'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Building2, Plus } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'
import { ComboHint, Combobox, Field, comboStatus, inputClass } from './FormFields'
import { useCRMStore } from '@/lib/store'
import { useTranslations } from '@/lib/hooks/useTranslations'

interface AddContactModalProps {
  open: boolean
  onClose: () => void
}

export function AddContactModal({ open, onClose }: AddContactModalProps) {
  const { t } = useTranslations()
  const copy = t.crm.contactForm
  const companies = useCRMStore((s) => s.companies)
  const addCompany = useCRMStore((s) => s.addCompany)
  const addContact = useCRMStore((s) => s.addContact)

  const nameInputRef = useRef<HTMLInputElement>(null)
  const formId = useId()

  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [linkedin, setLinkedin] = useState('')
  const [companyQuery, setCompanyQuery] = useState('')
  const [companyId, setCompanyId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(''); setRole(''); setEmail(''); setPhone(''); setLinkedin('')
    setCompanyQuery(''); setCompanyId(null)
    const t = setTimeout(() => nameInputRef.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [open])

  const selectedCompany = companyId ? companies.find((c) => c.id === companyId) ?? null : null

  const companyOptions = useMemo(
    () =>
      companies.map((c) => ({
        id: c.id,
        label: c.name,
        meta: [c.industry, c.location].filter(Boolean).join(' · ') || c.domain,
      })),
    [companies]
  )

  const canSubmit = name.trim().length > 0 && companyQuery.trim().length > 0

  const handleSubmit = () => {
    if (!canSubmit) return

    let company =
      selectedCompany ??
      companies.find((c) => c.name.toLowerCase() === companyQuery.trim().toLowerCase()) ??
      null
    if (!company) {
      company = {
        id: crypto.randomUUID(),
        name: companyQuery.trim(),
        domain: email.includes('@') ? email.split('@')[1].trim() : '',
        industry: '',
        size: '',
        location: '',
        tags: [],
      }
      addCompany(company)
    }

    addContact({
      id: crypto.randomUUID(),
      companyId: company.id,
      name: name.trim(),
      role: role.trim(),
      email: email.trim(),
      ...(phone.trim() && { phone: phone.trim() }),
      ...(linkedin.trim() && { linkedin: linkedin.trim() }),
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
              placeholder="Elena Hartmann"
              className={inputClass}
            />
          </Field>
          <Field label={copy.role} htmlFor={`${formId}-role`}>
            <input id={`${formId}-role`} value={role} onChange={(e) => setRole(e.target.value)} placeholder="VP of Growth" className={inputClass} />
          </Field>
        </div>

        <Field
          label={copy.company}
          required
          htmlFor={`${formId}-company`}
          hint={<ComboHint status={comboStatus(companyQuery, companyOptions, companyId)} />}
        >
          <Combobox
            id={`${formId}-company`}
            icon={<Building2 size={15} />}
            placeholder={copy.searchOrCreate}
            query={companyQuery}
            onQueryChange={(q) => { setCompanyQuery(q); setCompanyId(null) }}
            options={companyOptions}
            selectedId={companyId}
            onSelect={(id) => {
              const company = companies.find((c) => c.id === id)
              if (!company) return
              setCompanyId(id)
              setCompanyQuery(company.name)
            }}
          />
        </Field>

        <Field label={copy.email} htmlFor={`${formId}-email`}>
          <input id={`${formId}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className={inputClass} />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={copy.phone} htmlFor={`${formId}-phone`}>
            <input id={`${formId}-phone`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+49 160 000 0000" className={inputClass} />
          </Field>
          <Field label={copy.linkedin} htmlFor={`${formId}-linkedin`}>
            <input id={`${formId}-linkedin`} inputMode="url" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="linkedin.com/in/..." className={inputClass} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
