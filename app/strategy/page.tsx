'use client'

import { useState, useMemo } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import { StrategyBoard } from '@/components/crm/StrategyBoard'
import { useCRMStore } from '@/lib/store'
import { ChevronDown, DollarSign } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function StrategyPage() {
  const opportunities = useCRMStore((s) => s.opportunities)
  const companies = useCRMStore((s) => s.companies)
  const strategyCards = useCRMStore((s) => s.strategyCards)
  const addStrategyCard = useCRMStore((s) => s.addStrategyCard)

  const [selectedOpportunityId, setSelectedOpportunityId] = useState(opportunities[1]?.id ?? opportunities[0]?.id)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const selectedOpp = useMemo(
    () => opportunities.find(o => o.id === selectedOpportunityId),
    [selectedOpportunityId, opportunities]
  )

  const selectedCompany = useMemo(
    () => companies.find(c => c.id === selectedOpp?.companyId),
    [selectedOpp, companies]
  )

  const filteredCards = useMemo(
    () => strategyCards.filter(c => c.opportunityId === selectedOpportunityId),
    [selectedOpportunityId, strategyCards]
  )

  return (
    <>
      <Topbar title="Strategy" />
      <main className="px-6 py-6 flex-1 overflow-hidden animate-fade-in-up">
        <div className="mb-5">
          <h2 className="text-[22px] font-display text-foreground tracking-tight mb-3">Deal Strategy</h2>

          {/* Opportunity selector */}
          <div className="relative inline-block">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className={cn(
                'flex items-center gap-2.5 h-9 px-4 bg-surface border border-border rounded-xl',
                'text-[13px] font-medium text-foreground hover:border-border-accent transition-all',
                dropdownOpen && 'border-accent/40 ring-1 ring-accent/10'
              )}
            >
              <span>{selectedCompany?.name}</span>
              <span className="text-muted text-[11px] font-mono">· {selectedOpp?.stage}</span>
              {selectedOpp?.dealValue && (
                <>
                  <span className="text-border">·</span>
                  <span className="flex items-center gap-0.5 text-muted">
                    <DollarSign size={11} />
                    <span className="tabular-nums font-mono text-[11px]">{selectedOpp.dealValue.toLocaleString()}</span>
                  </span>
                </>
              )}
              <ChevronDown size={13} className={cn('text-muted ml-1 transition-transform', dropdownOpen && 'rotate-180')} />
            </button>

            {dropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setDropdownOpen(false)}
                />
                <div className="absolute top-full mt-1.5 left-0 z-20 bg-surface border border-border rounded-xl shadow-lg shadow-black/20 py-1 w-72 animate-slide-in-down">
                  {opportunities.map(opp => {
                    const company = companies.find(c => c.id === opp.companyId)
                    return (
                      <button
                        key={opp.id}
                        onClick={() => {
                          setSelectedOpportunityId(opp.id)
                          setDropdownOpen(false)
                        }}
                        className={cn(
                          'w-full flex items-center justify-between px-3.5 py-2.5 text-left text-[13px] transition-colors',
                          opp.id === selectedOpportunityId
                            ? 'bg-accent-light text-foreground'
                            : 'hover:bg-surface-raised text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <span className="font-medium">{company?.name}</span>
                        <span className="text-[10px] text-muted font-mono">{opp.stage}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Opportunity summary strip */}
        {selectedOpp && selectedCompany && (
          <div className="mb-5 p-4 bg-surface border border-border rounded-xl flex items-center gap-8 flex-wrap animate-fade-in">
            <div>
              <p className="label-mono">Next Step</p>
              <p className="text-[13px] text-foreground mt-0.5">{selectedOpp.nextStep}</p>
            </div>
            <div>
              <p className="label-mono">Follow-up</p>
              <p className="text-[13px] text-foreground mt-0.5 font-mono">{selectedOpp.followUpDate}</p>
            </div>
            <div>
              <p className="label-mono">Priority</p>
              <p className="text-[13px] text-foreground mt-0.5 capitalize">{selectedOpp.priority}</p>
            </div>
            {filteredCards.length === 0 && (
              <p className="text-[12px] text-muted ml-auto">No strategy cards yet — add some below.</p>
            )}
          </div>
        )}

        <StrategyBoard
          cards={filteredCards}
          opportunityId={selectedOpportunityId}
          onAddCard={addStrategyCard}
        />
      </main>
    </>
  )
}
