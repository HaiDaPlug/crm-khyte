'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import { AddContactModal } from '@/components/crm/AddContactModal'
import { Button } from '@/components/crm/Button'
import { useCRMStore } from '@/lib/store'
import { useFormat } from '@/lib/hooks/useFormat'
import { Search, ExternalLink, Mail, X, Building2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Contact, Company, Opportunity } from '@/lib/types'
import { useTranslations } from '@/lib/hooks/useTranslations'
import { useDialogBehavior } from '@/lib/hooks/useDialog'

interface ContactDrawerProps {
  contact: Contact | null
  company: Company | null
  opportunities: Opportunity[]
  onClose: () => void
}

function ContactDrawer({ contact, company, opportunities, onClose }: ContactDrawerProps) {
  const { t } = useTranslations()
  const fmt = useFormat()
  const isOpen = !!contact
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useDialogBehavior({ open: isOpen, onClose, panelRef })

  useEffect(() => {
    if (isOpen) panelRef.current?.focus()
  }, [isOpen])

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 bg-black/40 backdrop-blur-[3px] z-40 transition-opacity duration-250',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onMouseDown={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!isOpen}
        tabIndex={-1}
        inert={!isOpen}
        className={cn(
          'fixed inset-y-0 right-0 h-dvh w-full max-w-none bg-surface z-50 sm:h-full sm:w-[480px] sm:max-w-[90vw]',
          'flex flex-col border-border outline-none pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] sm:border-l sm:pl-0',
          'transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {contact && company && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] shrink-0 sm:p-5">
              <div className="flex min-w-0 items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-accent-light flex items-center justify-center shrink-0">
                  <span className="text-[15px] font-semibold text-accent">{contact.name.charAt(0)}</span>
                </div>
                <div className="min-w-0">
                  <h2 id={titleId} className="break-words text-[17px] font-semibold text-foreground font-display">{contact.name}</h2>
                  <p className="mt-1 break-words text-[13.5px] text-foreground/60">{contact.role}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t.crm.modal.closeDetails}
                className="-mr-1 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-xl text-foreground/60 transition-colors hover:bg-surface-raised hover:text-foreground sm:mr-0 sm:mt-0 sm:size-9 sm:rounded-lg"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
              <div className="border-b border-border-subtle px-4 py-4 sm:px-5">
                <p className="label-mono mb-3">{t.contacts.contactInfo}</p>
                <div className="space-y-1">
                  <div className="flex min-h-11 min-w-0 items-center gap-3">
                    <Mail size={14} className="text-foreground/60 shrink-0" />
                    <a href={`mailto:${contact.email}`} className="flex min-h-11 min-w-0 items-center break-all text-[14.5px] text-foreground font-mono transition-colors hover:text-accent">
                      {contact.email}
                    </a>
                  </div>
                  {contact.linkedin && (
                    <div className="flex min-h-11 items-center gap-3">
                      <ExternalLink size={14} className="text-foreground/60 shrink-0" />
                      <a
                        href={`https://${contact.linkedin}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-11 items-center text-[14.5px] text-foreground transition-colors hover:text-accent"
                      >
                        {t.contacts.linkedInProfile}
                      </a>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-b border-border-subtle px-4 py-4 sm:px-5">
                <p className="label-mono mb-3">{t.contacts.company}</p>
                <div className="flex items-center gap-3 bg-background-raised rounded-lg p-3 border border-border-subtle">
                  <div className="w-8 h-8 rounded-lg bg-accent-light flex items-center justify-center shrink-0">
                    <Building2 size={14} className="text-accent" />
                  </div>
                  <div className="min-w-0">
                    <p className="break-words text-[15px] font-medium text-foreground">{company.name}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-[13.5px] text-foreground/60">
                      <span>{company.industry}</span>
                      <span aria-hidden="true">·</span>
                      <span>{company.location}</span>
                    </p>
                  </div>
                </div>
              </div>

              <div className="px-4 py-4 sm:px-5">
                <p className="label-mono mb-3">{t.contacts.relatedOpportunities}</p>
                {opportunities.length === 0 ? (
                  <p className="text-[13.5px] text-foreground/60">{t.contacts.noOpportunities}</p>
                ) : (
                  <div className="space-y-2">
                    {opportunities.map(opp => (
                      <div key={opp.id} className="bg-background-raised border border-border-subtle rounded-lg p-3">
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[12.5px] font-medium px-2 py-0.5 bg-surface-raised rounded-md text-foreground/80 border border-border-subtle">
                            {t.stages[opp.stage]}
                          </span>
                          {opp.dealValue && (
                            <span className="text-[12px] font-medium text-foreground tabular-nums font-mono">
                              {fmt.currency(opp.dealValue)}
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
  const { t } = useTranslations()
  const contacts = useCRMStore((s) => s.contacts)
  const companies = useCRMStore((s) => s.companies)
  const opportunities = useCRMStore((s) => s.opportunities)
  const searchQuery = useCRMStore((s) => s.searchQuery)
  const setSearchQuery = useCRMStore((s) => s.setSearchQuery)

  const [localSearch, setLocalSearch] = useState('')
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null)
  const [addContactOpen, setAddContactOpen] = useState(false)

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
      <Topbar />
      <main className="flex-1 animate-fade-in-up px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[28px] font-jakarta font-semibold text-foreground tracking-[-0.02em] leading-none sm:text-[30px]">{t.contacts.title}</h2>
            <p className="text-[15px] text-foreground/60 mt-1.5 font-mono tabular-nums">{t.contacts.count(filtered.length)}</p>
          </div>
          <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative flex w-full items-center sm:w-auto">
              <Search size={14} className="pointer-events-none absolute left-3 text-foreground/60 sm:left-2.5" />
              <input
                type="text"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder={t.contacts.filter}
                className="h-11 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-[16px] text-foreground outline-none transition-all placeholder:text-foreground/45 focus:border-accent/40 sm:h-9 sm:w-52 sm:rounded-lg sm:pl-8 sm:text-[14px]"
              />
            </div>
            <Button onClick={() => setAddContactOpen(true)} className="h-11 w-full sm:h-[38px] sm:w-auto">
              <Plus size={15} />
              {t.contacts.newContact}
            </Button>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="flex min-h-44 flex-col items-center justify-center px-5 py-8 text-center">
              <Search size={20} className="mb-3 text-muted" aria-hidden="true" />
              <p className="text-[15px] text-foreground/70">{t.contacts.empty}</p>
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setLocalSearch('')
                    setSearchQuery('')
                  }}
                  className="mt-3 min-h-11 rounded-lg px-4 text-[14px] font-medium text-accent transition-colors hover:bg-accent-light"
                >
                  {t.common.clearFilters}
                </button>
              )}
            </div>
          ) : filtered.map((contact, i) => {
            const company = companies.find(c => c.id === contact.companyId)
            const isLast = i === filtered.length - 1
            const oppCount = opportunities.filter(o => o.contactId === contact.id).length

            return (
              <div
                key={contact.id}
                className={cn(
                  'flex min-h-[72px] items-stretch transition-colors duration-100 hover:bg-accent-light',
                  !isLast && 'border-b border-border-subtle'
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedContactId(contact.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 sm:gap-4 sm:px-5 sm:py-4"
                >
                  <div className="w-10 h-10 rounded-full bg-accent-light flex items-center justify-center shrink-0">
                    <span className="text-[15px] font-semibold text-accent">
                      {contact.name.charAt(0)}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-medium text-foreground truncate">{contact.name}</p>
                    <p className="text-[13.5px] text-foreground/60 truncate">{contact.role}</p>
                    {company && (
                      <p className="mt-0.5 truncate text-[12.5px] text-foreground/55 sm:hidden">
                        {company.name}
                      </p>
                    )}
                  </div>

                  <div className="hidden sm:block w-40">
                    <p className="text-[14.5px] text-foreground/85 truncate">{company?.name}</p>
                    <p className="text-[13.5px] text-foreground/60 truncate">{company?.industry}</p>
                  </div>

                  <div className="hidden md:block flex-1 min-w-0">
                    <p className="text-[13.5px] text-foreground/65 font-mono truncate">{contact.email}</p>
                  </div>

                  {oppCount > 0 && (
                    <span className="text-[12.5px] font-mono text-foreground/80 bg-surface-raised px-2 py-0.5 rounded-md border border-border-subtle hidden lg:block">
                      {t.contacts.deals(oppCount)}
                    </span>
                  )}
                </button>

                <div className="flex w-14 shrink-0 items-center justify-center pr-3 sm:w-16 sm:pr-4">
                  {contact.linkedin ? (
                    <a
                      href={`https://${contact.linkedin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t.contacts.linkedInProfile}
                      className="flex size-11 items-center justify-center rounded-xl text-foreground/60 transition-colors hover:bg-surface-raised hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      <ExternalLink size={15} />
                    </a>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </main>

      <AddContactModal open={addContactOpen} onClose={() => setAddContactOpen(false)} />

      <ContactDrawer
        contact={selectedContact}
        company={selectedCompany}
        opportunities={selectedOpps}
        onClose={() => setSelectedContactId(null)}
      />
    </>
  )
}
