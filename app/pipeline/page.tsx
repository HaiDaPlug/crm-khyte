'use client'

import { useMemo } from 'react'
import { useState } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import { PipelineBoard, PipelineRow } from '@/components/crm/PipelineBoard'
import { DetailDrawer } from '@/components/crm/DetailDrawer'
import { useCRMStore } from '@/lib/store'
import { Note } from '@/lib/types'

export default function PipelinePage() {
  const opportunities = useCRMStore((s) => s.opportunities)
  const companies = useCRMStore((s) => s.companies)
  const contacts = useCRMStore((s) => s.contacts)
  const notes = useCRMStore((s) => s.notes)
  const moveOpportunityStage = useCRMStore((s) => s.moveOpportunityStage)

  const [selectedRow, setSelectedRow] = useState<PipelineRow | null>(null)

  const rows: PipelineRow[] = useMemo(() => {
    return opportunities.map(opp => ({
      opportunity: opp,
      company: companies.find(c => c.id === opp.companyId)!,
      contact: contacts.find(c => c.id === opp.contactId)!,
    })).filter(r => r.company && r.contact)
  }, [opportunities, companies, contacts])

  const drawerNotes = useMemo((): Note[] => {
    if (!selectedRow) return []
    return notes.filter(n =>
      n.companyId === selectedRow.company.id ||
      n.opportunityId === selectedRow.opportunity.id
    )
  }, [selectedRow, notes])

  const totalValue = useMemo(() => {
    return opportunities
      .filter(o => o.stage !== 'Won' && o.stage !== 'Lost')
      .reduce((sum, o) => sum + (o.dealValue ?? 0), 0)
  }, [opportunities])

  return (
    <>
      <Topbar title="Pipeline" />
      <main className="px-6 py-6 overflow-hidden flex-1 animate-fade-in-up">
        <div className="flex items-end justify-between mb-5">
          <div>
            <h2 className="text-[22px] font-display text-foreground tracking-tight">Pipeline</h2>
            <p className="text-[13px] text-muted mt-0.5">
              Drag cards between stages to update progress
            </p>
          </div>
          <div className="text-right">
            <p className="label-mono">Active Pipeline</p>
            <p className="text-[18px] font-semibold text-accent tabular-nums font-mono mt-0.5">
              ${totalValue.toLocaleString()}
            </p>
          </div>
        </div>

        <PipelineBoard
          rows={rows}
          onCardClick={(row) => setSelectedRow(row)}
          onStageChange={moveOpportunityStage}
        />
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
