'use client'

import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/crm/Button'
import { PipelineBoard, PipelineRow } from '@/components/crm/PipelineBoard'
import { DetailDrawer } from '@/components/crm/DetailDrawer'
import { useCRMStore } from '@/lib/store'
import { useFormat } from '@/lib/hooks/useFormat'
import { Note } from '@/lib/types'
import { cn } from '@/lib/utils'
import { priorityDot } from '@/lib/stage-config'
import { useTranslations } from '@/lib/hooks/useTranslations'

export default function PipelinePage() {
  const { t } = useTranslations()
  const fmt = useFormat()
  const opportunities = useCRMStore((s) => s.opportunities)
  const companies = useCRMStore((s) => s.companies)
  const contacts = useCRMStore((s) => s.contacts)
  const notes = useCRMStore((s) => s.notes)
  const moveOpportunityCard = useCRMStore((s) => s.moveOpportunityCard)
  const addToPipeline = useCRMStore((s) => s.addToPipeline)

  const [selectedRow, setSelectedRow] = useState<PipelineRow | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Only leads explicitly added to the pipeline appear on the board
  const rows: PipelineRow[] = useMemo(() => {
    return opportunities
      .filter(o => o.inPipeline)
      .map(opp => ({
        opportunity: opp,
        company: companies.find(c => c.id === opp.companyId)!,
        contact: contacts.find(c => c.id === opp.contactId)!,
      }))
      .filter(r => r.company && r.contact)
  }, [opportunities, companies, contacts])

  const availableLeads: PipelineRow[] = useMemo(() => {
    return opportunities
      .filter(o => !o.inPipeline)
      .map(opp => ({
        opportunity: opp,
        company: companies.find(c => c.id === opp.companyId)!,
        contact: contacts.find(c => c.id === opp.contactId)!,
      }))
      .filter(r => r.company && r.contact)
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
      .filter(o => o.inPipeline && o.stage !== 'Won' && o.stage !== 'Lost')
      .reduce((sum, o) => sum + (o.dealValue ?? 0), 0)
  }, [opportunities])

  return (
    <>
      <Topbar />
      <main className="min-w-0 flex-1 overflow-visible px-4 py-5 animate-fade-in-up sm:px-6 sm:py-6 lg:overflow-hidden lg:px-8 lg:py-8">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[26px] font-jakarta font-semibold text-foreground tracking-[-0.02em] leading-none sm:text-[30px]">{t.pipeline.title}</h2>
            <p className="text-[15px] text-foreground/60 mt-1.5 font-mono tabular-nums">
              {t.pipeline.description}
            </p>
          </div>
          <div className="flex items-end justify-between gap-4 sm:justify-end sm:gap-5">
            <div className="text-left sm:text-right">
              <p className="label-mono">{t.pipeline.activePipeline}</p>
              <p className="text-[18px] font-semibold text-accent tabular-nums font-mono mt-0.5">
                {fmt.currency(totalValue)}
              </p>
            </div>
            <div className="relative">
              <Button onClick={() => setPickerOpen(v => !v)}>
                <Plus size={15} />
                {t.pipeline.addLeads}
                {availableLeads.length > 0 && (
                  <span className="ml-0.5 text-[10px] font-mono bg-background/20 px-1.5 py-px rounded-md">
                    {availableLeads.length}
                  </span>
                )}
              </Button>

              {pickerOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} />
                  <div className="absolute right-0 top-full z-40 mt-2 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-xl animate-scale-in">
                    <div className="px-3.5 py-2.5 border-b border-border-subtle bg-surface-raised/50">
                      <p className="label-mono !text-white">{t.pipeline.offBoard}</p>
                      <p className="text-[13px] text-foreground/60 mt-1">{t.pipeline.startsNew}</p>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto p-1.5">
                      {availableLeads.length === 0 ? (
                        <p className="text-[13.5px] text-foreground/60 text-center py-6">
                          {t.pipeline.allOnBoard}
                        </p>
                      ) : (
                        availableLeads.map(row => (
                          <button
                            key={row.opportunity.id}
                            onClick={() => addToPipeline(row.opportunity.id)}
                            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-accent-light transition-colors group"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[14.5px] font-medium text-foreground truncate">
                                {row.company.name}
                              </p>
                              <span className="flex items-center gap-1.5 shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full" style={{ background: priorityDot[row.opportunity.priority] }} />
                                <Plus size={13} className="text-foreground/60 group-hover:text-accent transition-colors" />
                              </span>
                            </div>
                            <p className="text-[13px] text-foreground/60 truncate">
                              {row.contact.name}
                              {row.opportunity.dealValue && (
                                <span className="font-mono"> · {fmt.currency(row.opportunity.dealValue)}</span>
                              )}
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <PipelineBoard
          rows={rows}
          onCardClick={(row) => setSelectedRow(row)}
          onStageChange={moveOpportunityCard}
          availableLeads={availableLeads}
          onAddToStage={addToPipeline}
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
