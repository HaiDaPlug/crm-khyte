import { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: React.ReactNode
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-8 text-center animate-fade-in-up">
      <div className="w-12 h-12 rounded-xl bg-accent-light flex items-center justify-center mb-4">
        <Icon size={22} className="text-accent" />
      </div>
      <h3 className="text-[17px] font-semibold text-foreground mb-2 font-display">{title}</h3>
      <p className="text-[14.5px] text-foreground/60 max-w-sm leading-relaxed">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
