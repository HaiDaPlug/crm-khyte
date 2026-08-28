import type { ColleagueId, PersonalGoal, Goal, GoalMetric, GoalStatus } from '@/lib/types'
import { colleagues } from '@/lib/colleagues'

/**
 * The wallpaper. Fills the screen, no chrome, no controls, no interactivity.
 *
 * Design is code, content is data — changing a quarter priority changes what
 * gets printed into a region, never the layout. That is what makes one design
 * serve every colleague and survive editing without anyone opening Figma.
 *
 * Deliberately a server component with no client hooks. It renders outside
 * AppShell, so there is no store to read settings from — every format decision
 * below is fixed rather than user-configurable, because a desktop background
 * has no user to configure it.
 *
 * WHAT IS DELIBERATELY NOT HERE. Principles and the "not now" list are stored
 * and editable at /goals but never drawn, and every list is capped (see CAPS).
 * A wallpaper is read in half-second glances from across a room while doing
 * something else — it is not a document. Everything on it earns its place by
 * being worth that glance, and the fastest way to make it worthless is to let
 * it fill up. The editor is where the full picture lives.
 *
 * Every length is a multiple of `--u`, so the composition scales as one piece
 * to whatever Lively hands it — a 4K monitor gets the same board as a 1080p
 * one, just larger. Nothing wraps responsively or hits a breakpoint.
 */

/** Fixed hex, not theme tokens — same reasoning as `priorityDot`: the board is
 *  always dark and must read identically wherever it is rendered. */
const statusColor: Record<GoalStatus, string> = {
  on_track: '#4CAF72',
  at_risk: '#D4943C',
  off_track: '#E05252',
  done: '#8A857D',
}

/**
 * How many rows each region will draw.
 *
 * Hard caps rather than "however many exist", because the layout's proportions
 * are the design — a fourth quarter priority does not make the board more
 * informative, it makes every line smaller. Overflow is silently dropped here
 * and still visible in the editor, which is the right place for the long tail.
 */
const CAPS = { quarter: 3, weekly: 3, personal: 3, metrics: 3 } as const

/** `sv-SE` separates thousands with a non-breaking space, which reads as a gap
 *  at wallpaper scale; a thin space keeps large sums tight. */
function formatNumber(value: number): string {
  return new Intl.NumberFormat('sv-SE').format(value).replace(/ /g, ' ')
}

function formatMetric(value: number, unit: GoalMetric['unit']): string {
  if (unit === 'percent') return `${formatNumber(value)}%`
  if (unit !== 'currency') return formatNumber(value)
  // Read at a glance from across a room: 182k carries the same meaning as
  // 182 000 and leaves room for the target beside it.
  if (Math.abs(value) >= 1_000_000) {
    return `${formatNumber(Math.round(value / 100_000) / 10)}M`
  }
  if (Math.abs(value) >= 10_000) {
    return `${formatNumber(Math.round(value / 1000))}k`
  }
  return formatNumber(value)
}

/**
 * A deadline as time remaining, not as a date.
 *
 * "4 månader" is the thing you actually want to know from a wallpaper;
 * "2026-12-01" makes you do the subtraction yourself every time you glance at
 * it. Months until the target, floored, with days taking over under one month
 * because that is when the number starts mattering daily.
 */
function untilLabel(targetDate: string, now: Date): string | undefined {
  const target = new Date(`${targetDate}T00:00:00`)
  if (Number.isNaN(target.getTime())) return undefined

  const days = Math.ceil((target.getTime() - now.getTime()) / 86_400_000)
  if (days < 0) return 'försenat'
  if (days === 0) return 'idag'
  if (days === 1) return 'imorgon'
  if (days < 31) return `${days} dagar`

  const months = Math.round(days / 30.44)
  return months === 1 ? '1 månad' : `${months} månader`
}

/** Section heading. One typographic treatment, used four times. */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="shrink-0 font-mono uppercase text-[color:var(--dim)]"
      style={{
        fontSize: 'calc(0.62 * var(--u))',
        letterSpacing: '0.26em',
        marginBottom: 'calc(1.5 * var(--u))',
      }}
    >
      {children}
    </h2>
  )
}

/** Hairline progress rule. Rendered at 0 too — an empty bar is a statement,
 *  a missing bar means "not measured". */
