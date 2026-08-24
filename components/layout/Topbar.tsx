'use client'

interface TopbarProps {
  actions?: React.ReactNode
}

export function Topbar({ actions }: TopbarProps) {
  if (!actions) return null

  return (
    <header className="sticky top-0 z-20 h-16 bg-background/70 backdrop-blur-xl border-b border-border flex items-center justify-end pl-8 pr-6 gap-4">
      {actions}
    </header>
  )
}
