'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import { AddCompanyModal } from '@/components/crm/AddCompanyModal'
import { Button } from '@/components/crm/Button'
import { useCRMStore } from '@/lib/store'
import { useFormat } from '@/lib/hooks/useFormat'
import { Building2, Search, MapPin, X, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Company, Opportunity, Contact } from '@/lib/types'
import { useTranslations } from '@/lib/hooks/useTranslations'
import { useDialogBehavior } from '@/lib/hooks/useDialog'

/** Same lookup AddCompanyModal's revenue field uses — Tailwind needs whole
 *  class names at build time, so the currency symbol's width can't interpolate. */
function symbolPadding(symbol: string): string {
  if (symbol.length <= 1) return 'pl-11'
  if (symbol.length === 2) return 'pl-14'
  return 'pl-[4.5rem]'
}

interface CompanyDrawerProps {
  company: Company | null
  opportunities: Opportunity[]
  contacts: Contact[]
  onClose: () => void
}

function CompanyDrawer({ company, opportunities, contacts, onClose }: CompanyDrawerProps) {
  const { t } = useTranslations()
  const fmt = useFormat()
  const updateCompany = useCRMStore((s) => s.updateCompany)
  const isOpen = !!company
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // Same one-field-at-a-time inline editor as DetailDrawer — immediate
  // commit, no draft/discard dance.
  const [editingField, setEditingField] = useState<'revenue' | 'employeeCount' | 'about' | null>(null)
  const [revenueDraft, setRevenueDraft] = useState('')
  const [employeeCountDraft, setEmployeeCountDraft] = useState('')
  const [aboutDraft, setAboutDraft] = useState('')

  useDialogBehavior({
    open: isOpen,
    onClose,
    panelRef,
    shouldIgnoreEscape: () => editingField !== null,
  })

  useEffect(() => {
    if (isOpen) panelRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    setEditingField(null)
  }, [company?.id])

  const beginEditRevenue = () => {
    if (!company) return
    setRevenueDraft(
      company.revenue !== undefined ? String(Math.round(fmt.fromBase(company.revenue))) : ''
    )
    setEditingField('revenue')
  }

  const saveRevenue = () => {
    if (!company) return
    const raw = Number(revenueDraft.replace(/[^0-9.]/g, ''))
    const revenue = Number.isFinite(raw) && raw > 0 ? fmt.toBase(raw) : undefined
    updateCompany(company.id, { revenue })
    setEditingField(null)
  }

  const beginEditEmployeeCount = () => {
    if (!company) return
    setEmployeeCountDraft(company.employeeCount !== undefined ? String(company.employeeCount) : '')
    setEditingField('employeeCount')
  }

  const saveEmployeeCount = () => {
    if (!company) return
    const raw = Number(employeeCountDraft.replace(/[^0-9]/g, ''))
    const employeeCount = Number.isFinite(raw) && raw > 0 ? raw : undefined
    updateCompany(company.id, { employeeCount })
    setEditingField(null)
  }

  const beginEditAbout = () => {
    if (!company) return
    setAboutDraft(company.about ?? '')
    setEditingField('about')
  }

  const saveAbout = () => {
    if (!company) return
    updateCompany(company.id, { about: aboutDraft.trim() || undefined })
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
          'fixed inset-y-0 right-0 h-dvh w-full max-w-none bg-surface z-50 sm:h-full sm:w-[480px] sm:max-w-[90vw]',
          'flex flex-col border-border outline-none pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] sm:border-l sm:pl-0',
          'transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {company && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] shrink-0 sm:p-5">
              <div className="flex min-w-0 items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent-light flex items-center justify-center shrink-0">
                  <Building2 size={18} className="text-accent" />
                </div>
                <div className="min-w-0">
                  <h2 id={titleId} className="break-words text-[17px] font-semibold text-foreground font-display">{company.name}</h2>
                  <p className="mt-1 break-all text-[13.5px] text-foreground/60 font-mono">{company.domain}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t.crm.modal.closeDetails}
                className="-mr-1 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-xl text-foreground/60 transition-colors hover:bg-surface-raised hover:text-foreground sm:mr-0 sm:mt-0 sm:size-9 sm:rounded-lg"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
              <div className="border-b border-border-subtle px-4 py-4 sm:px-5">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="min-w-0 rounded-lg bg-background-raised px-3 py-2.5">
                    <p className="label-mono mb-1">{t.companies.industry}</p>
                    <p className="break-words text-[14.5px] font-medium text-foreground">{company.industry}</p>
                  </div>
                  <div className="min-w-0 rounded-lg bg-background-raised px-3 py-2.5">
                    <p className="label-mono mb-1">{t.companies.size}</p>
                    <p className="break-words text-[14.5px] font-medium text-foreground">{company.size}</p>
                  </div>
                  <div className="col-span-2 min-w-0 rounded-lg bg-background-raised px-3 py-2.5 sm:col-span-1">
                    <p className="label-mono mb-1">{t.companies.location}</p>
                    <p className="break-words text-[14.5px] font-medium text-foreground">{company.location}</p>
                  </div>
                </div>
                {company.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {company.tags.map(tag => (
                      <span key={tag} className="text-[12.5px] font-mono px-2 py-0.5 bg-accent-light text-accent rounded-md">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Enrichment — click to set, same as DetailDrawer's inline
                  editors. Blank today for most companies; the whole point of
                  these fields existing is somewhere for a future scrape to
                  land, so an empty state has to look inviting to fill in
                  rather than like a missing feature. */}
              <div className="border-b border-border-subtle px-4 py-4 sm:px-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0 rounded-lg bg-background-raised px-3 py-2.5">
                    <p className="label-mono mb-1">{t.companies.revenue}</p>
                    {editingField === 'revenue' ? (
                      <div className="relative">
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[14.5px] text-foreground/70 pointer-events-none select-none">
                          {fmt.symbol}
                        </span>
                        <input
                          autoFocus
                          aria-label={t.companies.revenue}
                          inputMode="decimal"
                          value={revenueDraft}
                          onChange={(e) => setRevenueDraft(e.target.value)}
                          onBlur={saveRevenue}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); saveRevenue() }
                            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingField(null) }
                          }}
                          className={cn(
                            'w-full bg-transparent text-[14.5px] font-medium tabular-nums text-foreground outline-none border-b border-accent/50',
                            symbolPadding(fmt.symbol)
                          )}
                        />
                      </div>
                    ) : (
                      <p
                        onClick={beginEditRevenue}
                        className="break-words text-[14.5px] font-medium text-foreground cursor-pointer hover:text-accent transition-colors tabular-nums"
                      >
                        {company.revenue !== undefined ? (
                          fmt.currency(company.revenue, { compact: false })
                        ) : (
                          <span className="text-foreground/50 font-normal">—</span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="min-w-0 rounded-lg bg-background-raised px-3 py-2.5">
                    <p className="label-mono mb-1">{t.companies.employeeCount}</p>
                    {editingField === 'employeeCount' ? (
                      <input
                        autoFocus
                        aria-label={t.companies.employeeCount}
                        inputMode="numeric"
                        value={employeeCountDraft}
                        onChange={(e) => setEmployeeCountDraft(e.target.value)}
                        onBlur={saveEmployeeCount}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); saveEmployeeCount() }
                          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingField(null) }
                        }}
                        className="w-full bg-transparent text-[14.5px] font-medium tabular-nums text-foreground outline-none border-b border-accent/50"
                      />
                    ) : (
                      <p
                        onClick={beginEditEmployeeCount}
                        className="break-words text-[14.5px] font-medium text-foreground cursor-pointer hover:text-accent transition-colors tabular-nums"
                      >
                        {company.employeeCount !== undefined ? (
                          company.employeeCount
                        ) : (
                          <span className="text-foreground/50 font-normal">—</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <p className="label-mono mb-1">{t.companies.about}</p>
                  {editingField === 'about' ? (
                    <textarea
                      autoFocus
                      aria-label={t.companies.about}
                      value={aboutDraft}
                      onChange={(e) => setAboutDraft(e.target.value)}
                      onBlur={saveAbout}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingField(null) }
                      }}
                      placeholder={t.companies.aboutPlaceholder}
                      rows={3}
                      className="w-full resize-y bg-transparent text-[14px] text-foreground/85 leading-relaxed outline-none border-b border-accent/50"
                    />
                  ) : (
                    <p
                      onClick={beginEditAbout}
                      className="cursor-pointer whitespace-pre-wrap break-words text-[14px] leading-relaxed transition-colors hover:text-accent"
                    >
                      {company.about || (
                        <span className="text-[13.5px] text-foreground/50">{t.companies.aboutPlaceholder}</span>
                      )}
                    </p>
                  )}
                </div>
              </div>

              <div className="border-b border-border-subtle px-4 py-4 sm:px-5">
                <p className="label-mono mb-3">{t.companies.contacts}</p>
                {contacts.length === 0 ? (
                  <p className="text-[13.5px] text-foreground/60">{t.companies.noContacts}</p>
                ) : (
                  <div className="space-y-2.5">
                    {contacts.map(c => (
                      <div key={c.id} className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent-light flex items-center justify-center shrink-0">
                          <span className="text-[13.5px] font-semibold text-accent">{c.name.charAt(0)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[15px] font-medium text-foreground truncate">{c.name}</p>
                          <p className="text-[13.5px] text-foreground/60 truncate">{c.role}</p>
                        </div>
                        <p className="text-[13.5px] text-foreground/65 font-mono hidden sm:block truncate">{c.email}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="px-4 py-4 sm:px-5">
                <p className="label-mono mb-3">{t.companies.opportunities}</p>
                {opportunities.length === 0 ? (
                  <p className="text-[13.5px] text-foreground/60">{t.companies.noOpportunities}</p>
                ) : (
                  <div className="space-y-2">
                    {opportunities.map(opp => (
                      <div key={opp.id} className="bg-background-raised border border-border-subtle rounded-lg p-3">
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[12.5px] font-medium px-2 py-0.5 bg-surface-raised rounded-md text-foreground/80 border border-border-subtle">
                            {t.stages[opp.stage]}
                          </span>
                          {opp.dealValue && (
                            <span className="text-[15px] font-semibold text-foreground tabular-nums">
                              {fmt.currency(opp.dealValue)}
                            </span>
                          )}
                        </div>
                        <p className="text-[14.5px] text-foreground/85 mt-2 leading-snug">{opp.nextStep}</p>
                        <p className="text-[13.5px] text-foreground/65 font-mono mt-1.5">{t.companies.followUp} {fmt.date(opp.followUpDate)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

export default function CompaniesPage() {
  const { t } = useTranslations()
  const fmt = useFormat()
  const companies = useCRMStore((s) => s.companies)
  const opportunities = useCRMStore((s) => s.opportunities)
  const contacts = useCRMStore((s) => s.contacts)
  const searchQuery = useCRMStore((s) => s.searchQuery)
  const setSearchQuery = useCRMStore((s) => s.setSearchQuery)

  const [localSearch, setLocalSearch] = useState('')
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [addCompanyOpen, setAddCompanyOpen] = useState(false)

  const query = localSearch || searchQuery

  const filtered = useMemo(() => {
    if (!query) return companies
    const q = query.toLowerCase()
    return companies.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.industry.toLowerCase().includes(q) ||
      c.domain.toLowerCase().includes(q) ||
      c.location.toLowerCase().includes(q)
    )
  }, [companies, query])

  const selectedCompany = selectedCompanyId ? companies.find(c => c.id === selectedCompanyId) ?? null : null
  const selectedOpps = selectedCompany ? opportunities.filter(o => o.companyId === selectedCompany.id) : []
  const selectedContacts = selectedCompany ? contacts.filter(c => c.companyId === selectedCompany.id) : []

  return (
    <>
      <Topbar />
      <main className="flex-1 animate-fade-in-up px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[28px] font-jakarta font-semibold text-foreground tracking-[-0.02em] leading-none sm:text-[30px]">{t.companies.title}</h2>
            <p className="text-[15px] text-foreground/60 mt-1.5 font-mono tabular-nums">{t.companies.tracked(filtered.length)}</p>
          </div>
          <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative flex w-full items-center sm:w-auto">
              <Search size={14} className="pointer-events-none absolute left-3 text-foreground/60 sm:left-2.5" />
              <input
                type="text"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder={t.companies.filter}
                className="h-11 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-[16px] text-foreground outline-none transition-all placeholder:text-foreground/45 focus:border-accent/40 sm:h-9 sm:w-52 sm:rounded-lg sm:pl-8 sm:text-[14px]"
              />
            </div>
            <Button onClick={() => setAddCompanyOpen(true)} className="h-11 w-full sm:h-[38px] sm:w-auto">
              <Plus size={15} />
              {t.companies.newCompany}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger-children">
          {filtered.length === 0 ? (
            <div className="col-span-full flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface/60 px-5 py-8 text-center">
              <Search size={20} className="mb-3 text-muted" aria-hidden="true" />
              <p className="text-[15px] text-foreground/70">{t.companies.empty}</p>
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setLocalSearch('')
                    setSearchQuery('')
                  }}
                  className="mt-3 min-h-11 rounded-lg px-4 text-[14px] font-medium text-accent transition-colors hover:bg-accent-light"
                >
                  {t.common.clearFilters}
                </button>
              )}
            </div>
          ) : filtered.map(company => {
            const oppCount = opportunities.filter(o => o.companyId === company.id).length
            const contactCount = contacts.filter(c => c.companyId === company.id).length
            const totalValue = opportunities
              .filter(o => o.companyId === company.id)
              .reduce((sum, o) => sum + (o.dealValue ?? 0), 0)

            return (
              <button
                key={company.id}
                onClick={() => setSelectedCompanyId(company.id)}
                className={cn(
                  'text-left bg-surface border border-border rounded-xl p-4',
                  'hover:border-border-accent card-glow transition-all duration-200 cursor-pointer',
                  'group'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-accent-light flex items-center justify-center shrink-0 group-hover:bg-accent/15 transition-colors">
                    <Building2 size={16} className="text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-foreground truncate">{company.name}</p>
                    <p className="text-[13.5px] text-foreground/60 mt-0.5 font-mono truncate">{company.domain}</p>
                  </div>
                </div>

                <div className="mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-foreground/60">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <MapPin size={12} className="shrink-0" />
                    <span className="break-words">{company.location}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-border">·</span>
                    <span className="break-words">{company.industry}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-border">·</span>
                    <span className="break-words">{company.size}</span>
                  </span>
                </div>

                <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle pt-3.5">
                  <div className="flex items-baseline gap-1.5 text-[13.5px]">
                    <span className="text-foreground/60">{t.companies.deals}</span>
                    <span className="font-semibold text-foreground tabular-nums">{oppCount}</span>
                  </div>
                  <div className="flex items-baseline gap-1.5 text-[13.5px]">
                    <span className="text-foreground/60">{t.companies.contacts}:</span>
                    <span className="font-semibold text-foreground tabular-nums">{contactCount}</span>
                  </div>
                  {totalValue > 0 && (
                    <span className="ml-auto text-[15px] font-semibold text-accent tabular-nums">
                      {fmt.currency(totalValue)}
                    </span>
                  )}
                </div>

                {company.tags.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {company.tags.map(tag => (
                      <span
                        key={tag}
                        className="text-[12.5px] font-mono px-2 py-0.5 bg-accent-light text-accent rounded-md"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </main>

      <AddCompanyModal open={addCompanyOpen} onClose={() => setAddCompanyOpen(false)} />

      <CompanyDrawer
        company={selectedCompany}
        opportunities={selectedOpps}
        contacts={selectedContacts}
        onClose={() => setSelectedCompanyId(null)}
      />
    </>
  )
}
