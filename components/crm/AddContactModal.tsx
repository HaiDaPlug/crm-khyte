'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Building2, Plus } from 'lucide-react'
import { Modal } from './Modal'
import { ComboHint, Combobox, Field, comboStatus, inputClass } from './FormFields'
import { useCRMStore } from '@/lib/store'
import { cn } from '@/lib/utils'
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
              placeholder="Elena Hartmann"
              className={inputClass}
            />
          </Field>
          <Field label={copy.role}>
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="VP of Growth" className={inputClass} />
          </Field>
        </div>

        <Field
          label={copy.company}
          required
          hint={<ComboHint status={comboStatus(companyQuery, companyOptions, companyId)} />}
        >
          <Combobox
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

        <Field label={copy.email}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className={inputClass} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label={copy.phone}>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+49 160 000 0000" className={inputClass} />
          </Field>
          <Field label={copy.linkedin}>
            <input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="linkedin.com/in/..." className={inputClass} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
