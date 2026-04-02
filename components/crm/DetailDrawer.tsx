'use client'

import { useEffect } from 'react'
import { X, ExternalLink, Calendar, ArrowRight, DollarSign } from 'lucide-react'
import { Opportunity, Company, Contact, Note } from '@/lib/types'
import { NotesTimeline } from './NotesTimeline'
import { cn } from '@/lib/utils'

const priorityConfig = {
  critical: { dot: 'bg-red-500', label: 'Critical', text: 'text-red-400' },
  high: { dot: 'bg-accent', label: 'High', text: 'text-accent' },
  medium: { dot: 'bg-blue-400', label: 'Medium', text: 'text-blue-400' },
  low: { dot: 'bg-muted', label: 'Low', text: 'text-muted' },
}

interface DetailDrawerProps {
  opportunity: Opportunity | null
  company: Company | null
  contact: Contact | null
  notes: Note[]
  onClose: () => void
}

export function DetailDrawer({ opportunity, company, contact, notes, onClose }: DetailDrawerProps) {
  const isOpen = !!opportunity

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEsc)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

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
        {opportunity && company && contact && (
          <>
            <div className="flex items-start justify-between p-5 border-b border-border shrink-0">
              <div className="flex-1 min-w-0 pr-4">
                <h2 className="text-[16px] font-semibold text-foreground truncate font-display">{company.name}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] text-muted font-mono">{company.industry}</span>
                  <span className="text-border">·</span>
                  <span className="text-[11px] text-muted font-mono">{company.size}</span>
                  <span className="text-border">·</span>
                  <span className="text-[11px] text-muted font-mono">{company.location}</span>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-raised text-muted hover:text-foreground transition-colors shrink-0"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Contact */}
              <div className="px-5 py-4 border-b border-border-subtle">
                <p className="label-mono mb-2.5">Primary Contact</p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-accent-light flex items-center justify-center shrink-0">
                    <span className="text-[12px] font-semibold text-accent">
                      {contact.name.charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground">{contact.name}</p>
                    <p className="text-[11.5px] text-muted">{contact.role}</p>
                  </div>
                  {contact.linkedin && (
                    <a
                      href={`https://${contact.linkedin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted hover:text-accent transition-colors"
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
                <p className="mt-2 text-[11.5px] text-muted font-mono">{contact.email}</p>
              </div>

              {/* Deal */}
              <div className="px-5 py-4 border-b border-border-subtle">
                <p className="label-mono mb-3">Deal</p>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-background-raised rounded-lg px-3 py-2.5">
                    <p className="label-mono mb-1">Stage</p>
                    <span className="text-[12px] font-medium text-foreground bg-surface-raised px-2 py-0.5 rounded border border-border-subtle">
                      {opportunity.stage}
                    </span>
                  </div>

                  <div className="bg-background-raised rounded-lg px-3 py-2.5">
                    <p className="label-mono mb-1">Priority</p>
                    <div className="flex items-center gap-1.5">
                      <span className={cn('w-2 h-2 rounded-full', priorityConfig[opportunity.priority].dot)} />
                      <span className={cn('text-[12px] font-medium', priorityConfig[opportunity.priority].text)}>
                        {priorityConfig[opportunity.priority].label}
                      </span>
                    </div>
                  </div>

                  {opportunity.dealValue && (
                    <div className="bg-background-raised rounded-lg px-3 py-2.5">
                      <p className="label-mono mb-1">Deal Value</p>
                      <div className="flex items-center gap-1">
                        <DollarSign size={12} className="text-muted" />
                        <span className="text-[13px] font-semibold text-foreground tabular-nums">
                          {opportunity.dealValue.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="bg-background-raised rounded-lg px-3 py-2.5">
                    <p className="label-mono mb-1">Follow-up</p>
                    <div className="flex items-center gap-1">
                      <Calendar size={11} className="text-muted" />
                      <span className="text-[12px] text-foreground font-mono">{opportunity.followUpDate}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 bg-accent-light border border-border-accent rounded-lg px-3.5 py-3">
                  <div className="flex items-start gap-2">
                    <ArrowRight size={12} className="mt-0.5 text-accent shrink-0" />
                    <div>
                      <p className="label-mono text-accent mb-0.5">Next Step</p>
                      <p className="text-[13px] text-foreground leading-relaxed">{opportunity.nextStep}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tags */}
              {opportunity.tags.length > 0 && (
                <div className="px-5 py-4 border-b border-border-subtle">
                  <p className="label-mono mb-2.5">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {opportunity.tags.map(tag => (
                      <span
                        key={tag}
                        className="text-[10px] font-mono px-2 py-0.5 bg-surface-raised text-muted-foreground rounded-md border border-border-subtle"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="px-5 py-4">
                <p className="label-mono mb-4">Notes</p>
                {opportunity.notes && (
                  <div className="mb-4 p-3 bg-background-raised rounded-lg border border-border-subtle">
                    <p className="text-[13px] text-foreground leading-relaxed">{opportunity.notes}</p>
                  </div>
                )}
                <NotesTimeline notes={notes} />
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
