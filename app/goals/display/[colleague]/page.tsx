import { notFound } from 'next/navigation'

import { DisplayBoard } from '@/components/goals/DisplayBoard'
import { COLLEAGUE_IDS } from '@/lib/colleagues'
import { loadGoals } from '@/lib/db/queries'
import type { ColleagueId } from '@/lib/types'
import { BoardRefresh } from './BoardRefresh'

/**
 * The wallpaper route. Zero navigation, zero controls, one 16:9 board.
 *
 * Reached two ways, both read-only:
 *   - Lively Wallpaper, at `?k=<display token>` — see lib/auth/display-token.ts
 *   - a normal browser tab with a session, no token needed
 *
 * proxy.ts is what admits the tokened request; nothing here re-checks it,
 * because by the time this renders the request has already passed the gate one
 * way or the other. Note this page renders no forms and calls no Server
 * Actions — a token holder can read this board and do nothing else.
 *
 * loadGoals() rather than loadSnapshot(): three small tables, not the entire
 * CRM working set, because this repaints on a timer. See lib/db/queries.ts.
 */

/** How often the board pulls fresh data, in seconds. Five minutes is well
 *  under a working session and far above anything that would hammer the DB. */
const REFRESH_SECONDS = 300

/** The quarter label in the header, derived rather than stored — one less
 *  field to remember to update every three months. */
function currentPeriod(now: Date): string {
  return `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`
}

export default async function GoalsDisplayPage({
  params,
}: {
  params: Promise<{ colleague: string }>
}) {
  const { colleague } = await params

  // The roster is the source of truth. An unknown segment 404s rather than
  // rendering an empty personal column — a wallpaper that silently shows
  // nobody's focus is worse than one that visibly fails.
  if (!COLLEAGUE_IDS.includes(colleague as ColleagueId)) {
    notFound()
  }

  const { goals, metrics, focusItems } = await loadGoals()

  return (
    <>
      <BoardRefresh seconds={REFRESH_SECONDS} />
      {/* Centred and letterboxed: Lively hands this whatever the monitor's
          aspect ratio is, and the board is authored at exactly 16:9. On a
          21:9 ultrawide the bars are the wallpaper's background, not a bug. */}
      <div className="flex min-h-dvh items-center justify-center bg-[#0D0B0A]">
        <DisplayBoard
          colleague={colleague as ColleagueId}
          goals={goals}
          metrics={metrics}
          focusItems={focusItems}
          period={currentPeriod(new Date())}
        />
      </div>
    </>
  )
}
