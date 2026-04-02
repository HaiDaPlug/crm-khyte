'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DollarSign } from 'lucide-react'
import { Opportunity, Company, Contact, Priority } from '@/lib/types'
import { cn } from '@/lib/utils'

const priorityDot: Record<Priority, string> = {
  critical: 'bg-red-500',
  high: 'bg-accent',
  medium: 'bg-blue-400',
  low: 'bg-muted',
}

interface LeadCardProps {
  opportunity: Opportunity
  company: Company
  contact: Contact
  onClick?: () => void
}

export function LeadCard({ opportunity, company, contact, onClick }: LeadCardProps) {
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
        'bg-surface border border-border rounded-lg p-3 cursor-pointer',
        'hover:border-border-accent hover:shadow-[0_0_16px_-4px_rgba(212,148,60,0.08)] transition-all duration-150',
        isDragging && 'opacity-30 shadow-lg border-accent scale-[1.02]'
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-[13px] font-semibold text-foreground leading-snug">{company.name}</p>
        <span className={cn('w-2 h-2 rounded-full mt-1 shrink-0', priorityDot[opportunity.priority])} />
      </div>

      <p className="text-[11px] text-muted mb-2">{contact.name} · {contact.role}</p>

      {opportunity.dealValue && (
        <div className="flex items-center gap-1 mb-2">
          <DollarSign size={11} className="text-muted" />
          <span className="text-[12px] font-medium text-muted-foreground tabular-nums">
            {opportunity.dealValue.toLocaleString()}
          </span>
        </div>
      )}

      <p className="text-[11px] text-muted line-clamp-2 leading-relaxed">
        {opportunity.nextStep}
      </p>

      {opportunity.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {opportunity.tags.slice(0, 2).map(tag => (
            <span key={tag} className="text-[9px] font-mono px-1.5 py-0.5 bg-surface-raised text-muted border border-border-subtle rounded-md">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
