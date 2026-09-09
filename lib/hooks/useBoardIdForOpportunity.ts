'use client'

import { useCRMStore } from '@/lib/store'

/**
 * Which strategy board a prospect is on, or `null` for one that hasn't
 * started a board yet.
 *
 * A board can be linked to more than one prospect (see `StrategyBoard` in
 * lib/types), so this is a lookup through the join, not a field on the
 * opportunity itself. Shared by `StrategyBoard.tsx` (which columns/cards to
 * show) and `/strategy` (which prospects are linked alongside this one) so
 * the two cannot resolve "whose board is this" differently.
 */
export function useBoardIdForOpportunity(opportunityId: string): string | null {
  return useCRMStore(
    (s) => s.strategyBoardOpportunities.find((l) => l.opportunityId === opportunityId)?.boardId ?? null
  )
}
