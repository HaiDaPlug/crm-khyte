'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import { AddLeadModal } from '@/components/crm/AddLeadModal'
import { AddProspectModal } from '@/components/crm/AddProspectModal'
import { Button } from '@/components/crm/Button'
import { ConfirmDialog } from '@/components/crm/ConfirmDialog'
import { SearchInput } from '@/components/crm/SearchInput'
import { WeeklyProgressCard, DailyCountCard } from '@/components/crm/WeeklyProgressCard'
import { useCRMStore } from '@/lib/store'
import { useFormat } from '@/lib/hooks/useFormat'
import { useDialogBehavior } from '@/lib/hooks/useDialog'
import { Sparkles, Plus, ArrowRight, Users, X, Trash2, Search } from 'lucide-react'
import { priorityDot } from '@/lib/stage-config'
import { colleagues } from '@/lib/colleagues'
import { Lead, ColleagueId } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

interface LeadDrawerProps {
  lead: Lead | null
  onClose: () => void
  onPromote: (leadId: string) => void
  onDelete: (leadId: string) => void
}

function LeadDrawer({ lead, onClose, onPromote, onDelete }: LeadDrawerProps) {
  const { t } = useTranslations()
  const fmt = useFormat()
  const updateLead = useCRMStore((s) => s.updateLead)
  const isOpen = !!lead
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Which single field is mid-edit, if any — mirrors DetailDrawer's inline
  // editors: one field at a time, immediate commit, no draft/discard dance.
  const [editingField, setEditingField] = useState<'contactName' | 'source' | 'notes' | null>(null)
  const [contactNameDraft, setContactNameDraft] = useState('')
  const [sourceDraft, setSourceDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')

  useDialogBehavior({
    open: isOpen,
    onClose,
    panelRef,
    // A nested editor's Escape cancels that field instead of closing the whole
    // drawer — same contract DetailDrawer relies on for its inline editors.
    shouldIgnoreEscape: () => editingField !== null,
  })

  useEffect(() => {
    if (isOpen) panelRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    setConfirmingDelete(false)
    setEditingField(null)
  }, [lead?.id])

  const beginEditContactName = () => {
    if (!lead) return
    setContactNameDraft(lead.contactName ?? '')
    setEditingField('contactName')
  }

  const saveContactName = () => {
    if (!lead) return
    const contactName = contactNameDraft.trim()
    if (contactName !== (lead.contactName ?? '')) {
      updateLead(lead.id, { contactName: contactName || undefined })
    }
    setEditingField(null)
  }

  const beginEditSource = () => {
    if (!lead) return
    setSourceDraft(lead.source ?? '')
    setEditingField('source')
  }

  const saveSource = () => {
    if (!lead) return
    const source = sourceDraft.trim()
    if (source !== (lead.source ?? '')) {
      updateLead(lead.id, { source: source || undefined })
    }
    setEditingField(null)
  }

  const beginEditNotes = () => {
    if (!lead) return
    setNotesDraft(lead.notes ?? '')
    setEditingField('notes')
  }

  const saveNotes = () => {
    if (!lead) return
    const notes = notesDraft.trim()
    if (notes !== (lead.notes ?? '')) {
      updateLead(lead.id, { notes })
    }
    setEditingField(null)
  }

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 bg-black/40 backdrop-blur-[3px] z-40 transition-opacity duration-250',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onMouseDown={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!isOpen}
        tabIndex={-1}
        inert={!isOpen}
        className={cn(
          'fixed inset-y-0 right-0 h-dvh w-full max-w-none bg-surface z-50 sm:h-full sm:w-[440px] sm:max-w-[90vw]',
          'flex flex-col border-border outline-none pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] sm:border-l sm:pl-0',
          'transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {lead && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] shrink-0 sm:p-5">
              <div className="flex min-w-0 items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent-light flex items-center justify-center shrink-0">
                  <Sparkles size={16} className="text-accent" />
                </div>
                <div className="min-w-0">
                  <h2 id={titleId} className="break-words text-[17px] font-semibold text-foreground font-display">{lead.companyName}</h2>
                  <p className="mt-1 text-[13px] text-foreground/60 font-mono">{fmt.date(lead.createdAt)}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  aria-label={t.leads.delete}
                  className="flex size-11 items-center justify-center rounded-xl text-foreground/60 transition-colors hover:bg-danger-muted hover:text-danger sm:size-9 sm:rounded-lg"
                >
                  <Trash2 size={15} />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t.crm.modal.closeDetails}
                  className="-mr-1 -mt-1 flex size-11 items-center justify-center rounded-xl text-foreground/60 transition-colors hover:bg-surface-raised hover:text-foreground sm:mr-0 sm:mt-0 sm:size-9 sm:rounded-lg"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
              <div className="border-b border-border-subtle px-4 py-4 sm:px-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0 rounded-lg bg-background-raised px-3 py-2.5">
                    <p className="label-mono mb-1">{t.leads.priority}</p>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: priorityDot[lead.priority] }} />
                      <p className="text-[14.5px] font-medium text-foreground capitalize">{t.priorities[lead.priority]}</p>
                    </div>
                  </div>
                  <div className="min-w-0 rounded-lg bg-background-raised px-3 py-2.5">
                    <p className="label-mono mb-1">{t.crm.newLeadForm.contactName}</p>
                    {editingField === 'contactName' ? (
                      <input
                        autoFocus
                        aria-label={t.crm.newLeadForm.contactName}
                        value={contactNameDraft}
                        onChange={(e) => setContactNameDraft(e.target.value)}
                        onBlur={saveContactName}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); saveContactName() }
                          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingField(null) }
                        }}
                        className="w-full bg-transparent text-[14.5px] font-medium text-foreground outline-none border-b border-accent/50"
                      />
                    ) : (
                      <p
                        onClick={beginEditContactName}
                        className="break-words text-[14.5px] font-medium text-foreground cursor-pointer hover:text-accent transition-colors"
                      >
                        {lead.contactName || <span className="text-foreground/50 font-normal">—</span>}
                      </p>
                    )}
                  </div>
                  {lead.followedUpBy && (
                    <div className="min-w-0 rounded-lg bg-background-raised px-3 py-2.5">
                      <p className="label-mono mb-1">{t.crm.newLeadForm.followedUpBy}</p>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                          style={{ background: colleagues[lead.followedUpBy].color }}
                        >
                          {colleagues[lead.followedUpBy].name.charAt(0)}
                        </span>
                        <p className="text-[14.5px] font-medium text-foreground truncate">{colleagues[lead.followedUpBy].name}</p>
                      </div>
                    </div>
                  )}
                </div>

                {lead.connection && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-lg bg-accent-light border border-border-accent px-3.5 py-3">
                    <Users size={14} className="mt-0.5 text-accent shrink-0" />
                    <div className="min-w-0">
                      <p className="label-mono text-accent mb-1">{t.crm.newLeadForm.connection}</p>
                      <p className="text-[13.5px] text-foreground leading-relaxed break-words">{lead.connection}</p>
                    </div>
                  </div>
                )}

                <div className="mt-3 min-w-0 rounded-lg bg-background-raised px-3 py-2.5">
                  <p className="label-mono mb-1">{t.crm.newLeadForm.source}</p>
                  {editingField === 'source' ? (
                    <input
                      autoFocus
                      aria-label={t.crm.newLeadForm.source}
                      value={sourceDraft}
                      onChange={(e) => setSourceDraft(e.target.value)}
                      onBlur={saveSource}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); saveSource() }
                        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingField(null) }
                      }}
                      className="w-full bg-transparent text-[14.5px] text-foreground outline-none border-b border-accent/50"
                    />
                  ) : (
                    <p
                      onClick={beginEditSource}
                      className="break-words text-[14.5px] text-foreground cursor-pointer hover:text-accent transition-colors"
                    >
                      {lead.source || <span className="text-foreground/50">—</span>}
                    </p>
                  )}
                </div>
              </div>

              <div className="px-4 py-4 sm:px-5">
                <p className="label-mono mb-2.5">{t.leads.notes}</p>
                {editingField === 'notes' ? (
                  <textarea
                    autoFocus
                    aria-label={t.leads.notes}
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    onBlur={saveNotes}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingField(null) }
                    }}
                    rows={4}
                    className="w-full resize-y bg-transparent text-[14px] text-foreground/85 leading-relaxed outline-none border-b border-accent/50"
                  />
                ) : lead.notes ? (
                  <p
                    onClick={beginEditNotes}
                    className="cursor-pointer text-[14px] text-foreground/85 leading-relaxed whitespace-pre-wrap break-words transition-colors hover:text-accent"
                  >
                    {lead.notes}
                  </p>
                ) : (
                  <p onClick={beginEditNotes} className="cursor-pointer text-[13.5px] text-foreground/60 hover:text-accent transition-colors">
                    {t.crm.notes.empty}
                  </p>
                )}
              </div>
            </div>

            <div className="shrink-0 border-t border-border px-4 py-4 sm:px-5">
              <Button onClick={() => onPromote(lead.id)} className="w-full">
                {t.leads.promoteToProspect}
                <ArrowRight size={14} />
              </Button>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title={t.leads.deleteTitle}
        description={t.leads.deleteDescription}
        confirmLabel={t.leads.delete}
        onConfirm={() => {
          if (!lead) return
          setConfirmingDelete(false)
          onDelete(lead.id)
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  )
}

