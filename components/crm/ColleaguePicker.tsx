'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COLLEAGUE_IDS, colleagues } from '@/lib/colleagues'
import { ColleagueId } from '@/lib/types'
import { useTranslations } from '@/lib/hooks/useTranslations'

/**
 * Switches between the shared task board (`/tasks`) and one colleague's
 * (`/tasks/[colleagueId]`). A plain popover rather than the modal dialog
 * primitive — no focus trap or scroll lock needed for a menu this small,
 * just close on outside click or Escape.
 */
export function ColleaguePicker({ active }: { active: ColleagueId | null }) {
  const { t } = useTranslations()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const activePerson = active ? colleagues[active] : null

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex h-11 items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3.5 text-[14px] font-medium transition-colors sm:h-[38px]',
          'hover:border-border',
          open ? 'border-border' : ''
        )}
      >
        {activePerson ? (
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
            style={{ background: activePerson.color }}
          >
            {activePerson.name.charAt(0)}
          </span>
        ) : (
          <Users size={14} className="text-foreground/60" />
        )}
        <span className="text-foreground">{activePerson ? activePerson.name : t.tasks.allColleagues}</span>
        <ChevronDown size={13} className={cn('text-foreground/50 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1.5 w-48 overflow-hidden rounded-lg border border-border-subtle bg-surface py-1 shadow-lg animate-fade-in"
        >
          <Link
            href="/tasks"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 text-[13.5px] font-medium transition-colors hover:bg-surface-raised',
              active === null ? 'text-foreground' : 'text-foreground/70'
            )}
          >
            <Users size={14} className="text-foreground/60" />
            {t.tasks.allColleagues}
          </Link>
          {COLLEAGUE_IDS.map((id) => {
            const person = colleagues[id]
            return (
              <Link
                key={id}
                href={`/tasks/${id}`}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 text-[13.5px] font-medium transition-colors hover:bg-surface-raised',
                  active === id ? 'text-foreground' : 'text-foreground/70'
                )}
              >
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                  style={{ background: person.color }}
                >
                  {person.name.charAt(0)}
                </span>
                {person.name}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
