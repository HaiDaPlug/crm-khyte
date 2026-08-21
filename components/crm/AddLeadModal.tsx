'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Building2, Plus, User } from 'lucide-react'
import { Modal } from './Modal'
import { ConfirmDialog } from './ConfirmDialog'
import { ColorSlider, ComboHint, Combobox, Field, comboStatus, inputClass } from './FormFields'
import { useCRMStore } from '@/lib/store'
import { Priority, Stage } from '@/lib/types'
import { STAGES, priorityRamp, stageColors } from '@/lib/stage-config'
import { useFormat } from '@/lib/hooks/useFormat'
import { cn, newId } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical']

// Hoisted: inline JSX would be a new element identity each render, defeating
// the memo on Combobox.
const COMPANY_ICON = <Building2 size={15} />
const CONTACT_ICON = <User size={15} />

/**
 * Left padding that clears the currency prefix and the divider rule after it.
 * Tailwind needs whole class names at build time, so this is a lookup rather
 * than an interpolated value.
 */
function symbolPadding(symbol: string): string {
  if (symbol.length <= 1) return 'pl-11'
  if (symbol.length === 2) return 'pl-14'
  return 'pl-[4.5rem]'
}

const defaultFollowUp = () =>
  new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

interface AddLeadModalProps {
  open: boolean
  onClose: () => void
}