function Bar({ value }: { value: number }) {
  return (
    <div
      className="w-full overflow-hidden rounded-full bg-white/10"
      style={{ height: 'calc(0.14 * var(--u))' }}
    >
      <div
        className="h-full rounded-full bg-[color:var(--accent)]"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

export interface DisplayBoardProps {
  colleague: ColleagueId
  goals: Goal[]
  metrics: GoalMetric[]
  personalGoals: PersonalGoal[]
  /**
   * This week's activity counts, keyed by event kind. A weekly non-negotiable
   * reads its number from here rather than from its own row, which is what
   * stops it drifting from what the CRM actually recorded.
   */
  weeklyCounts: Record<string, number>
  /** Revenue, customers and open pipeline as the deals currently stand. */
  totals: { revenue: number; customers: number; pipeline: number }
  /** Rendered in the header — the quarter/period label, e.g. "Q3 2026". */
  period: string
  /** Injected rather than read from the clock here, so the countdown and the
   *  period label agree and the component stays a pure function of its props. */
  now: Date
}

export function DisplayBoard({
  colleague,
  goals,
  metrics,
  personalGoals,
  weeklyCounts,
  totals,
  period,
  now,
}: DisplayBoardProps) {
  const bySection = (section: Goal['section']) =>
    goals.filter((g) => g.section === section).sort((a, b) => a.order - b.order)

  const northStar = bySection('north_star')[0]
  const quarter = bySection('quarter').slice(0, CAPS.quarter)
  const weekly = bySection('weekly').slice(0, CAPS.weekly)

  const person = colleagues[colleague]
  const personal = personalGoals
    .filter((p) => p.colleague === colleague)
    .sort((a, b) => a.order - b.order)
    .slice(0, CAPS.personal)

  /**
   * The bottom row, derived rather than typed.
   *
   * Built here instead of read from `metrics` so the numbers cannot disagree
   * with the CRM: each one is recomputed from the deals as they currently
   * stand, which is why moving a deal out of Won lowers revenue again. The
   * targets still come from the operator's own goal_metrics rows, matched by
   * unit and label — a target is a decision, only the actual is a fact.
   */
  const targetFor = (label: string): number | undefined =>
    metrics.find((m) => m.label.toLowerCase() === label)?.targetValue

  const scoreboard: GoalMetric[] = [
    {
      id: 'derived-revenue',
      label: 'Intäkt',
      currentValue: totals.revenue,
      targetValue: targetFor('intäkt'),
      unit: 'currency' as const,
      order: 0,
    },
    {
      id: 'derived-pipeline',
      label: 'Pipeline',
      currentValue: totals.pipeline,
      targetValue: targetFor('pipeline'),
      unit: 'currency' as const,
      order: 1,
    },
    {
      id: 'derived-customers',
      label: 'Kunder',
      currentValue: totals.customers,
      targetValue: targetFor('kunder'),
      unit: 'number' as const,
      order: 2,
    },
  ].slice(0, CAPS.metrics)

  return (
    <div
      data-theme="dark"
      className="board-surface relative h-full w-full overflow-hidden"
      style={
        {
          // Fills the frame rather than fitting a 16:9 box inside it. A
          // wallpaper IS the screen — letterboxing wastes the edges of every
          // monitor that is not exactly 16:9.
          //
          // `--u` is the type scale, and it is the whole trick to filling a
          // frame whose shape is unknown. Sizing off width alone makes type
          // enormous on a 21:9 ultrawide and cramped on a 16:10 laptop, because
          // width stops predicting height. Blending both — weighted toward
          // width, which is what a wide layout mostly follows — keeps the
          // composition recognisably the same board on any monitor.
          '--u': 'calc(0.78vw + 0.32vh)',
          '--accent': '#D4943C',
          '--dim': 'rgba(255,255,255,0.38)',
        } as React.CSSProperties
      }
    >
      {/* Warm light from the top-left — keeps a very dark board from reading
          as flat black, and gives the north star something to sit against. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(115% 85% at 6% -12%, rgba(138,59,14,0.34) 0%, transparent 56%),' +
            'radial-gradient(75% 65% at 102% 108%, rgba(138,59,14,0.14) 0%, transparent 52%)',
        }}
      />

      <div
        className="relative flex h-full flex-col"
        style={{ padding: 'calc(3.6 * var(--u)) calc(6 * var(--u)) calc(5.5 * var(--u))' }}
      >
        {/* ——— north star: the one thing worth the biggest type on screen ———
            No eyebrow label. At this size and this position nothing else could
            be mistaken for it, so the word "Nordstjärna" was only taking up the
            space above it. */}
        {northStar && (
          <div className="shrink-0 text-center">
            <p
              className="font-jakarta font-semibold text-white"
              style={{
                fontSize: 'calc(3.4 * var(--u))',
                lineHeight: 1.14,
                // Optical tightening: Jakarta at display size sets looser than
                // the serif it replaced, and the default tracking reads slack
                // across a wall.
                letterSpacing: '-0.02em',
                // Centred, so held to a measure rather than a left edge —
                // a centred line running the full width loses its shape.
                maxWidth: 'calc(58 * var(--u))',
                marginInline: 'auto',
              }}
            >
              {northStar.title}
            </p>
          </div>
        )}

        {/* The slack lives here, so the board breathes at any aspect ratio
            instead of stretching the gaps between every row. */}
        <div className="flex-1" />

        {/* ——— quarter · this week · personal ——— */}
        <div
          className="grid shrink-0"
          style={{
            gridTemplateColumns: '1.25fr 0.85fr 0.9fr',
            gap: 'calc(5 * var(--u))',
          }}
        >
          <section className="min-w-0" style={{ maxWidth: 'calc(30 * var(--u))' }}>
            <Label>{period}</Label>
            <ul className="flex flex-col" style={{ gap: 'calc(2.1 * var(--u))' }}>
              {quarter.map((goal) => (
                <li key={goal.id}>
                  <div
                    className="flex items-baseline"
                    style={{ gap: 'calc(1.1 * var(--u))' }}
                  >
                    <span
                      aria-hidden
                      className="shrink-0 rounded-full"
                      style={{
                        width: 'calc(0.4 * var(--u))',
                        height: 'calc(0.4 * var(--u))',
                        background: statusColor[goal.status],
                        // Nudged up to sit optically on the baseline rather
                        // than hanging below it.
                        transform: 'translateY(calc(-0.28 * var(--u)))',
                      }}
                    />
                    <span
                      className="min-w-0 flex-1 text-white/90"
                      style={{ fontSize: 'calc(1.18 * var(--u))', lineHeight: 1.35 }}
                    >
                      {goal.title}
                    </span>
                    {goal.progress !== undefined && (
                      <span
                        className="shrink-0 font-mono tabular-nums text-[color:var(--dim)]"
                        style={{ fontSize: 'calc(0.8 * var(--u))' }}
                      >
                        {goal.progress}%
                      </span>
                    )}
                  </div>
                  {goal.progress !== undefined && (
                    <div
                      style={{
                        marginTop: 'calc(0.75 * var(--u))',
                        marginLeft: 'calc(1.5 * var(--u))',
                      }}
                    >
                      <Bar value={goal.progress} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* Counted, not typed. Each row's number comes from crm_events for
              the current week, so it cannot disagree with what the CRM
              recorded — and it resets on its own every Monday because the
              window moves, not because anything is cleared. */}
          {weekly.length > 0 && (
            <section className="min-w-0">
              <Label>Denna vecka</Label>
              <ul className="flex flex-col" style={{ gap: 'calc(2.1 * var(--u))' }}>
                {weekly.map((goal) => {
                  const actual = goal.metricKind
                    ? (weeklyCounts[goal.metricKind] ?? 0)
                    : (goal.progress ?? 0)
                  const target = goal.metricTarget
                  const hit = target !== undefined && actual >= target

                  return (
                    <li key={goal.id}>
                      <div
                        className="flex items-baseline"
                        style={{ gap: 'calc(1.1 * var(--u))' }}
                      >
                        <span
                          className="min-w-0 flex-1 text-white/90"
                          style={{ fontSize: 'calc(1.18 * var(--u))', lineHeight: 1.35 }}
                        >
                          {goal.title}
                        </span>
                        <span
                          className="shrink-0 font-mono tabular-nums"
                          style={{
                            fontSize: 'calc(0.95 * var(--u))',
                            // Green only once the week's number is met: the
                            // one thing worth spotting from across a room is
                            // which non-negotiables are still short.
                            color: hit ? statusColor.on_track : '#FFFFFF',
                          }}
                        >
                          {actual}
                          {target !== undefined && (
                            <span className="text-[color:var(--dim)]">/{target}</span>
                          )}
                        </span>
                      </div>
                      {target !== undefined && target > 0 && (
                        <div style={{ marginTop: 'calc(0.75 * var(--u))' }}>
                          <Bar value={(actual / target) * 100} />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {/* The private layer. Not Khyte's — this person's own life, on their
              own board and nobody else's. Same visual weight as the quarter
              column on purpose: it is not a footnote to the company's goals. */}
          <section className="min-w-0" style={{ maxWidth: 'calc(30 * var(--u))' }}>
            <Label>{person.name}</Label>
            <ul className="flex flex-col" style={{ gap: 'calc(2.1 * var(--u))' }}>
              {personal.map((goal) => {
                const until = goal.targetDate
                  ? untilLabel(goal.targetDate, now)
                  : undefined
                return (
                  <li key={goal.id}>
                    <div
                      className="flex items-baseline"
                      style={{ gap: 'calc(1.1 * var(--u))' }}
                    >
                      <span
                        aria-hidden
                        className="shrink-0 rounded-full"
                        style={{
                          width: 'calc(0.4 * var(--u))',
                          height: 'calc(0.4 * var(--u))',
                          background: goal.done ? statusColor.done : person.color,
                          transform: 'translateY(calc(-0.28 * var(--u)))',
                        }}
                      />
                      <span
                        className={
                          goal.done
                            ? 'min-w-0 flex-1 text-white/30 line-through decoration-white/20'
                            : 'min-w-0 flex-1 text-white/90'
                        }
                        style={{ fontSize: 'calc(1.18 * var(--u))', lineHeight: 1.35 }}
                      >
                        {goal.title}
                      </span>
                      {/* A deadline, and nothing else. No percentage and no
                          bar: these are here to be looked at and wanted, not
                          measured — a half-filled rule under "flytta ut i
                          december" turns a private ambition into another
                          progress report. The countdown stays because a date
                          is part of the wanting. */}
                      {until && !goal.done && (
                        <span
                          className="shrink-0 font-mono tabular-nums text-[color:var(--dim)]"
                          style={{ fontSize: 'calc(0.8 * var(--u))' }}
                        >
                          {until}
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        </div>

        <div
          aria-hidden
          className="shrink-0 bg-white/8"
          style={{ height: '1px', margin: 'calc(4.5 * var(--u)) 0' }}
        />

        {/* ——— scoreboard: the numbers, given room to be big ——— */}
        <div
          className="grid shrink-0"
          style={{
            gridTemplateColumns: `repeat(${Math.max(scoreboard.length, 1)}, minmax(0, 1fr))`,
            gap: 'calc(6 * var(--u))',
          }}
        >
          {scoreboard.map((metric) => {
            const pct =
              metric.targetValue && metric.targetValue > 0
                ? Math.round((metric.currentValue / metric.targetValue) * 100)
                : undefined
            return (
              <div key={metric.id}>
                <p
                  className="font-mono uppercase text-[color:var(--dim)]"
                  style={{ fontSize: 'calc(0.62 * var(--u))', letterSpacing: '0.26em' }}
                >
                  {metric.label}
                </p>
                <p
                  className="font-jakarta font-semibold tabular-nums text-white"
                  style={{
                    fontSize: 'calc(2.9 * var(--u))',
                    marginTop: 'calc(0.7 * var(--u))',
                    lineHeight: 1,
                  }}
                >
                  {formatMetric(metric.currentValue, metric.unit)}
                  {metric.targetValue !== undefined && (
                    <span
                      className="font-mono font-normal text-[color:var(--dim)]"
                      style={{
                        fontSize: 'calc(0.95 * var(--u))',
                        marginLeft: 'calc(0.6 * var(--u))',
                      }}
                    >
                      / {formatMetric(metric.targetValue, metric.unit)}
                    </span>
                  )}
                </p>
                {pct !== undefined && (
                  // Fixed track rather than the full grid cell: the columns are
                  // sized by their labels, so a full-width bar would make 18%
                  // under a short label longer than 33% under a long one — the
                  // one comparison a scoreboard has to get right.
                  <div style={{ marginTop: 'calc(1.1 * var(--u))', width: 'calc(13 * var(--u))' }}>
                    <Bar value={pct} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
