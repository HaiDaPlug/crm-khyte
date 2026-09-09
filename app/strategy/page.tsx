'use client'

import { useState, useMemo, useRef, useEffect, useId } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import { StrategyBoard } from '@/components/crm/StrategyBoard'
import { AddProspectModal } from '@/components/crm/AddProspectModal'
import { LinkProspectsModal } from '@/components/crm/LinkProspectsModal'
import { Button } from '@/components/crm/Button'
import { useCRMStore } from '@/lib/store'
import { useFormat } from '@/lib/hooks/useFormat'
import { useBoardIdForOpportunity } from '@/lib/hooks/useBoardIdForOpportunity'
import { ChevronDown, Link2, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { priorityDot } from '@/lib/stage-config'
import { useTranslations } from '@/lib/hooks/useTranslations'

export default function StrategyPage() {
  const { t } = useTranslations()
  const fmt = useFormat()
  const opportunities = useCRMStore((s) => s.opportunities)
  const companies = useCRMStore((s) => s.companies)
  const strategyBoardOpportunities = useCRMStore((s) => s.strategyBoardOpportunities)

  const [selectedOpportunityId, setSelectedOpportunityId] = useState(opportunities[1]?.id ?? opportunities[0]?.id)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [addProspectOpen, setAddProspectOpen] = useState(false)
  const [linkProspectsOpen, setLinkProspectsOpen] = useState(false)

  const searchInputId = useId()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selectedOpp = useMemo(
    () => opportunities.find(o => o.id === selectedOpportunityId),
    [selectedOpportunityId, opportunities]
  )

  const selectedCompany = useMemo(
    () => companies.find(c => c.id === selectedOpp?.companyId),
    [selectedOpp, companies]
  )

  const boardId = useBoardIdForOpportunity(selectedOpportunityId ?? '')

  // Other prospects sharing the currently-viewed board, company name only —
  // resolving stage/value here would be noise for what's meant to be a quick
  // "who else is on this" glance, not a second summary strip.
  const linkedProspects = useMemo(() => {
    if (!boardId) return []
    return strategyBoardOpportunities
      .filter((l) => l.boardId === boardId && l.opportunityId !== selectedOpportunityId)
      .map((l) => {
        const opp = opportunities.find((o) => o.id === l.opportunityId)
        const company = opp ? companies.find((c) => c.id === opp.companyId) : undefined
        return company?.name
      })
      .filter((name): name is string => Boolean(name))
  }, [strategyBoardOpportunities, boardId, selectedOpportunityId, opportunities, companies])

  const q = query.trim().toLowerCase()
  const filteredOpportunities = useMemo(() => {
    if (!q) return opportunities
    return opportunities.filter((opp) => {
      const company = companies.find((c) => c.id === opp.companyId)
      return company?.name.toLowerCase().includes(q)
    })
  }, [opportunities, companies, q])

  // Typing changes what the list means, so a stale highlight could Enter into
  // a row that's no longer under the cursor — same reasoning as the modal
  // combobox in FormFields.tsx.
  useEffect(() => {
    setActiveIndex(0)
  }, [q])

  useEffect(() => {
    if (!dropdownOpen) {
      setQuery('')
      setActiveIndex(0)
      return
    }
    // Autofocus the search field the moment the panel opens, so typing works
    // immediately without an extra click.
    searchInputRef.current?.focus()
  }, [dropdownOpen])

  useEffect(() => {
    if (!dropdownOpen) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, dropdownOpen])

  const commit = (id: string) => {
    setSelectedOpportunityId(id)
    setDropdownOpen(false)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (filteredOpportunities.length === 0) return
      const delta = e.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((i) => (i + delta + filteredOpportunities.length) % filteredOpportunities.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const target = filteredOpportunities[activeIndex]
      if (target) commit(target.id)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setDropdownOpen(false)
    }
  }

  return (
    <>
      <Topbar />
      <main className="min-w-0 flex-1 overflow-visible px-4 py-5 animate-fade-in-up sm:px-6 sm:py-6 lg:overflow-hidden lg:px-8 lg:py-8">
        <div className="mb-5">
          <h2 className="mb-4 text-[26px] font-jakarta font-semibold leading-none tracking-[-0.02em] text-foreground sm:text-[30px]">{t.strategy.dealStrategy}</h2>

          <div className="flex flex-wrap items-start gap-2">
          {/* Opportunity selector */}
          <div className="relative block sm:inline-block">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className={cn(
                'flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-xl border border-border bg-surface px-4 py-2 sm:w-auto',
                'text-[15px] font-medium text-foreground hover:border-border-accent transition-all',
                dropdownOpen && 'border-accent/40 ring-1 ring-accent/10'
              )}
            >
              <span className="min-w-0 flex-1 truncate text-left sm:flex-none">{selectedCompany?.name}</span>
              <span className="shrink-0 text-[13.5px] text-foreground/60 font-mono">· {selectedOpp ? t.stages[selectedOpp.stage] : null}</span>
              {selectedOpp?.dealValue && (
                <span className="hidden items-center gap-2.5 min-[380px]:flex">
                  <span className="text-border">·</span>
                  <span className="flex items-center gap-0.5 text-foreground/60">
                    <span className="tabular-nums font-mono text-[13.5px]">{fmt.currency(selectedOpp.dealValue)}</span>
                  </span>
                </span>
              )}
              <ChevronDown size={14} className={cn('ml-auto shrink-0 text-foreground/60 transition-transform sm:ml-1', dropdownOpen && 'rotate-180')} />
            </button>

            {dropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setDropdownOpen(false)}
                />
                <div className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-black/20 animate-slide-in-down sm:right-auto sm:w-72">
                  <div className="relative border-b border-border p-1.5">
                    <Search size={13} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-foreground/50" aria-hidden="true" />
                    <input
                      id={searchInputId}
                      ref={searchInputRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      placeholder={t.strategy.searchDeals}
                      aria-label={t.strategy.searchDealsLabel}
                      role="combobox"
                      aria-expanded="true"
                      aria-controls={`${searchInputId}-listbox`}
                      autoComplete="off"
                      className="h-9 w-full rounded-lg border border-transparent bg-transparent pl-7 pr-2.5 text-[14px] text-foreground outline-none placeholder:text-foreground/45 focus:border-accent/40 focus:bg-surface-raised"
                    />
                  </div>

                  {/* Capped height so a long roster scrolls in place instead of
                      pushing the panel past the viewport. min() keeps it from
                      overflowing a short viewport too — same pattern as the
                      modal combobox's listbox in FormFields.tsx. */}
                  <div
                    ref={listRef}
                    id={`${searchInputId}-listbox`}
                    role="listbox"
                    className="max-h-[min(320px,50dvh)] overflow-y-auto overscroll-contain py-1"
                  >
                    {filteredOpportunities.length === 0 ? (
                      <p className="px-3.5 py-3 text-[13.5px] text-foreground/50">{t.strategy.noMatches}</p>
                    ) : (
                      filteredOpportunities.map((opp, i) => {
                        const company = companies.find(c => c.id === opp.companyId)
                        return (
                          <button
                            key={opp.id}
                            id={`${searchInputId}-listbox-${opp.id}`}
                            type="button"
                            role="option"
                            aria-selected={opp.id === selectedOpportunityId}
                            data-index={i}
                            onMouseEnter={() => setActiveIndex(i)}
                            onClick={() => commit(opp.id)}
                            className={cn(
                              'w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left text-[14.5px] transition-colors',
                              opp.id === selectedOpportunityId
                                ? 'bg-accent-light text-foreground'
                                : i === activeIndex
                                  ? 'bg-surface-raised text-foreground'
                                  : 'text-foreground/80 hover:bg-surface-raised hover:text-foreground'
                            )}
                          >
                            <span className="font-medium">{company?.name}</span>
                            <span className="text-[13px] text-foreground/60 font-mono shrink-0">{t.stages[opp.stage]}</span>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <Button variant="secondary" size="sm" onClick={() => setAddProspectOpen(true)}>
            <Plus size={14} />
            {t.strategy.newProspect}
          </Button>

          {selectedOpp && (
            <Button variant="secondary" size="sm" onClick={() => setLinkProspectsOpen(true)}>
              <Link2 size={14} />
              {t.strategy.manageLinked}
            </Button>
          )}
          </div>

          {/* Only shown once this board is actually shared — a single-prospect
              board (the common case) needs no reminder that it's alone. */}
          {linkedProspects.length > 0 && (
            <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[13px] text-foreground/60">
              <span className="label-mono">{t.strategy.linked}</span>
              {linkedProspects.join(', ')}
            </p>
          )}
        </div>

        {/* Opportunity summary strip */}
        {selectedOpp && selectedCompany && (
          <div className="mb-5 grid grid-cols-2 gap-4 rounded-xl border border-border bg-surface px-4 py-4 animate-fade-in sm:flex sm:flex-wrap sm:items-center sm:gap-10 sm:px-5">
            <div className="col-span-2 sm:col-auto">
              <p className="label-mono mb-1">{t.strategy.nextStep}</p>
              <p className="text-[15px] font-medium text-foreground leading-snug">{selectedOpp.nextStep}</p>
            </div>
            <div>
              <p className="label-mono mb-1">{t.strategy.followUp}</p>
              <p className="text-[15px] font-medium text-foreground font-mono tabular-nums leading-snug">{selectedOpp.followUpDate ? fmt.date(selectedOpp.followUpDate) : '—'}</p>
            </div>
            <div>
              <p className="label-mono mb-1">{t.strategy.priority}</p>
              <p className="flex items-center gap-2 text-[15px] font-medium text-foreground leading-snug">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: priorityDot[selectedOpp.priority] }} />
                {t.priorities[selectedOpp.priority]}
              </p>
            </div>
          </div>
        )}

        <StrategyBoard opportunityId={selectedOpportunityId} />
      </main>

      <AddProspectModal
        open={addProspectOpen}
        onClose={() => setAddProspectOpen(false)}
        onCreated={(opportunityId) => setSelectedOpportunityId(opportunityId)}
      />

      {selectedOpp && (
        <LinkProspectsModal
          open={linkProspectsOpen}
          onClose={() => setLinkProspectsOpen(false)}
          boardId={boardId}
          currentOpportunityId={selectedOpp.id}
        />
      )}
    </>
  )
}
