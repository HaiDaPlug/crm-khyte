'use client'

import { useState, useMemo } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import { useCRMStore } from '@/lib/store'
import { Search, ExternalLink, Mail, X, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Contact, Company, Opportunity } from '@/lib/types'

interface ContactDrawerProps {
  contact: Contact | null
  company: Company | null
  opportunities: Opportunity[]
  onClose: () => void
}

function ContactDrawer({ contact, company, opportunities, onClose }: ContactDrawerProps) {
  const isOpen = !!contact

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
        {contact && company && (
          <>
            <div className="flex items-start justify-between p-5 border-b border-border shrink-0">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-accent-light flex items-center justify-center shrink-0">
                  <span className="text-[14px] font-semibold text-accent">{contact.name.charAt(0)}</span>
                </div>
                <div>
                  <h2 className="text-[16px] font-semibold text-foreground font-display">{contact.name}</h2>
                  <p className="text-[12px] text-muted mt-0.5">{contact.role}</p>
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
                <p className="label-mono mb-3">Contact Info</p>
                <div className="space-y-2.5">
                  <div className="flex items-center gap-3">
                    <Mail size={13} className="text-muted shrink-0" />
                    <a href={`mailto:${contact.email}`} className="text-[13px] text-foreground font-mono hover:text-accent transition-colors">
                      {contact.email}
                    </a>
                  </div>
                  {contact.linkedin && (
                    <div className="flex items-center gap-3">
                      <ExternalLink size={13} className="text-muted shrink-0" />
                      <a
                        href={`https://${contact.linkedin}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] text-foreground hover:text-accent transition-colors"
                      >
                        LinkedIn Profile
                      </a>
                    </div>
                  )}
                </div>
              </div>

              <div className="px-5 py-4 border-b border-border-subtle">
                <p className="label-mono mb-3">Company</p>
                <div className="flex items-center gap-3 bg-background-raised rounded-lg p-3 border border-border-subtle">
                  <div className="w-8 h-8 rounded-lg bg-accent-light flex items-center justify-center shrink-0">
                    <Building2 size={14} className="text-accent" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-foreground">{company.name}</p>
                    <p className="text-[11px] text-muted">{company.industry} · {company.location}</p>
                  </div>
                </div>
              </div>

              <div className="px-5 py-4">
                <p className="label-mono mb-3">Related Opportunities</p>
                {opportunities.length === 0 ? (
                  <p className="text-[12px] text-muted">No opportunities linked.</p>
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

export default function ContactsPage() {
  const contacts = useCRMStore((s) => s.contacts)
  const companies = useCRMStore((s) => s.companies)
  const opportunities = useCRMStore((s) => s.opportunities)
  const searchQuery = useCRMStore((s) => s.searchQuery)

  const [localSearch, setLocalSearch] = useState('')
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null)

  const query = localSearch || searchQuery

  const filtered = useMemo(() => {
    if (!query) return contacts
    const q = query.toLowerCase()
    return contacts.filter(c => {
      const company = companies.find(co => co.id === c.companyId)
      return c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q) ||
        (company?.name.toLowerCase().includes(q) ?? false)
    })
  }, [contacts, companies, query])

  const selectedContact = selectedContactId ? contacts.find(c => c.id === selectedContactId) ?? null : null
  const selectedCompany = selectedContact ? companies.find(c => c.id === selectedContact.companyId) ?? null : null
  const selectedOpps = selectedContact ? opportunities.filter(o => o.contactId === selectedContact.id) : []

  return (
    <>
      <Topbar title="Contacts" />
      <main className="px-8 py-8 flex-1 animate-fade-in-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-[22px] font-display text-foreground tracking-tight">Contacts</h2>
            <p className="text-[13px] text-muted mt-0.5 font-mono">{filtered.length} contacts</p>
          </div>
          <div className="relative flex items-center">
            <Search size={13} className="absolute left-2.5 text-muted pointer-events-none" />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder="Filter contacts..."
              className="h-8 pl-8 pr-3 text-[13px] bg-surface border border-border rounded-lg text-foreground placeholder:text-muted outline-none focus:border-accent/40 transition-all w-52"
            />
          </div>
        </div>

        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {filtered.map((contact, i) => {
            const company = companies.find(c => c.id === contact.companyId)
            const isLast = i === filtered.length - 1
            const oppCount = opportunities.filter(o => o.contactId === contact.id).length

            return (
              <button
                key={contact.id}
                onClick={() => setSelectedContactId(contact.id)}
                className={cn(
                  'w-full flex items-center gap-4 px-5 py-3.5 hover:bg-accent-light transition-all duration-100 cursor-pointer text-left',
                  !isLast && 'border-b border-border-subtle'
                )}
              >
                <div className="w-9 h-9 rounded-full bg-accent-light flex items-center justify-center shrink-0">
                  <span className="text-[12px] font-semibold text-accent">
                    {contact.name.charAt(0)}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground">{contact.name}</p>
                  <p className="text-[11px] text-muted">{contact.role}</p>
                </div>

                <div className="hidden sm:block w-40">
                  <p className="text-[12px] text-muted-foreground truncate">{company?.name}</p>
                  <p className="text-[10px] text-muted truncate">{company?.industry}</p>
                </div>

                <div className="hidden md:block flex-1 min-w-0">
                  <p className="text-[11px] text-muted font-mono truncate">{contact.email}</p>
                </div>

                {oppCount > 0 && (
                  <span className="text-[10px] font-mono text-muted bg-surface-raised px-1.5 py-0.5 rounded-md border border-border-subtle hidden lg:block">
                    {oppCount} deal{oppCount > 1 ? 's' : ''}
                  </span>
                )}

                <div className="w-6 flex items-center justify-center">
                  {contact.linkedin ? (
                    <a
                      href={`https://${contact.linkedin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-muted/40 hover:text-accent transition-colors"
                    >
                      <ExternalLink size={13} />
                    </a>
                  ) : null}
                </div>
              </button>
            )
          })}
        </div>
      </main>

      <ContactDrawer
        contact={selectedContact}
        company={selectedCompany}
        opportunities={selectedOpps}
        onClose={() => setSelectedContactId(null)}
      />
    </>
  )
}
