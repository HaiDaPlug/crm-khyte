'use client'

import { useState, useMemo } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import { CRMTable, TableRow } from '@/components/crm/CRMTable'
import { FilterBar } from '@/components/crm/FilterBar'
import { ViewToggle, ViewMode } from '@/components/crm/ViewToggle'
import { DetailDrawer } from '@/components/crm/DetailDrawer'
import { useCRMStore } from '@/lib/store'
import { Stage, Priority, Note } from '@/lib/types'
import { cn } from '@/lib/utils'
import { DollarSign } from 'lucide-react'

const stageColors: Record<Stage, string> = {
  'New': 'bg-surface-raised text-foreground-dim',
  'Researched': 'bg-blue-500/10 text-blue-400',
  'Contacted': 'bg-sky-500/10 text-sky-400',
  'Warm': 'bg-orange-500/10 text-orange-400',
  'Meeting Booked': 'bg-violet-500/10 text-violet-400',
  'Proposal Sent': 'bg-amber-500/10 text-amber-400',
  'Negotiation': 'bg-yellow-500/10 text-yellow-400',
  'Won': 'bg-success-muted text-success',
  'Lost': 'bg-danger-muted text-danger',
}

const priorityDot: Record<Priority, string> = {
  critical: 'bg-red-500',
  high: 'bg-accent',
  medium: 'bg-blue-400',
  low: 'bg-muted',
}

export default function LeadsPage() {
  const opportunities = useCRMStore((s) => s.opportunities)
  const companies = useCRMStore((s) => s.companies)
  const contacts = useCRMStore((s) => s.contacts)
  const notes = useCRMStore((s) => s.notes)
  const searchQuery = useCRMStore((s) => s.searchQuery)

  const [selectedStages, setSelectedStages] = useState<Stage[]>([])
  const [selectedPriorities, setSelectedPriorities] = useState<Priority[]>([])
  const [view, setView] = useState<ViewMode>('table')
  const [selectedRow, setSelectedRow] = useState<TableRow | null>(null)

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
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const match = row.company.name.toLowerCase().includes(q) ||
          row.contact.name.toLowerCase().includes(q) ||
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
    const stages: Stage[] = ['New', 'Researched', 'Contacted', 'Warm', 'Meeting Booked', 'Proposal Sent', 'Negotiation', 'Won', 'Lost']
    stages.forEach(s => grouped[s] = [])
    filteredRows.forEach(r => {
      if (grouped[r.opportunity.stage]) grouped[r.opportunity.stage].push(r)
    })
    return grouped
  }, [filteredRows])

  return (
    <>
      <Topbar title="Leads" />
      <main className="px-8 py-8 flex-1 animate-fade-in-up">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-[22px] font-display text-foreground tracking-tight">All Leads</h2>
            <p className="text-[13px] text-muted mt-0.5 font-mono">
              {filteredRows.length} of {allRows.length} opportunities
            </p>
          </div>
          <ViewToggle view={view} onChange={setView} />
        </div>

        <div className="mb-4">
          <FilterBar
            selectedStages={selectedStages}
            selectedPriorities={selectedPriorities}
            onStageChange={setSelectedStages}
            onPriorityChange={setSelectedPriorities}
          />
        </div>

        {view === 'table' ? (
          <CRMTable
            data={filteredRows}
            onRowClick={(row) => setSelectedRow(row)}
          />
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-4">
            {(Object.entries(rowsByStage) as [Stage, TableRow[]][])
              .filter(([, rows]) => rows.length > 0)
              .map(([stage, rows]) => (
                <div key={stage} className="shrink-0 w-[240px]">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={cn('text-[10.5px] font-medium px-2 py-0.5 rounded-md', stageColors[stage])}>
                      {stage}
                    </span>
                    <span className="text-[10px] font-mono text-muted">{rows.length}</span>
                  </div>
                  <div className="space-y-2 stagger-children">
                    {rows.map(row => (
                      <button
                        key={row.opportunity.id}
                        onClick={() => setSelectedRow(row)}
                        className="w-full text-left bg-surface border border-border rounded-xl p-3.5 hover:border-border-accent card-glow transition-all duration-150 cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-[13px] font-semibold text-foreground">{row.company.name}</p>
                          <span className={cn('w-2 h-2 rounded-full mt-1 shrink-0', priorityDot[row.opportunity.priority])} />
                        </div>
                        <p className="text-[11px] text-muted mb-1.5">{row.contact.name} · {row.contact.role}</p>
                        {row.opportunity.dealValue && (
                          <div className="flex items-center gap-1 mb-1.5">
                            <DollarSign size={10} className="text-muted" />
                            <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                              {row.opportunity.dealValue.toLocaleString()}
                            </span>
                          </div>
                        )}
                        <p className="text-[11px] text-muted truncate">{row.opportunity.nextStep}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </main>

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
