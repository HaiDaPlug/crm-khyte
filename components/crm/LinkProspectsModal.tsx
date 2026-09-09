'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'
import { useCRMStore } from '@/lib/store'
import { cn, newId } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

interface LinkProspectsModalProps {
  open: boolean
  onClose: () => void
  /**
   * Null for a prospect with no board yet — checking any box here creates one
   * and links both prospects to it, the same first-headline path StrategyBoard
   * uses so the two can never disagree about how a board comes into being.
   */
  boardId: string | null
  /** Always rendered checked and disabled, so this modal can never unlink the
   * one prospect it's scoped to down to zero links from inside itself. */
  currentOpportunityId: string
}

/**
 * Search all prospects and check/uncheck which ones share the current board.
 *
 * Toggling is immediate, not staged-then-saved — matches every other write in
 * this app applying optimistically the moment the user acts, not on a footer
 * "Save". There is nothing here to discard, so unlike AddProspectModal there
 * is no dirty-state confirmation on close.
 */
export function LinkProspectsModal({
  open,
  onClose,
  boardId,
  currentOpportunityId,
}: LinkProspectsModalProps) {
  const { t } = useTranslations()
  const copy = t.strategy.linkModal
  const opportunities = useCRMStore((s) => s.opportunities)
  const companies = useCRMStore((s) => s.companies)
  const boardLinks = useCRMStore((s) => s.strategyBoardOpportunities)
  const createStrategyBoard = useCRMStore((s) => s.createStrategyBoard)
  const linkOpportunityToBoard = useCRMStore((s) => s.linkOpportunityToBoard)
  const unlinkOpportunityFromBoard = useCRMStore((s) => s.unlinkOpportunityFromBoard)

  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const linkedIds = useMemo(
    () =>
      new Set(
        boardId ? boardLinks.filter((l) => l.boardId === boardId).map((l) => l.opportunityId) : []
      ),
    [boardLinks, boardId]
  )

  const q = query.trim().toLowerCase()
  const rows = useMemo(() => {
    const withCompany = opportunities.map((opp) => ({
      opp,
      company: companies.find((c) => c.id === opp.companyId) ?? null,
    }))
    const filtered = q
      ? withCompany.filter((r) => r.company?.name.toLowerCase().includes(q))
      : withCompany
    // The current prospect always leads, so it's never lost in a long list —
    // its row is the one that explains what this modal is even scoped to.
    return filtered.sort((a, b) => {
      if (a.opp.id === currentOpportunityId) return -1
      if (b.opp.id === currentOpportunityId) return 1
      return (a.company?.name ?? '').localeCompare(b.company?.name ?? '')
    })
  }, [opportunities, companies, q, currentOpportunityId])

  const toggle = (opportunityId: string) => {
    if (opportunityId === currentOpportunityId) return

    let targetBoardId = boardId
    if (!targetBoardId) {
      // Nothing to link to yet — same as StrategyBoard's handleAddColumn when
      // a prospect's first headline is added, so a board created from either
      // entry point behaves identically.
      targetBoardId = newId()
      createStrategyBoard({ id: targetBoardId })
      linkOpportunityToBoard(targetBoardId, currentOpportunityId)
    }

    if (linkedIds.has(opportunityId)) {
      unlinkOpportunityFromBoard(targetBoardId, opportunityId)
    } else {
      linkOpportunityToBoard(targetBoardId, opportunityId)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={copy.title}
      subtitle={copy.subtitle}
      width="w-[480px]"
      footer={
        <Button onClick={onClose} className="ml-auto">
          {copy.done}
        </Button>
      }
    >
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
          <p className="px-2.5 py-6 text-center text-[13.5px] text-foreground/50">{copy.noMatches}</p>
        ) : (
          rows.map(({ opp, company }) => {
            const isCurrent = opp.id === currentOpportunityId
            const checked = isCurrent || linkedIds.has(opp.id)
            return (
              <label
                key={opp.id}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors',
                  isCurrent ? 'opacity-60' : 'cursor-pointer hover:bg-surface-raised'
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isCurrent}
                  onChange={() => toggle(opp.id)}
                  className="size-4 shrink-0 accent-accent disabled:cursor-not-allowed"
                />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
                  {company?.name}
                </span>
                <span className="shrink-0 font-mono text-[12.5px] text-foreground/60">
                  {t.stages[opp.stage]}
                </span>
              </label>
            )
          })
        )}
      </div>
    </Modal>
  )
}