export default function LeadsPage() {
  const { t } = useTranslations()
  const leads = useCRMStore((s) => s.leads)
  const removeLead = useCRMStore((s) => s.removeLead)

  // Local to this page rather than the store's global `searchQuery` — that field
  // is shared, so a query typed on /prospects would follow you here.
  const [searchQuery, setSearchQuery] = useState('')
  // Scopes the count cards only — see the note where they're rendered.
  const [cardColleague, setCardColleague] = useState<ColleagueId | null>(null)
  const [addLeadOpen, setAddLeadOpen] = useState(false)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [promoteLeadId, setPromoteLeadId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return leads
    // Everything the card and drawer surface as text, so what you can read you
    // can search — company name alone missed contacts and connections entirely.
    return leads.filter((l) =>
      l.companyName.toLowerCase().includes(q) ||
      (l.contactName?.toLowerCase().includes(q) ?? false) ||
      (l.connection?.toLowerCase().includes(q) ?? false) ||
      (l.source?.toLowerCase().includes(q) ?? false) ||
      l.notes.toLowerCase().includes(q)
    )
  }, [leads, searchQuery])

  const selectedLead = selectedLeadId ? leads.find((l) => l.id === selectedLeadId) ?? null : null

  const beginPromote = (leadId: string) => {
    setSelectedLeadId(null)
    setPromoteLeadId(leadId)
  }

  return (
    <>
      <Topbar />
      <main className="min-w-0 flex-1 px-4 py-5 animate-fade-in-up sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[26px] font-jakarta font-semibold text-foreground tracking-[-0.02em] leading-none sm:text-[30px]">{t.leads.allLeads}</h2>
            <p className="text-[15px] text-foreground/60 mt-1.5 font-mono tabular-nums">
              {t.leads.count(filtered.length, leads.length)}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:items-center">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t.leads.search}
              label={t.leads.searchLabel}
              className="w-full sm:w-64"
            />
            <Button onClick={() => setAddLeadOpen(true)} className="h-11 w-full shrink-0 sm:h-[38px] sm:w-auto">
              <Plus size={15} />
              {t.leads.newLead}
            </Button>
          </div>
        </div>

        {/* Right-aligned above the grid, matching /prospects — the counts sit
            directly over the cards they describe. Picking a person here narrows
            the numbers only: a Lead's `followedUpBy` records who should chase
            it, while the card counts who *added* it, so filtering the grid by
            the same name would answer a different question than the one asked. */}
        <div className="mb-4 flex gap-2.5 sm:ml-auto sm:w-max">
          <DailyCountCard
            metricKind="lead_added"
            colleague={cardColleague}
            onColleagueChange={setCardColleague}
            className="flex-1 sm:w-[136px] sm:flex-none"
          />
          <WeeklyProgressCard
            metricKind="lead_added"
            colleague={cardColleague}
            onColleagueChange={setCardColleague}
            className="flex-1 sm:w-[184px] sm:flex-none"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface/60 px-5 py-10 text-center">
            {searchQuery.trim() ? (
              <>
                <Search size={20} className="mb-3 text-muted" aria-hidden="true" />
                <p className="max-w-sm text-[15px] text-foreground/70">{t.leads.noMatches}</p>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="mt-3 min-h-11 rounded-lg px-4 text-[14px] font-medium text-accent transition-colors hover:bg-accent-light"
                >
                  {t.common.clearSearch}
                </button>
              </>
            ) : (
              <>
                <Sparkles size={20} className="mb-3 text-muted" aria-hidden="true" />
                <p className="max-w-sm text-[15px] text-foreground/70">{t.leads.empty}</p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 stagger-children">
            {filtered.map((lead) => (
              <div
                key={lead.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedLeadId(lead.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelectedLeadId(lead.id)
                  }
                }}
                className="text-left bg-surface border border-border rounded-xl p-4 hover:border-border-accent card-glow transition-all duration-200 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[15px] font-semibold text-foreground leading-snug break-words">
                    {lead.companyName}
                  </p>
                  <span
                    className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                    style={{ background: priorityDot[lead.priority] }}
                    aria-label={t.priorities[lead.priority]}
                  />
                </div>

                {lead.contactName && (
                  <p className="mt-1 text-[13.5px] text-foreground/60 truncate">{lead.contactName}</p>
                )}

                {lead.connection && (
                  <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-accent">
                    <Users size={12} className="shrink-0" />
                    <span className="truncate">{lead.connection}</span>
                  </p>
                )}

                {lead.notes && (
                  <p className="mt-2 text-[13.5px] text-foreground/70 leading-relaxed line-clamp-3">
                    {lead.notes}
                  </p>
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    beginPromote(lead.id)
                  }}
                  className="mt-3.5 flex items-center gap-1.5 text-[13px] font-medium text-accent transition-colors hover:text-accent-hover"
                >
                  {t.leads.promoteToProspect}
                  <ArrowRight size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </main>

      <AddLeadModal open={addLeadOpen} onClose={() => setAddLeadOpen(false)} />

      <LeadDrawer
        lead={selectedLead}
        onClose={() => setSelectedLeadId(null)}
        onPromote={beginPromote}
        onDelete={(leadId) => {
          setSelectedLeadId(null)
          removeLead(leadId)
        }}
      />

      <AddProspectModal
        open={promoteLeadId !== null}
        onClose={() => setPromoteLeadId(null)}
        fromLeadId={promoteLeadId}
      />
    </>
  )
}
