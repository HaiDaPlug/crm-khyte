'use client'

import { useState, useMemo } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import { CRMTable, TableRow } from '@/components/crm/CRMTable'
import { FilterBar } from '@/components/crm/FilterBar'
import { ViewToggle, ViewMode } from '@/components/crm/ViewToggle'
import { DetailDrawer } from '@/components/crm/DetailDrawer'
import { AddLeadModal } from '@/components/crm/AddLeadModal'
import { Button } from '@/components/crm/Button'
import { useCRMStore } from '@/lib/store'
import { useFormat } from '@/lib/hooks/useFormat'
import { Stage, Priority, Note } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Plus } from 'lucide-react'
import { stageColors, priorityDot } from '@/lib/stage-config'
import { useTranslations } from '@/lib/hooks/useTranslations'

export default function LeadsPage() {
  const { t } = useTranslations()
  const fmt = useFormat()
  const opportunities = useCRMStore((s) => s.opportunities)
  const companies = useCRMStore((s) => s.companies)
  const contacts = useCRMStore((s) => s.contacts)
  const notes = useCRMStore((s) => s.notes)
  const searchQuery = useCRMStore((s) => s.searchQuery)

  const [selectedStages, setSelectedStages] = useState<Stage[]>([])
  const [selectedPriorities, setSelectedPriorities] = useState<Priority[]>([])
  const [view, setView] = useState<ViewMode>('table')
  const [selectedRow, setSelectedRow] = useState<TableRow | null>(null)
  const [addLeadOpen, setAddLeadOpen] = useState(false)

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
      <Topbar title={t.leads.title} />
      <main className="px-8 py-8 flex-1 animate-fade-in-up">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-[26px] font-display text-foreground tracking-tight leading-none">{t.leads.allLeads}</h2>
            <p className="text-[13px] text-foreground/60 mt-1.5 font-mono tabular-nums">
              {t.leads.count(filteredRows.length, allRows.length)}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <ViewToggle view={view} onChange={setView} />
            <Button onClick={() => setAddLeadOpen(true)}>
              <Plus size={15} />
              {t.leads.newLead}
            </Button>
          </div>
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
                <div key={stage} className="shrink-0 w-[260px]">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={cn('inline-flex items-center h-7 px-2.5 rounded-md text-[13px] font-medium', stageColors[stage])}>
                      {t.stages[stage]}
                    </span>
                    <span className="text-[12px] font-mono text-foreground/60 tabular-nums">{rows.length}</span>
                  </div>
                  <div className="space-y-2 stagger-children">
                    {rows.map(row => (
                      <button
                        key={row.opportunity.id}
                        onClick={() => setSelectedRow(row)}
                        className="w-full text-left bg-surface border border-border rounded-xl p-3.5 hover:border-border-accent card-glow transition-all duration-150 cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-[14px] font-semibold text-foreground leading-snug">{row.company.name}</p>
                          <span className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ background: priorityDot[row.opportunity.priority] }} />
                        </div>
                        <p className="text-[12.5px] text-foreground/60 mb-2">{row.contact.name} · {row.contact.role}</p>
                        {row.opportunity.dealValue && (
                          <div className="flex items-center gap-1 mb-2">
                            <span className="text-[14px] font-semibold text-foreground tabular-nums">
                              {fmt.currency(row.opportunity.dealValue)}
                            </span>
                          </div>
                        )}
                        <p className="text-[12.5px] text-foreground/70 truncate">{row.opportunity.nextStep}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </main>

      <AddLeadModal open={addLeadOpen} onClose={() => setAddLeadOpen(false)} />

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
