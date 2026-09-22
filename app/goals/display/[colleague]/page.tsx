import { notFound, redirect } from 'next/navigation'

import { DisplayBoard } from '@/components/goals/DisplayBoard'
import { displayOrganization } from '@/lib/auth/display-access'
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
 * proxy.ts admits the request one of those two ways, and this page checks
 * again — not out of distrust of Proxy, but because the check is also where
 * the organization comes from. A token names the organization it was minted
 * for; a session names the one it is acting in. Neither is read from the URL
 * in the clear: the `?k=` value is only ever interpreted through
 * lib/auth/display-access, which yields an organization id if and only if
 * the HMAC over that organization, the minting member and this colleague
 * verifies AND that member is still active. Token first, session second, so a
 * wallpaper link keeps working in a browser that also happens to be logged
 * into some other workspace — the link says whose board it is. Neither means
 * the login page, since a wallpaper cannot fill one in and a person can.
 *
 * Note this page renders no forms and calls no Server Actions — a token holder
 * can read this board and do nothing else.
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
  searchParams,
}: {
  params: Promise<{ colleague: string }>
  searchParams: Promise<{ k?: string }>
}) {
  const { colleague } = await params
  const { k } = await searchParams

  // The roster is the source of truth. An unknown segment 404s rather than
  // rendering an empty personal column — a wallpaper that silently shows
  // nobody's focus is worse than one that visibly fails.
  if (!COLLEAGUE_IDS.includes(colleague as ColleagueId)) {
    notFound()
  }

  // Which organization's board this is — see the header. The token is tried
  // before the session, and a token only counts while the member who minted
  // it is still one (lib/auth/display-access.ts): a revoked person's copied
  // link must not keep showing the team's numbers.
  const organizationId = await displayOrganization(colleague, k)
  if (!organizationId) {
    redirect('/login')
  }

  // Read together: the version has to describe the same board that is about to
  // render, or the first check would see a difference and reload immediately.
  const [{ goals, metrics, personalGoals, weeklyCounts, totals }, version] =
    await Promise.all([
      loadGoals(organizationId),
      loadGoalsVersion(organizationId),
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
