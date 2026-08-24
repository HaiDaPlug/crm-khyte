'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ExternalLink, Calendar, ArrowRight, Pencil, ChevronDown } from 'lucide-react'
import { Opportunity, Company, Contact, Note, Priority, Stage } from '@/lib/types'
import { NotesTimeline } from './NotesTimeline'
import { ConfirmDialog } from './ConfirmDialog'
import { Button } from './Button'
import { InlineSelect } from './FormFields'
import { useCRMStore } from '@/lib/store'
import { STAGES, priorityDot, stageColors } from '@/lib/stage-config'
import { useDialogBehavior, useMounted } from '@/lib/hooks/useDialog'
import { useFormat } from '@/lib/hooks/useFormat'
import { cn, newId } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical']

interface DetailDrawerProps {
  opportunity: Opportunity | null
  company: Company | null
  contact: Contact | null
  notes: Note[]
  onClose: () => void
}

interface DrawerPayload {
  opportunity: Opportunity
  company: Company
  contact: Contact
  notes: Note[]
}

export function DetailDrawer({ opportunity, company, contact, notes, onClose }: DetailDrawerProps) {
  const { t } = useTranslations()
  const copy = t.crm.detail
  const isOpen = !!opportunity
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const mounted = useMounted()
  const fmt = useFormat()

  // Read through refs: `useDialogBehavior` runs before the editing state is
  // declared below, and the callbacks must see live values anyway.
  const editingNotesRef = useRef(false)
  const discardOpenRef = useRef(false)
  // `requestClose` is declared below and re-created each render; the ref keeps
  // the hook's stable listener pointed at the current one.
  const requestCloseRef = useRef<() => void>(onClose)
  useDialogBehavior({
    open: isOpen,
    onClose: () => requestCloseRef.current(),
    panelRef,
    shouldIgnoreEscape: () => editingNotesRef.current,
    suspended: () => discardOpenRef.current,
  })

  useEffect(() => {
    if (isOpen) panelRef.current?.focus()
  }, [isOpen])

  // The selection clears the instant the drawer is dismissed, so hold on to the
  // last row we rendered — otherwise the panel slides out empty.
  const [payload, setPayload] = useState<DrawerPayload | null>(null)
  useEffect(() => {
    if (opportunity && company && contact) {
      setPayload({ opportunity, company, contact, notes })
    }
  }, [opportunity, company, contact, notes])

  const updateOpportunity = useCRMStore((s) => s.updateOpportunity)
  const updateCompany = useCRMStore((s) => s.updateCompany)
  const updateContact = useCRMStore((s) => s.updateContact)
  const addNote = useCRMStore((s) => s.addNote)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [discardOpen, setDiscardOpen] = useState(false)
  const [discardClosesDrawer, setDiscardClosesDrawer] = useState(false)
  const notesInputRef = useRef<HTMLTextAreaElement>(null)

  // Which single field is mid-edit, if any. Only one at a time — these are
  // small, immediate-commit editors, not a form, so there's no draft/discard
  // dance beyond "click away or Escape cancels this one field."
  const [editingField, setEditingField] = useState<
    'companyName' | 'contactName' | 'dealValue' | 'followUp' | 'nextStep' | 'tags' | null
  >(null)
  const [companyNameDraft, setCompanyNameDraft] = useState('')
  const [contactNameDraft, setContactNameDraft] = useState('')
  const [dealValueDraft, setDealValueDraft] = useState('')
  const [followUpDraft, setFollowUpDraft] = useState('')
  const [nextStepDraft, setNextStepDraft] = useState('')
  const [tagsDraft, setTagsDraft] = useState('')

  useEffect(() => {
    editingNotesRef.current = editingNotes
  }, [editingNotes])

  useEffect(() => {
    discardOpenRef.current = discardOpen
  }, [discardOpen])

  // Never carry one lead's draft over to another, and drop the editors when
  // the drawer closes so it reopens in read mode.
  useEffect(() => {
    setEditingNotes(false)
    setDiscardOpen(false)
    setDiscardClosesDrawer(false)
    setEditingField(null)
  }, [opportunity?.id, isOpen])

  useEffect(() => {
    if (!editingNotes) return
    const el = notesInputRef.current
    if (!el) return
    el.focus()
    // Caret to the end rather than selecting everything, so typing appends.
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editingNotes])

  const beginEditNotes = () => {
    setNotesDraft(payload?.opportunity.notes ?? '')
    setEditingNotes(true)
  }

  const notesDirty = editingNotes && notesDraft.trim() !== (payload?.opportunity.notes ?? '')

  /** Discard immediately when nothing was typed; otherwise ask first. */
  const cancelEditNotes = () => {
    if (notesDirty) {
      setDiscardClosesDrawer(false)
      setDiscardOpen(true)
      return
    }
    setEditingNotes(false)
  }

  const confirmDiscardNotes = () => {
    const shouldCloseDrawer = discardClosesDrawer
    setDiscardOpen(false)
    setDiscardClosesDrawer(false)
    setEditingNotes(false)
    if (shouldCloseDrawer) onClose()
  }

  /** Dismissing the drawer with an unsaved note asks before throwing it away. */
  const requestClose = () => {
    if (notesDirty) {
      setDiscardClosesDrawer(true)
      setDiscardOpen(true)
      return
    }
    onClose()
  }
  requestCloseRef.current = requestClose

  const saveNotes = () => {
    const id = payload?.opportunity.id
    if (!id) return
    const next = notesDraft.trim()
    if (next !== (payload?.opportunity.notes ?? '')) {
      updateOpportunity(id, { notes: next })
      // Keep the retained payload in step; the drawer renders from it, not the
      // store, so it would otherwise show the stale note until reselected.
      setPayload((p) => (p ? { ...p, opportunity: { ...p.opportunity, notes: next } } : p))
    }
    setEditingNotes(false)
  }

  const handleNotesKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      saveNotes()
    } else if (e.key === 'Escape') {
      // Stop the drawer's own Escape handler from closing the whole panel.
      e.preventDefault()
      e.stopPropagation()
      cancelEditNotes()
    }
  }

  const beginEditCompanyName = () => {
    if (!payload) return
    setCompanyNameDraft(payload.company.name)
    setEditingField('companyName')
  }

  /** Writes through to the shared Company record, so the rename is reflected
   * everywhere that company appears — the Companies page, and any other
   * prospect linked to it — not just this drawer. */
  const saveCompanyName = () => {
    const id = payload?.company.id
    if (!id) return
    const name = companyNameDraft.trim()
    if (name && name !== payload?.company.name) {
      updateCompany(id, { name })
      setPayload((p) => (p ? { ...p, company: { ...p.company, name } } : p))
    }
    setEditingField(null)
  }

  const beginEditContactName = () => {
    if (!payload) return
    setContactNameDraft(payload.contact.name)
    setEditingField('contactName')
  }

  /** Writes through to the shared Contact record — same rationale as the
   * company name editor above. */
  const saveContactName = () => {
    const id = payload?.contact.id
    if (!id) return
    const name = contactNameDraft.trim()
    if (name && name !== payload?.contact.name) {
      updateContact(id, { name })
      setPayload((p) => (p ? { ...p, contact: { ...p.contact, name } } : p))
    }
    setEditingField(null)
  }

  /** Stage and priority commit the moment a new value is picked — no draft. */
  const changeStage = (stage: Stage) => {
    const id = payload?.opportunity.id
    if (!id || stage === payload?.opportunity.stage) return
    updateOpportunity(id, { stage })
    setPayload((p) => (p ? { ...p, opportunity: { ...p.opportunity, stage } } : p))
  }

  const changePriority = (priority: Priority) => {
    const id = payload?.opportunity.id
    if (!id || priority === payload?.opportunity.priority) return
    updateOpportunity(id, { priority })
    setPayload((p) => (p ? { ...p, opportunity: { ...p.opportunity, priority } } : p))
  }

  const beginEditDealValue = () => {
    if (!payload) return
    setDealValueDraft(
      payload.opportunity.dealValue !== undefined
        ? String(Math.round(fmt.fromBase(payload.opportunity.dealValue)))
        : ''
    )
    setEditingField('dealValue')
  }

  const saveDealValue = () => {
    const id = payload?.opportunity.id
    if (!id) return
    const raw = Number(dealValueDraft.replace(/[^0-9.]/g, ''))
    const dealValue = Number.isFinite(raw) && raw > 0 ? fmt.toBase(raw) : undefined
    updateOpportunity(id, { dealValue })
    setPayload((p) => (p ? { ...p, opportunity: { ...p.opportunity, dealValue } } : p))
    setEditingField(null)
  }

  const beginEditFollowUp = () => {
    if (!payload) return
    setFollowUpDraft(payload.opportunity.followUpDate)
    setEditingField('followUp')
  }

  const saveFollowUp = (value: string) => {
    const id = payload?.opportunity.id
    if (!id || !value) {
      setEditingField(null)
      return
    }
    updateOpportunity(id, { followUpDate: value })
    setPayload((p) => (p ? { ...p, opportunity: { ...p.opportunity, followUpDate: value } } : p))
    setEditingField(null)
  }

  const beginEditNextStep = () => {
    if (!payload) return
    setNextStepDraft(payload.opportunity.nextStep)
    setEditingField('nextStep')
  }

  /**
   * Saving a new next step logs the value it's replacing as a timeline
   * activity first, so the drawer's history shows what was planned at each
   * point rather than only ever the latest plan.
   */
  const saveNextStep = () => {
    const id = payload?.opportunity.id
    if (!id || !payload) return
    const next = nextStepDraft.trim()
    const previous = payload.opportunity.nextStep
    if (next === previous) {
      setEditingField(null)
      return
    }
    if (previous) {
      // Store update alone is enough — the drawer's `notes` prop is a live
      // selection from the store (see leads/page.tsx's `drawerNotes`), so it
      // flows back in and refreshes `payload.notes` on its own.
      addNote({
        id: newId(),
        opportunityId: id,
        raw: copy.nextStepLogged(previous),
        createdAt: new Date().toISOString(),
      })
    }
    updateOpportunity(id, { nextStep: next })
    setPayload((p) => (p ? { ...p, opportunity: { ...p.opportunity, nextStep: next } } : p))
    setEditingField(null)
  }

  const beginEditTags = () => {
    if (!payload) return
    setTagsDraft(payload.opportunity.tags.join(', '))
    setEditingField('tags')
  }

  const saveTags = () => {
    const id = payload?.opportunity.id
    if (!id) return
    const tags = Array.from(new Set(tagsDraft.split(',').map((s) => s.trim()).filter(Boolean)))
    updateOpportunity(id, { tags })
    setPayload((p) => (p ? { ...p, opportunity: { ...p.opportunity, tags } } : p))
    setEditingField(null)
  }

  if (!mounted) return null

  const meta = payload
    ? [payload.company.industry, payload.company.size, payload.company.location].filter(Boolean)
    : []

  return createPortal(
    <>
      <div
        className={cn(
          'fixed inset-0 bg-black/40 backdrop-blur-[3px] z-40 transition-opacity duration-300',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onMouseDown={requestClose}
        aria-hidden="true"
      />

      {/* `inert` keeps the off-screen panel out of the tab order while it sits closed. */}
      <div
        ref={panelRef}
        data-theme="dark"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!isOpen}
        tabIndex={-1}
        className={cn(
          'grain-modal grain-drawer fixed right-0 top-0 z-50 h-dvh w-full max-w-none',
          'max-sm:rounded-none! max-sm:border-l-0! sm:h-full sm:w-[520px] sm:max-w-[92vw]',
          'pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] sm:pl-0',
          'flex flex-col outline-none',
          'transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
        inert={!isOpen}
      >
        {payload && (
          <>
            <div className="flex shrink-0 items-start justify-between border-b border-border-subtle px-4 pb-4 pt-[calc(1.25rem+env(safe-area-inset-top))] sm:px-6 sm:pt-5">
              <div className="flex-1 min-w-0 pr-4">
                {editingField === 'companyName' ? (
                  <input
                    autoFocus
                    id={titleId}
                    value={companyNameDraft}
                    onChange={(e) => setCompanyNameDraft(e.target.value)}
                    onBlur={saveCompanyName}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); saveCompanyName() }
                      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingField(null) }
                    }}
                    className="w-full bg-transparent text-[20px] font-jakarta font-semibold text-foreground tracking-[-0.02em] outline-none border-b border-accent/50"
                  />
                ) : (
                  <h2
                    id={titleId}
                    onClick={beginEditCompanyName}
                    className="text-[20px] font-jakarta font-semibold text-foreground tracking-[-0.02em] truncate cursor-pointer hover:text-accent transition-colors"
                  >
                    {payload.company.name}
                  </h2>
                )}
                {meta.length > 0 && (
                  <p className="text-[13px] text-foreground/80 mt-0.5 truncate">
                    {meta.join(' · ')}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={requestClose}
                aria-label={t.crm.modal.closeDetails}
                className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-surface-raised hover:text-foreground sm:mr-0 sm:mt-0 sm:h-8 sm:w-8"
              >
                <X size={17} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {/* Contact */}
              <div className="border-b border-border-subtle px-4 py-4 sm:px-6">
                <p className="label-mono mb-2.5">{copy.primaryContact}</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-accent-light flex items-center justify-center shrink-0">
                    <span className="text-[14px] font-semibold text-accent">
                      {payload.contact.name.charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    {editingField === 'contactName' ? (
                      <input
                        autoFocus
                        value={contactNameDraft}
                        onChange={(e) => setContactNameDraft(e.target.value)}
                        onBlur={saveContactName}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); saveContactName() }
                          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingField(null) }
                        }}
                        className="w-full bg-transparent text-[14px] font-medium text-foreground outline-none border-b border-accent/50"
                      />
                    ) : (
                      <p
                        onClick={beginEditContactName}
                        className="text-[14px] font-medium text-foreground truncate cursor-pointer hover:text-accent transition-colors"
                      >
                        {payload.contact.name}
                      </p>
                    )}
                    <p className="text-[13px] text-foreground/80 truncate">{payload.contact.role}</p>
                  </div>
                  {payload.contact.linkedin && (
                    <a
                      href={`https://${payload.contact.linkedin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={copy.openLinkedIn(payload.contact.name)}
                      className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-surface-raised hover:text-accent sm:h-8 sm:w-8"
                    >
                      <ExternalLink size={15} />
                    </a>
                  )}
                </div>
                <a
                  href={`mailto:${payload.contact.email}`}
                  className="mt-2 flex min-h-11 touch-manipulation items-center truncate font-mono text-[13px] text-foreground/80 transition-colors hover:text-accent sm:mt-1 sm:min-h-0 sm:text-[12.5px]"
                >
                  {payload.contact.email}
                </a>
              </div>

              {/* Deal */}
              <div className="border-b border-border-subtle px-4 py-4 sm:px-6">
                <p className="label-mono mb-3">{copy.deal}</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {/* Stage — commits immediately, no separate save step */}
                  <div className="bg-background-raised border border-border-subtle rounded-lg px-3.5 py-3">
                    <p className="label-mono mb-1.5">{copy.stage}</p>
                    <div className="h-11 sm:h-7 flex items-center">
                      <InlineSelect
                        value={payload.opportunity.stage}
                        onChange={changeStage}
                        aria-label={copy.stage}
                        options={STAGES.map((s) => ({ value: s, label: t.stages[s] }))}
                        renderValue={(o) => (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-md px-2.5 h-7 text-[13px] font-medium',
                              stageColors[o.value]
                            )}
                          >
                            {o.label}
                            <ChevronDown size={12} className="opacity-60" />
                          </span>
                        )}
                      />
                    </div>
                  </div>

                  {/* Priority — commits immediately, no separate save step */}
                  <div className="bg-background-raised border border-border-subtle rounded-lg px-3.5 py-3">
                    <p className="label-mono mb-1.5">{copy.priority}</p>
                    <div className="h-11 sm:h-7 flex items-center">
                      <InlineSelect
                        value={payload.opportunity.priority}
                        onChange={changePriority}
                        aria-label={copy.priority}
                        options={PRIORITIES.map((p) => ({ value: p, label: t.priorities[p] }))}
                        renderValue={(o) => (
                          <span className="flex items-center gap-2 h-7">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ background: priorityDot[o.value] }}
                            />
                            <span className="text-[14px] font-medium text-foreground capitalize">
                              {o.label}
                            </span>
                            <ChevronDown size={12} className="text-foreground/50 opacity-60" />
                          </span>
                        )}
                      />
                    </div>
                  </div>

                  {/* Deal value — click to reveal a text input */}
                  <div className="bg-background-raised border border-border-subtle rounded-lg px-3.5 py-3">
                    <p className="label-mono mb-1.5">{copy.dealValue}</p>
                    {editingField === 'dealValue' ? (
                      <input
                        autoFocus
                        aria-label={copy.dealValue}
                        inputMode="decimal"
                        value={dealValueDraft}
                        onChange={(e) => setDealValueDraft(e.target.value)}
                        onBlur={saveDealValue}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); saveDealValue() }
                          else if (e.key === 'Escape') { e.preventDefault(); setEditingField(null) }
                        }}
                        className="h-11 w-full bg-transparent text-[16px] font-semibold tabular-nums text-foreground outline-none border-b border-accent/50 sm:h-7"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={beginEditDealValue}
                        className="flex h-11 w-full touch-manipulation items-center text-left sm:h-7"
                      >
                        <span className="text-[16px] font-semibold text-foreground tabular-nums">
                          {payload.opportunity.dealValue !== undefined ? (
                            fmt.currency(payload.opportunity.dealValue, { compact: false })
                          ) : (
                            <span className="text-foreground/50 font-normal">—</span>
                          )}
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Follow-up date — click to reveal a date input */}
                  <div className="bg-background-raised border border-border-subtle rounded-lg px-3.5 py-3">
                    <p className="label-mono mb-1.5">{copy.followUp}</p>
                    {editingField === 'followUp' ? (
                      <input
                        autoFocus
                        aria-label={copy.followUp}
                        type="date"
                        value={followUpDraft}
                        onChange={(e) => setFollowUpDraft(e.target.value)}
                        onBlur={(e) => saveFollowUp(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); saveFollowUp(followUpDraft) }
                          else if (e.key === 'Escape') { e.preventDefault(); setEditingField(null) }
                        }}
                        className="h-11 w-full bg-transparent font-mono text-[16px] tabular-nums text-foreground outline-none border-b border-accent/50 sm:h-7 sm:text-[14px]"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={beginEditFollowUp}
                        className="flex h-11 w-full touch-manipulation items-center gap-1.5 text-left sm:h-7"
                      >
                        <Calendar size={13} className="text-foreground/70 shrink-0" />
                        <span className="text-[14px] text-foreground font-mono tabular-nums">
                          {fmt.date(payload.opportunity.followUpDate)}
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Next step — click to edit; the previous value is logged to
                    the timeline below as an activity before it's overwritten */}
                <div className="mt-3 bg-accent-light border border-border-accent rounded-lg px-4 py-3.5">
                  <div className="flex items-start gap-2.5">
                    <ArrowRight size={14} className="mt-0.5 text-accent shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="label-mono text-accent mb-1">{copy.nextStep}</p>
                      {editingField === 'nextStep' ? (
                        <input
                          autoFocus
                          aria-label={copy.nextStep}
                          value={nextStepDraft}
                          onChange={(e) => setNextStepDraft(e.target.value)}
                          onBlur={saveNextStep}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); saveNextStep() }
                            else if (e.key === 'Escape') { e.preventDefault(); setEditingField(null) }
                          }}
                          placeholder={copy.nextStepPlaceholder}
                          className="min-h-11 w-full bg-transparent text-[16px] leading-relaxed text-foreground outline-none border-b border-accent/50 sm:min-h-0 sm:text-[14px]"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={beginEditNextStep}
                          className="block min-h-11 w-full touch-manipulation text-left text-[14px] leading-relaxed text-foreground sm:min-h-0"
                        >
                          {payload.opportunity.nextStep || (
                            <span className="text-foreground/50">{copy.nextStepPlaceholder}</span>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Tags — click to reveal a comma-separated text input */}
                <div className="mt-3">
                  {editingField === 'tags' ? (
                    <input
                      autoFocus
                      aria-label={copy.tags}
                      value={tagsDraft}
                      onChange={(e) => setTagsDraft(e.target.value)}
                      onBlur={saveTags}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); saveTags() }
                        else if (e.key === 'Escape') { e.preventDefault(); setEditingField(null) }
                      }}
                      placeholder={copy.tagsPlaceholder}
                      className="h-11 w-full rounded-md border border-accent/50 bg-background-raised px-2.5 font-mono text-[16px] text-foreground outline-none sm:h-8 sm:text-[12.5px]"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={beginEditTags}
                      className="flex min-h-11 w-full touch-manipulation flex-wrap items-center gap-1.5 text-left sm:min-h-[26px]"
                    >
                      {payload.opportunity.tags.length > 0 ? (
                        payload.opportunity.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[11.5px] font-mono px-2.5 py-1 bg-surface-raised text-foreground/80 rounded-md border border-border-subtle"
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-[12px] text-foreground/50">{copy.tags}</span>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div className="px-4 py-4 sm:px-6">
                <div className="flex items-center justify-between mb-3">
                  <p className="label-mono">{copy.notes}</p>
                  {!editingNotes && (
                    <button
                      type="button"
                      onClick={beginEditNotes}
                      className="flex min-h-11 touch-manipulation items-center gap-1.5 text-[13px] text-foreground/70 transition-colors hover:text-foreground sm:min-h-0 sm:text-[12px]"
                    >
                      <Pencil size={12} />
                      {payload.opportunity.notes ? t.common.edit : copy.addNote}
                    </button>
                  )}
                </div>

                {editingNotes ? (
                  <div className="mb-4">
                    <textarea
                      ref={notesInputRef}
                      aria-label={copy.notes}
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      onKeyDown={handleNotesKeyDown}
                      rows={4}
                      className={cn(
                        'w-full px-4 py-3.5 bg-background-raised rounded-lg border border-border-subtle',
                        'text-[16px] text-foreground leading-relaxed resize-y outline-none sm:text-[14px]',
                        'focus:border-accent/50 transition-[border-color] duration-100 ease-out'
                      )}
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                      <span className="w-full text-[11px] text-foreground/50 font-mono sm:mr-auto sm:w-auto">{copy.saveHint}</span>
                      <button
                        type="button"
                        onClick={cancelEditNotes}
                        className="h-11 touch-manipulation rounded-lg px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-raised sm:h-8"
                      >
                        {t.common.cancel}
                      </button>
                      <Button size="sm" onClick={saveNotes}>
                        {t.common.save}
                      </Button>
                    </div>
                  </div>
                ) : payload.opportunity.notes ? (
                  <button
                    type="button"
                    onClick={beginEditNotes}
                    className={cn(
                      'w-full text-left mb-4 px-4 py-3.5 bg-background-raised rounded-lg border border-border-subtle',
                      'hover:border-border transition-[border-color] duration-100 ease-out'
                    )}
                  >
                    <p className="text-[14px] text-foreground leading-relaxed whitespace-pre-wrap">
                      {payload.opportunity.notes}
                    </p>
                  </button>
                ) : null}

                <NotesTimeline notes={payload.notes} />
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border-subtle px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:py-4">
              <p className="text-[13px] text-foreground/80">
                {copy.lastInteraction}{' '}
                <span className="text-foreground font-mono">
                  {fmt.date(payload.opportunity.lastInteraction)}
                </span>
              </p>
              <span className="hidden text-[12px] text-foreground font-mono opacity-60 sm:inline">esc</span>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={discardOpen}
        title={copy.discardTitle}
        description={copy.discardDescription}
        confirmLabel={copy.discard}
        cancelLabel={t.common.keepEditing}
        onConfirm={confirmDiscardNotes}
        onCancel={() => {
          setDiscardOpen(false)
          setDiscardClosesDrawer(false)
        }}
      />
    </>,
    document.body
  )
}
