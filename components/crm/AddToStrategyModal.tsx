'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { Modal } from './Modal'
import { useCRMStore } from '@/lib/store'
import { newId } from '@/lib/utils'
import { priorityDot } from '@/lib/stage-config'
import { useTranslations } from '@/lib/hooks/useTranslations'

interface AddToStrategyModalProps {
  open: boolean
  onClose: () => void
  /** Selects the prospect once it has a board, so the page lands on what was just added. */
  onAdded: (opportunityId: string) => void
}

/**
 * Pick an existing prospect and give it a strategy board.
 *
 * Deliberately not AddProspectModal: that creates a company, a contact and an
 * opportunity, which is the wrong operation here. A strategy board is built for
 * a deal that already exists, so this only ever picks — matching the pipeline
 * page's off-board picker, which likewise adds existing prospects and never
 * creates one.
 *
 * Adding is immediate rather than staged behind a Save, matching every other
 * write in this app and LinkProspectsModal in particular.
 */
export function AddToStrategyModal({ open, onClose, onAdded }: AddToStrategyModalProps) {
  const { t } = useTranslations()
  const copy = t.strategy.addPicker
  const opportunities = useCRMStore((s) => s.opportunities)
  const companies = useCRMStore((s) => s.companies)
  const boardLinks = useCRMStore((s) => s.strategyBoardOpportunities)
  const createStrategyBoard = useCRMStore((s) => s.createStrategyBoard)
  const linkOpportunityToBoard = useCRMStore((s) => s.linkOpportunityToBoard)

  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const q = query.trim().toLowerCase()

  /** Prospects not yet in strategy — adding one already in it would be a no-op. */
  const rows = useMemo(() => {
    const inStrategy = new Set(boardLinks.map((l) => l.opportunityId))
    return opportunities
      .filter((opp) => !inStrategy.has(opp.id))
      .map((opp) => ({ opp, company: companies.find((c) => c.id === opp.companyId) ?? null }))
      .filter((r) => !q || r.company?.name.toLowerCase().includes(q))
      .sort((a, b) => (a.company?.name ?? '').localeCompare(b.company?.name ?? ''))
  }, [opportunities, companies, boardLinks, q])

  const everyProspectAdded = rows.length === 0 && !q

  const add = (opportunityId: string) => {
    // Same two calls, in the same order, as StrategyBoard's first-headline path
    // and LinkProspectsModal — a board created from any entry point is identical.
    const boardId = newId()
    createStrategyBoard({ id: boardId })
    linkOpportunityToBoard(boardId, opportunityId)
    onAdded(opportunityId)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={copy.title} subtitle={copy.subtitle} width="w-[480px]">
      <div className="relative border-b border-border-subtle px-4 py-3 sm:px-7">
        <Search size={14} className="pointer-events-none absolute left-8 top-1/2 -translate-y-1/2 text-foreground/50 sm:left-11" aria-hidden="true" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.searchPlaceholder}
          autoFocus
          className="h-10 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[14.5px] text-foreground outline-none placeholder:text-foreground/45 focus:border-accent/40"
        />
      </div>

      <div className="max-h-[min(420px,60dvh)] overflow-y-auto overscroll-contain px-2 py-2 sm:px-4">
        {rows.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-[13.5px] text-foreground/50">
            {everyProspectAdded ? copy.allAdded : copy.noMatches}
          </p>
        ) : (
          rows.map(({ opp, company }) => (
            <button
              key={opp.id}
              type="button"
              onClick={() => add(opp.id)}
              className="group flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-surface-raised"
            >
              <span className="min-w-0">
                <span className="block truncate text-[14.5px] font-medium text-foreground">{company?.name}</span>
                <span className="block truncate text-[13px] text-foreground/60">{t.stages[opp.stage]}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: priorityDot[opp.priority] }} />
                <Plus size={14} className="text-foreground/60 transition-colors group-hover:text-accent" />
              </span>
            </button>
          ))
        )}
      </div>
    </Modal>
  )
}