export function AddLeadModal({ open, onClose }: AddLeadModalProps) {
  const { t } = useTranslations()
  const copy = t.crm.leadForm
  const companies = useCRMStore((s) => s.companies)
  const contacts = useCRMStore((s) => s.contacts)
  const addCompany = useCRMStore((s) => s.addCompany)
  const addContact = useCRMStore((s) => s.addContact)
  const addOpportunity = useCRMStore((s) => s.addOpportunity)

  const fmt = useFormat()

  const companyInputRef = useRef<HTMLInputElement>(null)

  const [companyQuery, setCompanyQuery] = useState('')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [industry, setIndustry] = useState('')
  const [location, setLocation] = useState('')

  const [contactQuery, setContactQuery] = useState('')
  const [contactId, setContactId] = useState<string | null>(null)
  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')

  // A stage selection IS the pipeline decision: no stage → captured off the board
  const [stage, setStage] = useState<Stage | null>(null)
  const [priority, setPriority] = useState<Priority>('medium')
  const [dealValue, setDealValue] = useState('')
  const [nextStep, setNextStep] = useState('')
  const [followUpDate, setFollowUpDate] = useState(defaultFollowUp)
  const [tags, setTags] = useState('')
  const [notesText, setNotesText] = useState('')
  const [discardOpen, setDiscardOpen] = useState(false)

  // Fresh form every time the modal opens
  useEffect(() => {
    if (!open) return
    setCompanyQuery(''); setCompanyId(null); setIndustry(''); setLocation('')
    setContactQuery(''); setContactId(null); setRole(''); setEmail('')
    setStage(null); setPriority('medium'); setDealValue(''); setNextStep('')
    setFollowUpDate(defaultFollowUp()); setTags(''); setNotesText('')
    setDiscardOpen(false)
    const t = setTimeout(() => companyInputRef.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [open])

  const selectedCompany = companyId ? companies.find((c) => c.id === companyId) ?? null : null
  const selectedContact = contactId ? contacts.find((c) => c.id === contactId) ?? null : null

  // Anything the user typed is worth confirming before we throw it away.
  // followUpDate is excluded — it's prefilled, not user-entered.
  const isDirty =
    [companyQuery, industry, location, contactQuery, role, email, dealValue, nextStep, tags, notesText]
      .some((v) => v.trim().length > 0) || stage !== null

  // Anything typed is worth a beat of confirmation before it's thrown away.
  const handleClose = () => {
    if (isDirty) {
      setDiscardOpen(true)
      return
    }
    onClose()
  }

  const discardAndClose = () => {
    setDiscardOpen(false)
    onClose()
  }

  const companyOptions = useMemo(
    () =>
      companies.map((c) => ({
        id: c.id,
        label: c.name,
        meta: [c.industry, c.location].filter(Boolean).join(' · ') || c.domain,
      })),
    [companies]
  )

  const companyNameById = useMemo(
    () => new Map(companies.map((c) => [c.id, c.name])),
    [companies]
  )

  // Once a company is linked, only its people are suggested.
  // Keyed on `companyId` rather than the `selectedCompany` object: that object
  // is a fresh `.find()` result every render, which would rebuild this list on
  // every keystroke in any field.
  const contactOptions = useMemo(() => {
    const pool = companyId ? contacts.filter((c) => c.companyId === companyId) : contacts
    return pool.map((c) => ({
      id: c.id,
      label: c.name,
      meta: [c.role, companyNameById.get(c.companyId)].filter(Boolean).join(' · '),
    }))
  }, [contacts, companyNameById, companyId])

  // Whether each side will link an existing record or create one. Rendered next
  // to the field label rather than under the input.
  const companyStatus = comboStatus(companyQuery, companyOptions, companyId)
  const contactStatus = comboStatus(contactQuery, contactOptions, contactId)

  const handleSelectCompany = useCallback(
    (id: string) => {
      const company = companies.find((c) => c.id === id)
      if (!company) return
      setCompanyId(id)
      setCompanyQuery(company.name)
      // A contact linked to a different company no longer applies. Resolved via
      // a functional update so this callback doesn't depend on the current
      // selection, which would change its identity on every pick.
      setContactId((prevId) => {
        if (!prevId) return prevId
        const prev = contacts.find((c) => c.id === prevId)
        if (prev && prev.companyId !== id) {
          setContactQuery('')
          return null
        }
        return prevId
      })
    },
    [companies, contacts]
  )

  const handleSelectContact = useCallback(
    (id: string) => {
      const contact = contacts.find((c) => c.id === id)
      if (!contact) return
      setContactId(id)
      setContactQuery(contact.name)
      // Picking a person autofills their company
      const company = companies.find((c) => c.id === contact.companyId)
      if (company) {
        setCompanyId(company.id)
        setCompanyQuery(company.name)
      }
    },
    [companies, contacts]
  )

  const handleCompanyQueryChange = useCallback((q: string) => {
    setCompanyQuery(q)
    setCompanyId(null)
  }, [])

  const handleContactQueryChange = useCallback((q: string) => {
    setContactQuery(q)
    setContactId(null)
  }, [])

  const parsedTags = useMemo(
    () => Array.from(new Set(tags.split(',').map((t) => t.trim()).filter(Boolean))),
    [tags]
  )

  // Only a non-empty, non-numeric-garbage value counts; empty stays undefined.
  const dealValueError = useMemo(() => {
    const raw = dealValue.trim()
    if (!raw) return null
    const parsed = Number(raw.replace(/[^0-9.]/g, ''))
    if (!Number.isFinite(parsed) || parsed <= 0) return copy.invalidNumber
    return null
  }, [copy.invalidNumber, dealValue])

  const emailError = useMemo(() => {
    const raw = email.trim()
    if (!raw || selectedContact) return null
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? null : copy.invalidEmail
  }, [copy.invalidEmail, email, selectedContact])

  const canSubmit =
    companyQuery.trim().length > 0 &&
    contactQuery.trim().length > 0 &&
    !dealValueError &&
    !emailError

  // Empty company/contact need no callout — the disabled button and the empty
  // fields already say it. Only surface errors the user can't otherwise see.
  const blockedReason = dealValueError ?? emailError ?? undefined

  const handleSubmit = () => {
    if (!canSubmit) return
    const today = new Date().toISOString().slice(0, 10)

    const companyName = companyQuery.trim()
    let company =
      selectedCompany ??
      companies.find(
        (c) => c.name.trim().toLowerCase() === companyName.toLowerCase()
      ) ??
      null
    if (!company) {
      company = {
        id: newId(),
        name: companyName,
        domain: email.includes('@') ? email.split('@')[1].trim() : '',
        industry: industry.trim(),
        size: '',
        location: location.trim(),
        tags: [],
      }
      addCompany(company)
    }

    // A linked contact only counts if they belong to the resolved company
    const contactName = contactQuery.trim()
    let contact =
      (selectedContact && selectedContact.companyId === company.id ? selectedContact : null) ??
      contacts.find(
        (c) =>
          c.companyId === company.id &&
          c.name.trim().toLowerCase() === contactName.toLowerCase()
      ) ??
      null
    if (!contact) {
      contact = {
        id: newId(),
        companyId: company.id,
        name: contactName,
        role: role.trim(),
        email: email.trim(),
      }
      addContact(contact)
    }

    const parsedValue = Number(dealValue.replace(/[^0-9.]/g, ''))

    addOpportunity({
      id: newId(),
      companyId: company.id,
      contactId: contact.id,
      stage: stage ?? 'New',
      priority,
      inPipeline: stage !== null,
      dealValue: Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : undefined,
      nextStep: nextStep.trim(),
      followUpDate,
      lastInteraction: today,
      tags: parsedTags,
      notes: notesText.trim(),
    })

    onClose()
  }

  return (
    <>
    <Modal
      open={open}
      onClose={handleClose}
      title={copy.title}
      subtitle={copy.subtitle}
      width="w-[680px]"
      onSubmitShortcut={handleSubmit}
      suspended={discardOpen}
      footer={
        <>
          {/* Only validation errors surface here — the stage status line was
              noise, since the stage pills already show what's selected. */}
          <p aria-live="polite" className="text-[13px] text-danger">
            {blockedReason}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-foreground font-mono opacity-60 hidden sm:block">⌘↵</span>
            <button
              type="button"
              onClick={handleClose}
              className="h-9 px-3.5 rounded-lg text-[14px] font-medium text-foreground hover:bg-surface-raised transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              title={canSubmit ? undefined : blockedReason}
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
      {/* Who */}
      <div className="px-6 pt-5 pb-6 border-b border-border-subtle">
        <p className="label-mono mb-3.5">{copy.who}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
          <div>
            <Field label={copy.company} required hint={<ComboHint status={companyStatus} />}>
              <Combobox
                inputRef={companyInputRef}
                icon={COMPANY_ICON}
                placeholder={copy.searchOrCreate}
                query={companyQuery}
                onQueryChange={handleCompanyQueryChange}
                options={companyOptions}
                selectedId={companyId}
                onSelect={handleSelectCompany}
              />
            </Field>
            {!selectedCompany && companyQuery.trim() && (
              <div className="grid grid-cols-2 gap-3 mt-4">
                <Field label={copy.industry}>
                  <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="SaaS" className={inputClass} />
                </Field>
                <Field label={copy.location}>
                  <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Berlin, DE" className={inputClass} />
                </Field>
              </div>
            )}
          </div>

          <div>
            <Field label={copy.contact} required hint={<ComboHint status={contactStatus} />}>
              <Combobox
                icon={CONTACT_ICON}
                placeholder={copy.searchOrCreate}
                query={contactQuery}
                onQueryChange={handleContactQueryChange}
                options={contactOptions}
                selectedId={contactId}
                onSelect={handleSelectContact}
              />
            </Field>
            {!selectedContact && contactQuery.trim() && (
              <div className="grid grid-cols-2 gap-3 mt-4">
                <Field label={copy.role}>
                  <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="VP of Growth" className={inputClass} />
                </Field>
                <Field label={copy.email}>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@work.com"
                    aria-invalid={!!emailError}
                    aria-describedby={emailError ? 'contact-email-error' : undefined}
                    className={cn(inputClass, emailError && 'border-danger/60 focus:border-danger/60')}
                  />
                  {emailError && (
                    <p id="contact-email-error" className="mt-1 text-[12.5px] text-danger">
                      {emailError}
                    </p>
                  )}
                </Field>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pipeline — selecting a stage is what puts the lead on the board */}
      <div className="px-6 py-5 border-b border-border-subtle">
        <div className="flex items-baseline justify-between mb-3.5">
          <p className="label-mono">{copy.pipelineStage}</p>
          <p className="text-[12.5px] text-foreground/80">{copy.leaveOffBoard}</p>
        </div>
        <div role="radiogroup" aria-label={copy.pipelineStage} className="flex flex-wrap gap-2">
          <button
            type="button"
            role="radio"
            aria-checked={stage === null}
            onClick={() => setStage(null)}
            className={cn(
              'h-8 px-3 rounded-md text-[12.5px] font-medium border transition-all duration-150',
              stage === null
                ? 'bg-surface-raised text-foreground border-border'
                : 'text-foreground/80 border-border-subtle hover:text-foreground hover:border-border'
            )}
          >
            {copy.offBoard}
          </button>
          {STAGES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={stage === s}
              onClick={() => setStage(stage === s ? null : s)}
              className={cn(
                'h-8 px-3 rounded-md text-[12.5px] font-medium border transition-all duration-150',
                stage === s
                  ? cn(stageColors[s], 'border-transparent ring-1 ring-accent/30')
                  : 'text-foreground/80 border-border-subtle hover:text-foreground hover:border-border'
              )}
            >
              {t.stages[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Deal */}
      <div className="px-6 py-5">
        <div className="grid grid-cols-1 sm:grid-cols-[1.35fr_1fr_1fr] gap-4">
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
          <Field label={copy.dealValue}>
            <div className="relative">
              {/* Text, not an icon: the symbol follows the currency setting and
                  can be "kr" or "SEK", so the field pads to fit whatever it is.
                  The rule after it separates the unit from the amount. */}
              <span className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-2.5 pointer-events-none select-none">
                <span className="text-[15px] text-foreground/70">{fmt.symbol}</span>
                <span className="w-px h-[18px] bg-border-subtle" />
              </span>
              <input
                inputMode="decimal"
                value={dealValue}
                onChange={(e) => setDealValue(e.target.value)}
                aria-invalid={!!dealValueError}
                aria-describedby={dealValueError ? 'deal-value-error' : undefined}
                className={cn(
                  inputClass,
                  'tabular-nums',
                  symbolPadding(fmt.symbol),
                  dealValueError && 'border-danger/60 focus:border-danger/60'
                )}
              />
            </div>
            {dealValueError && (
              <p id="deal-value-error" className="mt-1 text-[12.5px] text-danger">
                {dealValueError}
              </p>
            )}
          </Field>
          <Field label={copy.followUp}>
            <input
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              className={cn(inputClass, 'font-mono text-[14px]')}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1.35fr_1fr] gap-4 mt-5">
          <Field label={copy.nextStep}>
            <input
              value={nextStep}
              onChange={(e) => setNextStep(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={copy.tags}>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={copy.tagsPlaceholder}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-5">
          <Field label={copy.notes}>
            <textarea
              value={notesText}
              onChange={(e) => setNotesText(e.target.value)}
              rows={2}
              className={cn(inputClass, 'h-auto py-2 resize-none leading-relaxed')}
            />
          </Field>
        </div>
      </div>
    </Modal>

    <ConfirmDialog
      open={open && discardOpen}
      title={copy.discardTitle}
      description={copy.discardDescription}
      cancelLabel={t.common.keepEditing}
      confirmLabel={copy.discard}
      onCancel={() => setDiscardOpen(false)}
      onConfirm={discardAndClose}
    />
    </>
  )
}
