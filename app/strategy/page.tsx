'use client'

import { useState, useMemo } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import { StrategyBoard } from '@/components/crm/StrategyBoard'
import { useCRMStore } from '@/lib/store'
import { useFormat } from '@/lib/hooks/useFormat'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { priorityDot } from '@/lib/stage-config'
import { useTranslations } from '@/lib/hooks/useTranslations'

export default function StrategyPage() {
  const { t } = useTranslations()
  const fmt = useFormat()
  const opportunities = useCRMStore((s) => s.opportunities)
  const companies = useCRMStore((s) => s.companies)

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

  return (
    <>
      <Topbar />
      <main className="min-w-0 flex-1 overflow-visible px-4 py-5 animate-fade-in-up sm:px-6 sm:py-6 lg:overflow-hidden lg:px-8 lg:py-8">
        <div className="mb-5">
          <h2 className="mb-4 text-[26px] font-jakarta font-semibold leading-none tracking-[-0.02em] text-foreground sm:text-[30px]">{t.strategy.dealStrategy}</h2>

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
                <div className="absolute left-0 right-0 top-full z-20 mt-1.5 rounded-xl border border-border bg-surface py-1 shadow-lg shadow-black/20 animate-slide-in-down sm:right-auto sm:w-72">
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
                          'w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left text-[14.5px] transition-colors',
                          opp.id === selectedOpportunityId
                            ? 'bg-accent-light text-foreground'
                            : 'hover:bg-surface-raised text-foreground/80 hover:text-foreground'
                        )}
                      >
                        <span className="font-medium">{company?.name}</span>
                        <span className="text-[13px] text-foreground/60 font-mono shrink-0">{t.stages[opp.stage]}</span>
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
          <div className="mb-5 grid grid-cols-2 gap-4 rounded-xl border border-border bg-surface px-4 py-4 animate-fade-in sm:flex sm:flex-wrap sm:items-center sm:gap-10 sm:px-5">
            <div className="col-span-2 sm:col-auto">
              <p className="label-mono mb-1">{t.strategy.nextStep}</p>
              <p className="text-[15px] font-medium text-foreground leading-snug">{selectedOpp.nextStep}</p>
            </div>
            <div>
              <p className="label-mono mb-1">{t.strategy.followUp}</p>
              <p className="text-[15px] font-medium text-foreground font-mono tabular-nums leading-snug">{fmt.date(selectedOpp.followUpDate)}</p>
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
    </>
  )
}
