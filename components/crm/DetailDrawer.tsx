'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ExternalLink, Calendar, ArrowRight, Pencil } from 'lucide-react'
import { Opportunity, Company, Contact, Note } from '@/lib/types'
import { NotesTimeline } from './NotesTimeline'
import { ConfirmDialog } from './ConfirmDialog'
import { useCRMStore } from '@/lib/store'
import { priorityDot, stageColors } from '@/lib/stage-config'
import { useDialogBehavior, useMounted } from '@/lib/hooks/useDialog'
import { useFormat } from '@/lib/hooks/useFormat'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

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

  // The selection clears the instant the drawer is dismissed, so hold on to the
  // last row we rendered — otherwise the panel slides out empty.
  const [payload, setPayload] = useState<DrawerPayload | null>(null)
  useEffect(() => {
    if (opportunity && company && contact) {
      setPayload({ opportunity, company, contact, notes })
    }
  }, [opportunity, company, contact, notes])

  const updateOpportunity = useCRMStore((s) => s.updateOpportunity)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [discardOpen, setDiscardOpen] = useState(false)
  const notesInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    editingNotesRef.current = editingNotes
  }, [editingNotes])

  useEffect(() => {
    discardOpenRef.current = discardOpen
  }, [discardOpen])

  // Never carry one lead's draft over to another, and drop the editor when the
  // drawer closes so it reopens in read mode.
  useEffect(() => {
    setEditingNotes(false)
    setDiscardOpen(false)
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

  /**
   * Whether confirming the discard should also dismiss the whole drawer, or
   * just leave the note editor. Set by whichever action raised the prompt.
   */
  const closeDrawerAfterDiscardRef = useRef(false)

  /** Discard immediately when nothing was typed; otherwise ask first. */
  const cancelEditNotes = () => {
    if (notesDirty) {
      // Leaving the editor only — the drawer itself stays open.
      closeDrawerAfterDiscardRef.current = false
      setDiscardOpen(true)
      return
    }
    setEditingNotes(false)
  }

  const confirmDiscardNotes = () => {
    setDiscardOpen(false)
    setEditingNotes(false)
    if (closeDrawerAfterDiscardRef.current) {
      closeDrawerAfterDiscardRef.current = false
      onClose()
    }
  }

  /** Dismissing the drawer with an unsaved note asks before throwing it away. */
  const requestClose = () => {
    if (notesDirty) {
      closeDrawerAfterDiscardRef.current = true
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
        tabIndex={-1}
        className={cn(
          'grain-modal grain-drawer fixed top-0 right-0 h-full w-[520px] max-w-[92vw] z-50',
          'flex flex-col outline-none',
          'transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
        inert={!isOpen}
      >
        {payload && (
          <>
            <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border-subtle shrink-0">
              <div className="flex-1 min-w-0 pr-4">
                <h2
                  id={titleId}
                  className="text-[20px] font-jakarta font-semibold text-foreground tracking-[-0.02em] truncate"
                >
                  {payload.company.name}
                </h2>
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
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-raised text-foreground/70 hover:text-foreground transition-colors shrink-0"
              >
                <X size={17} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain">
              {/* Contact */}
              <div className="px-6 py-4 border-b border-border-subtle">
                <p className="label-mono mb-2.5">{copy.primaryContact}</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-accent-light flex items-center justify-center shrink-0">
                    <span className="text-[14px] font-semibold text-accent">
                      {payload.contact.name.charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-foreground truncate">
                      {payload.contact.name}
                    </p>
                    <p className="text-[13px] text-foreground/80 truncate">{payload.contact.role}</p>
                  </div>
                  {payload.contact.linkedin && (
                    <a
                      href={`https://${payload.contact.linkedin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={copy.openLinkedIn(payload.contact.name)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground/70 hover:text-accent hover:bg-surface-raised transition-colors shrink-0"
                    >
                      <ExternalLink size={15} />
                    </a>
                  )}
                </div>
                <a
                  href={`mailto:${payload.contact.email}`}
                  className="mt-2.5 block text-[12.5px] text-foreground/80 hover:text-accent font-mono transition-colors truncate"
                >
                  {payload.contact.email}
                </a>
              </div>

              {/* Deal */}
              <div className="px-6 py-4 border-b border-border-subtle">
                <p className="label-mono mb-3">{copy.deal}</p>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-background-raised border border-border-subtle rounded-lg px-3.5 py-3">
                    <p className="label-mono mb-1.5">{copy.stage}</p>
                    <span
                      className={cn(
                        'inline-flex items-center h-7 px-2.5 rounded-md text-[13px] font-medium',
                        stageColors[payload.opportunity.stage]
                      )}
                    >
                      {t.stages[payload.opportunity.stage]}
                    </span>
                  </div>

                  <div className="bg-background-raised border border-border-subtle rounded-lg px-3.5 py-3">
                    <p className="label-mono mb-1.5">{copy.priority}</p>
                    <div className="flex items-center gap-2 h-7">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: priorityDot[payload.opportunity.priority] }}
                      />
                      <span className="text-[14px] font-medium text-foreground capitalize">
                        {t.priorities[payload.opportunity.priority]}
                      </span>
                    </div>
                  </div>

                  {payload.opportunity.dealValue !== undefined && (
                    <div className="bg-background-raised border border-border-subtle rounded-lg px-3.5 py-3">
                      <p className="label-mono mb-1.5">{copy.dealValue}</p>
                      <div className="flex items-center h-7">
                        <span className="text-[16px] font-semibold text-foreground tabular-nums">
                          {fmt.currency(payload.opportunity.dealValue, { compact: false })}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="bg-background-raised border border-border-subtle rounded-lg px-3.5 py-3">
                    <p className="label-mono mb-1.5">{copy.followUp}</p>
                    <div className="flex items-center gap-1.5 h-7">
                      <Calendar size={13} className="text-foreground/70 shrink-0" />
                      <span className="text-[14px] text-foreground font-mono tabular-nums">
                        {fmt.date(payload.opportunity.followUpDate)}
                      </span>
                    </div>
                  </div>
                </div>

                {payload.opportunity.nextStep && (
                  <div className="mt-3 bg-accent-light border border-border-accent rounded-lg px-4 py-3.5">
                    <div className="flex items-start gap-2.5">
                      <ArrowRight size={14} className="mt-0.5 text-accent shrink-0" />
                      <div className="min-w-0">
                        <p className="label-mono text-accent mb-1">{copy.nextStep}</p>
                        <p className="text-[14px] text-foreground leading-relaxed">
                          {payload.opportunity.nextStep}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Tags */}
              {payload.opportunity.tags.length > 0 && (
                <div className="px-6 py-4 border-b border-border-subtle">
                  <p className="label-mono mb-2.5">{copy.tags}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {payload.opportunity.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[11.5px] font-mono px-2.5 py-1 bg-surface-raised text-foreground/80 rounded-md border border-border-subtle"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="label-mono">{copy.notes}</p>
                  {!editingNotes && (
                    <button
                      type="button"
                      onClick={beginEditNotes}
                      className="flex items-center gap-1.5 text-[12px] text-foreground/70 hover:text-foreground transition-colors"
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
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      onKeyDown={handleNotesKeyDown}
                      rows={4}
                      className={cn(
                        'w-full px-4 py-3.5 bg-background-raised rounded-lg border border-border-subtle',
                        'text-[14px] text-foreground leading-relaxed resize-y outline-none',
                        'focus:border-accent/50 transition-[border-color] duration-100 ease-out'
                      )}
                    />
                    <div className="flex items-center justify-end gap-2 mt-2">
                      <span className="mr-auto text-[11px] text-foreground/50 font-mono">{copy.saveHint}</span>
                      <button
                        type="button"
                        onClick={cancelEditNotes}
                        className="h-8 px-3 rounded-lg text-[13px] font-medium text-foreground hover:bg-surface-raised transition-colors"
                      >
                        {t.common.cancel}
                      </button>
                      <button
                        type="button"
                        onClick={saveNotes}
                        className="h-8 px-3.5 rounded-lg text-[13px] font-medium bg-accent text-background hover:bg-accent-hover transition-colors"
                      >
                        {t.common.save}
                      </button>
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

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border-subtle shrink-0">
              <p className="text-[13px] text-foreground/80">
                {copy.lastInteraction}{' '}
                <span className="text-foreground font-mono">
                  {fmt.date(payload.opportunity.lastInteraction)}
                </span>
              </p>
              <span className="text-[12px] text-foreground font-mono opacity-60">esc</span>
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
        onCancel={() => setDiscardOpen(false)}
      />
    </>,
    document.body
  )
}
