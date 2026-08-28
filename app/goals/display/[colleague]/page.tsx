import { notFound } from 'next/navigation'

import { DisplayBoard } from '@/components/goals/DisplayBoard'
import { COLLEAGUE_IDS } from '@/lib/colleagues'
import { loadGoals, loadGoalsVersion } from '@/lib/db/queries'
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

/**
 * Unconditional reload period, in seconds. The backstop for what the version
 * stamp cannot see — a deploy, a persistently failing check, a slept machine.
 */
const REFRESH_SECONDS = 300

/**
 * How often the board asks whether anything changed.
 *
 * Five seconds: an edit reaches the desktop about as fast as someone can look
 * up from the editor, and the request is one indexed aggregate returning a few
 * bytes — three boards checking at this rate is negligible next to the page
 * render it replaces.
 */
const CHECK_SECONDS = 5

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

  // Read together: the version has to describe the same board that is about to
  // render, or the first check would see a difference and reload immediately.
  const [{ goals, metrics, personalGoals, weeklyCounts, totals }, version] =
    await Promise.all([
      loadGoals(),
      loadGoalsVersion(),
    ])

  // One clock reading for the whole render, so the period label and every
  // deadline countdown are computed against the same instant.
  const now = new Date()

  return (
    <>
      <BoardRefresh
        seconds={REFRESH_SECONDS}
        checkSeconds={CHECK_SECONDS}
        version={version}
      />
      {/* Exactly the viewport, and nothing but. The board fills this rather
          than being centred inside it — Lively hands over the whole monitor,
          so letterboxing a fixed 16:9 box into it would waste the edges of
          every screen that is not exactly 16:9.
          `overflow-hidden` because a wallpaper has no scrollbar and nobody to
          drive one: anything that does not fit has to be a visible layout
          problem here, not content silently cut off below the fold. */}
      <div className="h-dvh w-screen overflow-hidden">
        <DisplayBoard
          colleague={colleague as ColleagueId}
          goals={goals}
          metrics={metrics}
          personalGoals={personalGoals}
          weeklyCounts={weeklyCounts}
          totals={totals}
          period={currentPeriod(now)}
          now={now}
        />
      </div>
    </>
  )
}
