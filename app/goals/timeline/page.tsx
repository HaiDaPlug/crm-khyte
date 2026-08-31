import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { Topbar } from '@/components/layout/Topbar'
import { requireSession } from '@/lib/auth/guard'
import { loadGoals } from '@/lib/db/queries'
import { goalPeriodFor, NO_DEADLINE_SORT_KEY } from '@/lib/goal-period'
import type { Goal, GoalStatus } from '@/lib/types'

/**
 * Read view of every dated goal, grouped by when it is actually due.
 *
 * GoalsEditor already owns creating/editing a `goal`-family row — duplicating
 * that here would just be a second place the same write can go stale. This
 * page exists for the thing the editor cannot show at all: what is coming up
 * soonest, since the editor lists goals in manual `sort_order`, not by date.
 */

const STATUS_LABELS: Record<GoalStatus, string> = {
  on_track: 'På spår',
  at_risk: 'Risk',
  off_track: 'Ur spår',
  done: 'Klart',
}

/** Same palette DisplayBoard's `statusColor` draws from, but as app theme
 *  tokens rather than fixed hex — this page renders inside the normal
 *  light/dark shell, not the always-dark wallpaper. There is no `--warning`
 *  token in globals.css, so `at_risk` reuses `--accent` — the same amber
 *  DisplayBoard hardcodes for it. */
const STATUS_DOT: Record<GoalStatus, string> = {
  on_track: 'bg-success',
  at_risk: 'bg-accent',
  off_track: 'bg-danger',
  done: 'bg-foreground/30',
}

export default async function GoalsTimelinePage() {
  await requireSession()

  const { goals } = await loadGoals()
  const now = new Date()

  const dated = goals.filter((g) => g.section === 'goal')

  const groups = new Map<string, { label: string; goals: Goal[] }>()
  for (const goal of dated) {
    const period = goalPeriodFor(goal.targetDate, now)
    const existing = groups.get(period.sortKey)
    if (existing) existing.goals.push(goal)
    else groups.set(period.sortKey, { label: period.label, goals: [goal] })
  }

  // "No deadline" always sorts last regardless of its key's literal value —
  // spelling that out here rather than relying on NO_DEADLINE_SORT_KEY being
  // string-greater than every real key forever.
  const ordered = [...groups.entries()].sort(([a], [b]) => {
    if (a === NO_DEADLINE_SORT_KEY) return 1
    if (b === NO_DEADLINE_SORT_KEY) return -1
    return a.localeCompare(b)
  })

  return (
    <>
      <Topbar />
      <main className="min-w-0 flex-1 px-4 py-5 animate-fade-in-up sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <div className="mb-5">
          <Link
            href="/goals"
            className="mb-3 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-foreground/55 transition-colors hover:text-foreground"
          >
            <ArrowLeft size={14} />
            Riktning
          </Link>
          <h2 className="mb-1 text-[26px] font-jakarta font-semibold leading-none tracking-[-0.02em] text-foreground sm:text-[30px]">
            Tidslinje
          </h2>
          <p className="text-[14.5px] text-foreground/55">
            Årsmål och kvartalsmål, grupperade efter datum — det som ligger
            närmast i tid överst.
          </p>
        </div>

        {ordered.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="text-[13.5px] text-foreground/40">
              Inget här ännu. Lägg till mål med datum under Mål på{' '}
              <Link href="/goals" className="text-accent hover:underline">
                Riktning
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {ordered.map(([sortKey, group]) => (
              <section
                key={sortKey}
                className="rounded-xl border border-border bg-surface p-4 sm:p-5"
              >
                <h3 className="label-mono mb-3">{group.label}</h3>
                <ul className="flex flex-col gap-3">
                  {group.goals.map((goal) => (
                    <li
                      key={goal.id}
                      className="flex items-start justify-between gap-4 rounded-lg border border-border-subtle bg-background-raised px-3.5 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14.5px] font-medium text-foreground">
                          {goal.title || 'Namnlöst mål'}
                        </p>
                        {goal.detail && (
                          <p className="mt-0.5 truncate text-[13px] text-foreground/55">
                            {goal.detail}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-3">
                        {goal.progress !== undefined && (
                          <span className="font-mono text-[13px] tabular-nums text-foreground/60">
                            {goal.progress}%
                          </span>
                        )}
                        <span className="flex items-center gap-1.5 text-[13px] text-foreground/70">
                          <span
                            aria-hidden
                            className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[goal.status]}`}
                          />
                          {STATUS_LABELS[goal.status]}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
