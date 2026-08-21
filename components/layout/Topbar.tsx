'use client'

import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCRMStore } from '@/lib/store'
import { useTranslations } from '@/lib/hooks/useTranslations'

interface TopbarProps {
  title: string
  actions?: React.ReactNode
}

export function Topbar({ title, actions }: TopbarProps) {
  const { t } = useTranslations()
  const searchQuery = useCRMStore((s) => s.searchQuery)
  const setSearchQuery = useCRMStore((s) => s.setSearchQuery)
  const [searchFocused, setSearchFocused] = useState(false)

  return (
    <header className="sticky top-0 z-20 h-[52px] bg-background/70 backdrop-blur-xl border-b border-border flex items-center px-6 gap-4">
      <h1 className="text-[14px] font-medium text-foreground shrink-0 tracking-tight font-mono uppercase">
        {title}
      </h1>

      <div className="flex-1" />

      {/* Search */}
      <div className={cn(
        'relative hidden sm:flex items-center transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
        searchFocused ? 'w-64' : 'w-48'
      )}>
        <Search size={13} className="absolute left-2.5 text-muted pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder={t.common.search}
          className={cn(
            'h-8 w-full pl-8 pr-3 text-[13px] bg-surface border border-border rounded-lg',
            'text-foreground placeholder:text-muted outline-none',
            'focus:border-accent/40 transition-all'
          )}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2 text-muted hover:text-foreground"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {actions}
    </header>
  )
}
