'use client'

import { useState, useMemo, useRef } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import { CRMTable, TableRow } from '@/components/crm/CRMTable'
import { FilterBar } from '@/components/crm/FilterBar'
import { SearchInput } from '@/components/crm/SearchInput'
import { ViewToggle, ViewMode } from '@/components/crm/ViewToggle'
import { DetailDrawer } from '@/components/crm/DetailDrawer'
import { AddProspectModal } from '@/components/crm/AddProspectModal'
import { Button } from '@/components/crm/Button'
import { useCRMStore } from '@/lib/store'
import { useFormat } from '@/lib/hooks/useFormat'
import { useBoardPan } from '@/lib/hooks/useBoardPan'
import { Stage, Priority, Note } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Plus } from 'lucide-react'
import { STAGES, stageColors, stageDot, priorityDot } from '@/lib/stage-config'
import { useTranslations } from '@/lib/hooks/useTranslations'

export default function ProspectsPage() {
  const { t } = useTranslations()
  const fmt = useFormat()
  const opportunities = useCRMStore((s) => s.opportunities)
  const companies = useCRMStore((s) => s.companies)
  const contacts = useCRMStore((s) => s.contacts)
  const notes = useCRMStore((s) => s.notes)

  // Local to this page, not the store's global `searchQuery` — that one field is
  // shared by every page that reads it, so a query typed here would follow you
  // to /leads and silently filter it too.
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedStages, setSelectedStages] = useState<Stage[]>([])
  const [selectedPriorities, setSelectedPriorities] = useState<Priority[]>([])
  const [view, setView] = useState<ViewMode>('table')
  const boardRef = useRef<HTMLDivElement>(null)
  useBoardPan(boardRef)
  const [selectedRow, setSelectedRow] = useState<TableRow | null>(null)
  const [addProspectOpen, setAddProspectOpen] = useState(false)

  const allRows: TableRow[] = useMemo(() => {
    return opportunities.map(opp => ({
      opportunity: opp,
      company: companies.find(c => c.id === opp.companyId)!,
      contact: contacts.find(c => c.id === opp.contactId)!,
    })).filter(row => row.company && row.contact)
  }, [opportunities, companies, contacts])

  const filteredRows = useMemo(() => {
    return allRows.filter(row => {
      if (selectedStages.length > 0 && !selectedStages.includes(row.opportunity.stage)) return false
      if (selectedPriorities.length > 0 && !selectedPriorities.includes(row.opportunity.priority)) return false
      const q = searchQuery.trim().toLowerCase()
      if (q) {
        const match = row.company.name.toLowerCase().includes(q) ||
          row.contact.name.toLowerCase().includes(q) ||
          row.contact.role.toLowerCase().includes(q) ||
          row.opportunity.nextStep.toLowerCase().includes(q)
        if (!match) return false
      }
      return true
    })
  }, [allRows, selectedStages, selectedPriorities, searchQuery])

  const drawerNotes = useMemo((): Note[] => {
    if (!selectedRow) return []
    return notes.filter(n =>
      n.companyId === selectedRow.company.id ||
      n.opportunityId === selectedRow.opportunity.id
    )
  }, [selectedRow, notes])

  const rowsByStage = useMemo(() => {
    const grouped: Record<string, TableRow[]> = {}
    STAGES.forEach(s => grouped[s] = [])
    filteredRows.forEach(r => {
      if (grouped[r.opportunity.stage]) grouped[r.opportunity.stage].push(r)
    })
    return grouped
  }, [filteredRows])

  return (
    <>
      <Topbar />
      <main className="min-w-0 flex-1 px-4 py-5 animate-fade-in-up sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[26px] font-jakarta font-semibold text-foreground tracking-[-0.02em] leading-none sm:text-[30px]">{t.prospects.allProspects}</h2>
            <p className="text-[15px] text-foreground/60 mt-1.5 font-mono tabular-nums">
              {t.prospects.count(filteredRows.length, allRows.length)}
            </p>
          </div>
          <div className="flex w-full items-center gap-2.5 sm:w-auto">
            <ViewToggle view={view} onChange={setView} />
            <Button onClick={() => setAddProspectOpen(true)} className="shrink-0">
              <Plus size={15} />
              {t.prospects.newProspect}
            </Button>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-3">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={t.prospects.search}
            label={t.prospects.searchLabel}
            className="w-full sm:w-72 sm:shrink-0"
          />
          <div className="min-w-0 flex-1">
            <FilterBar
              selectedStages={selectedStages}
              selectedPriorities={selectedPriorities}
              onStageChange={setSelectedStages}
              onPriorityChange={setSelectedPriorities}
            />
          </div>
        </div>

        {view === 'table' ? (
          <CRMTable
            data={filteredRows}
            onRowClick={(row) => setSelectedRow(row)}
          />
        ) : filteredRows.length === 0 ? (
          <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface/60 px-5 py-8 text-center">
            <p className="text-[15px] text-foreground/70">{t.crm.table.empty}</p>
            {(selectedStages.length > 0 || selectedPriorities.length > 0 || searchQuery.trim() !== '') && (
              <button
                type="button"
                onClick={() => {
                  setSelectedStages([])
                  setSelectedPriorities([])
                  setSearchQuery('')
                }}
                className="mt-3 min-h-11 rounded-lg px-4 text-[14px] font-medium text-accent transition-colors hover:bg-accent-light"
              >
                {t.common.clearFilters}
              </button>
            )}
          </div>
        ) : (
          <div ref={boardRef} className="board-scroll -mx-4 flex snap-x snap-proximity gap-3 overflow-x-auto px-4 pb-4 scroll-px-4 sm:-mx-6 sm:px-6 sm:scroll-px-6 lg:mx-0 lg:px-0 lg:scroll-px-0 cursor-grab">
            {(Object.entries(rowsByStage) as [Stage, TableRow[]][])
              .filter(([, rows]) => rows.length > 0)
              .map(([stage, rows]) => (
                <div key={stage} className="w-[min(82vw,280px)] shrink-0 snap-start sm:w-[260px]">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={cn('inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[14px] font-medium', stageColors[stage])}>
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ background: stageDot[stage] }}
                        aria-hidden="true"
                      />
                      {t.stages[stage]}
                    </span>
                    <span className="text-[13px] font-mono text-foreground/60 tabular-nums">{rows.length}</span>
                  </div>
                  <div className="space-y-2 stagger-children">
                    {rows.map(row => (
                      <button
                        key={row.opportunity.id}
                        onClick={() => setSelectedRow(row)}
                        className="w-full text-left bg-surface border border-border rounded-xl p-3.5 hover:border-border-accent card-glow transition-all duration-150 cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-[15px] font-semibold text-foreground leading-snug">{row.company.name}</p>
                          <span className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ background: priorityDot[row.opportunity.priority] }} />
                        </div>
                        <p className="text-[13.5px] text-foreground/60 mb-2">{row.contact.name} · {row.contact.role}</p>
                        {row.opportunity.dealValue && (
                          <div className="flex items-center gap-1 mb-2">
                            <span className="text-[15px] font-semibold text-foreground tabular-nums">
                              {fmt.currency(row.opportunity.dealValue)}
                            </span>
                          </div>
                        )}
                        <p className="text-[13.5px] text-foreground/70 truncate">{row.opportunity.nextStep}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </main>

      <AddProspectModal open={addProspectOpen} onClose={() => setAddProspectOpen(false)} />

      <DetailDrawer
        opportunity={selectedRow?.opportunity ?? null}
        company={selectedRow?.company ?? null}
        contact={selectedRow?.contact ?? null}
        notes={drawerNotes}
        onClose={() => setSelectedRow(null)}
      />
    </>
  )
}
