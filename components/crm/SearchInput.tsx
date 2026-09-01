'use client'

import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** Accessible name; falls back to the placeholder when the label is visual-only. */
  label?: string
  className?: string
}

/**
 * The search field shared by /prospects and /leads. Type `search` rather than
 * `text` so phones offer the search key, but the browser's native clear affordance
 * is suppressed — it only exists in WebKit and skips the onChange path — in favour
 * of an explicit button that works everywhere.
 */
export function SearchInput({ value, onChange, placeholder, label, className }: SearchInputProps) {
  const { t } = useTranslations()

  return (
    <div className={cn('relative flex items-center', className)}>
      <Search size={14} className="pointer-events-none absolute left-3 text-foreground/60 sm:left-2.5" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className={cn(
          'h-11 w-full rounded-xl border border-border bg-surface pl-9 text-[16px] text-foreground outline-none transition-all',
          'placeholder:text-foreground/45 focus:border-accent/40',
          'sm:h-9 sm:rounded-lg sm:pl-8 sm:text-[14px]',
          '[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
          value ? 'pr-10 sm:pr-9' : 'pr-3'
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t.common.clearSearch}
          className="absolute right-1 flex size-9 items-center justify-center rounded-lg text-foreground/60 transition-colors hover:bg-surface-raised hover:text-foreground sm:right-0.5 sm:size-8"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
