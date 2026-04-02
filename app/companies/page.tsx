'use client'

import { useState, useMemo } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import { useCRMStore } from '@/lib/store'
import { Building2, Search, MapPin, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Company, Opportunity, Contact } from '@/lib/types'

interface CompanyDrawerProps {
  company: Company | null
  opportunities: Opportunity[]
  contacts: Contact[]
  onClose: () => void
}

function CompanyDrawer({ company, opportunities, contacts, onClose }: CompanyDrawerProps) {
  const isOpen = !!company

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 bg-black/40 backdrop-blur-[3px] z-40 transition-opacity duration-250',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
      />
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[480px] max-w-[90vw] bg-surface z-50',
          'flex flex-col border-l border-border',
          'transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {company && (
          <>
            <div className="flex items-start justify-between p-5 border-b border-border shrink-0">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent-light flex items-center justify-center shrink-0">
                  <Building2 size={18} className="text-accent" />
                </div>
                <div>
                  <h2 className="text-[16px] font-semibold text-foreground font-display">{company.name}</h2>
                  <p className="text-[11px] text-muted font-mono mt-0.5">{company.domain}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-raised text-muted hover:text-foreground transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="px-5 py-4 border-b border-border-subtle">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-background-raised rounded-lg px-3 py-2.5">
                    <p className="label-mono mb-1">Industry</p>
                    <p className="text-[12px] font-medium text-foreground">{company.industry}</p>
                  </div>
                  <div className="bg-background-raised rounded-lg px-3 py-2.5">
                    <p className="label-mono mb-1">Size</p>
                    <p className="text-[12px] font-medium text-foreground">{company.size}</p>
                  </div>
                  <div className="bg-background-raised rounded-lg px-3 py-2.5">
                    <p className="label-mono mb-1">Location</p>
                    <p className="text-[12px] font-medium text-foreground">{company.location}</p>
                  </div>
                </div>
                {company.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {company.tags.map(tag => (
                      <span key={tag} className="text-[10px] font-mono px-2 py-0.5 bg-accent-light text-accent rounded-md">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="px-5 py-4 border-b border-border-subtle">
                <p className="label-mono mb-3">Contacts</p>
                {contacts.length === 0 ? (
                  <p className="text-[12px] text-muted">No contacts linked.</p>
                ) : (
                  <div className="space-y-2.5">
                    {contacts.map(c => (
                      <div key={c.id} className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent-light flex items-center justify-center shrink-0">
                          <span className="text-[11px] font-semibold text-accent">{c.name.charAt(0)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-foreground">{c.name}</p>
                          <p className="text-[11px] text-muted">{c.role}</p>
                        </div>
                        <p className="text-[10px] text-muted font-mono hidden sm:block">{c.email}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="px-5 py-4">
                <p className="label-mono mb-3">Opportunities</p>
                {opportunities.length === 0 ? (
                  <p className="text-[12px] text-muted">No active opportunities.</p>
                ) : (
                  <div className="space-y-2">
                    {opportunities.map(opp => (
                      <div key={opp.id} className="bg-background-raised border border-border-subtle rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-medium px-2 py-0.5 bg-surface-raised rounded-md text-muted-foreground border border-border-subtle">
                            {opp.stage}
                          </span>
                          {opp.dealValue && (
                            <span className="text-[12px] font-medium text-foreground tabular-nums font-mono">
                              ${opp.dealValue.toLocaleString()}
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] text-foreground mt-1.5">{opp.nextStep}</p>
                        <p className="text-[10px] text-muted font-mono mt-1">Follow-up: {opp.followUpDate}</p>
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
  const companies = useCRMStore((s) => s.companies)
  const opportunities = useCRMStore((s) => s.opportunities)
  const contacts = useCRMStore((s) => s.contacts)
  const searchQuery = useCRMStore((s) => s.searchQuery)

  const [localSearch, setLocalSearch] = useState('')
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)

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
      <Topbar title="Companies" />
      <main className="px-8 py-8 flex-1 animate-fade-in-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-[22px] font-display text-foreground tracking-tight">Companies</h2>
            <p className="text-[13px] text-muted mt-0.5 font-mono">{filtered.length} companies tracked</p>
          </div>
          <div className="relative flex items-center">
            <Search size={13} className="absolute left-2.5 text-muted pointer-events-none" />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder="Filter companies..."
              className="h-8 pl-8 pr-3 text-[13px] bg-surface border border-border rounded-lg text-foreground placeholder:text-muted outline-none focus:border-accent/40 transition-all w-52"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger-children">
          {filtered.map(company => {
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
                    <p className="text-[14px] font-semibold text-foreground truncate">{company.name}</p>
                    <p className="text-[11px] text-muted mt-0.5 font-mono">{company.domain}</p>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-3 text-[11px] text-muted">
                  <span className="flex items-center gap-1">
                    <MapPin size={10} />
                    {company.location}
                  </span>
                  <span className="text-border">·</span>
                  <span>{company.industry}</span>
                  <span className="text-border">·</span>
                  <span>{company.size}</span>
                </div>

                <div className="mt-3 flex items-center gap-4">
                  <div className="flex items-center gap-1 text-[11px]">
                    <span className="text-muted">Deals:</span>
                    <span className="font-medium text-foreground">{oppCount}</span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px]">
                    <span className="text-muted">Contacts:</span>
                    <span className="font-medium text-foreground">{contactCount}</span>
                  </div>
                  {totalValue > 0 && (
                    <div className="flex items-center gap-1 text-[11px] ml-auto">
                      <span className="font-medium text-accent tabular-nums font-mono">${totalValue.toLocaleString()}</span>
                    </div>
                  )}
                </div>

                {company.tags.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {company.tags.map(tag => (
                      <span
                        key={tag}
                        className="text-[9.5px] font-mono px-1.5 py-0.5 bg-accent-light text-accent rounded-md"
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

      <CompanyDrawer
        company={selectedCompany}
        opportunities={selectedOpps}
        contacts={selectedContacts}
        onClose={() => setSelectedCompanyId(null)}
      />
    </>
  )
}
