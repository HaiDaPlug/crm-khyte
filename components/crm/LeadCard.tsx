'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Opportunity, Company, Contact } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useFormat } from '@/lib/hooks/useFormat'
import { priorityDot } from '@/lib/stage-config'

interface LeadCardProps {
  opportunity: Opportunity
  company: Company
  contact: Contact
  onClick?: () => void
}

export function LeadCard({ opportunity, company, contact, onClick }: LeadCardProps) {
  const fmt = useFormat()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: opportunity.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        // Same card definition as the leads board — the column well below is
        // darkened to match that page's background so this reads as an object
        // on the board rather than a block of text printed on it.
        'min-h-11 touch-manipulation select-none rounded-xl border border-border bg-surface p-3.5 cursor-pointer [-webkit-touch-callout:none]',
        'card-glow transition-all duration-150 active:border-border-accent focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 sm:hover:border-border-accent',
        isDragging && 'opacity-30 shadow-lg border-accent scale-[1.02]'
      )}
    >
      {/* Identity — name and contact are one unit, so they sit tight together
          and the grouping is carried by the larger gaps below. */}
      <div className="flex items-start justify-between gap-2.5">
        <p className="text-[15px] font-semibold text-foreground leading-snug">{company.name}</p>
        {/* Optically centred on the first line of a 15px/1.375 title. */}
        <span className="w-2 h-2 rounded-full mt-[6px] shrink-0" style={{ background: priorityDot[opportunity.priority] }} />
      </div>

      <p className="mt-1 text-[13.5px] text-foreground/60 leading-snug">{contact.name} · {contact.role}</p>

      {opportunity.dealValue && (
        <p className="mt-3 text-[15px] font-semibold text-foreground tabular-nums leading-none">
          {fmt.currency(opportunity.dealValue)}
        </p>
      )}

      {/* Brighter than the contact line: this is the actionable half of the card. */}
      <p className="mt-2.5 text-[13.5px] text-foreground/70 line-clamp-2 leading-[1.45]">
        {opportunity.nextStep}
      </p>

      {opportunity.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {opportunity.tags.slice(0, 2).map(tag => (
            <span key={tag} className="text-[12.5px] font-mono px-2 py-0.5 bg-surface-raised text-foreground/80 border border-border-subtle rounded-md">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
