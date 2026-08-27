import type { ColleagueId, FocusItem, Goal, GoalMetric, GoalStatus } from '@/lib/types'
import { colleagues } from '@/lib/colleagues'
import { cn } from '@/lib/utils'

/**
 * The wallpaper. A fixed 16:9 board, no chrome, no controls, no interactivity.
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
 * Sized in `cqw` units against a container query rather than `vw`, so the
 * board scales as one piece to whatever resolution Lively hands it: a 4K
 * monitor gets the same composition as a 1080p one, just larger. Nothing here
 * wraps responsively — a wallpaper has exactly one shape.
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
 * Swedish formatting, fixed rather than read from settings.
 *
 * `sv-SE` uses non-breaking spaces as the thousands separator, which is
 * correct but renders as a visible gap at wallpaper scale; normalised to a
 * thin space so large sums stay tight.
 */
function formatNumber(value: number): string {
  return new Intl.NumberFormat('sv-SE').format(value).replace(/ /g, ' ')
}

function formatMetric(value: number, unit: GoalMetric['unit']): string {
  if (unit === 'percent') return `${formatNumber(value)}%`
  if (unit !== 'currency') return formatNumber(value)
  // Sums on a board are read at a glance from across a room — 182k carries
  // the same meaning as 182 000 and leaves room for the target beside it.
  if (Math.abs(value) >= 1_000_000) {
    return `${formatNumber(Math.round(value / 100_000) / 10)}M`
  }
  if (Math.abs(value) >= 10_000) {
    return `${formatNumber(Math.round(value / 1000))}k`
  }
  return formatNumber(value)
}

function Section({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('flex min-h-0 flex-col', className)}>
      <h2
        className="mb-[1.1cqw] shrink-0 font-mono uppercase text-[color:var(--board-dim)]"
        style={{ fontSize: '0.82cqw', letterSpacing: '0.22em' }}
      >
        {label}
      </h2>
      {children}
    </section>
  )
}

/** The thin rule under a progress figure. Rendered for `progress === 0` too —
 *  an empty bar is a statement; a missing bar means "not measured". */
function ProgressBar({ value }: { value: number }) {
  return (
    <div
      className="w-full overflow-hidden rounded-full bg-white/8"
      style={{ height: '0.22cqw' }}
    >
      <div
        className="h-full rounded-full bg-[color:var(--board-accent)]"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

export interface DisplayBoardProps {
  colleague: ColleagueId
  goals: Goal[]
  metrics: GoalMetric[]
  focusItems: FocusItem[]
  /** Rendered in the header — the quarter/period label, e.g. "Q3 2026". */
  period: string
}

export function DisplayBoard({
  colleague,
  goals,
  metrics,
  focusItems,
  period,
}: DisplayBoardProps) {
  const bySection = (section: Goal['section']) =>
    goals.filter((g) => g.section === section).sort((a, b) => a.order - b.order)

  const northStar = bySection('north_star')[0]
  const annual = bySection('annual')
  const quarter = bySection('quarter')
  const principles = bySection('principle')
  const notNow = bySection('not_now')

  const person = colleagues[colleague]
  const focus = focusItems
    .filter((f) => f.colleague === colleague)
    .sort((a, b) => a.order - b.order)

  return (
    <div
      data-theme="dark"
      className="board-surface relative aspect-video w-full overflow-hidden"
      style={
        {
          containerType: 'inline-size',
          '--board-accent': '#D4943C',
          '--board-dim': 'rgba(255,255,255,0.42)',
        } as React.CSSProperties
      }
    >
      {/* Warm light from the top-left, the same gesture as .grain-card but at
          wall scale — keeps a very dark board from reading as flat black. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 8% -10%, rgba(138,59,14,0.30) 0%, transparent 58%),' +
            'radial-gradient(80% 70% at 100% 110%, rgba(138,59,14,0.16) 0%, transparent 55%)',
        }}
      />

      <div
        className="relative flex h-full flex-col"
        style={{ padding: '4.4cqw 5cqw' }}
      >
        {/* ——— header ——— */}
        <header className="flex shrink-0 items-baseline justify-between">
          <span
            className="font-jakarta font-semibold text-white"
            style={{ fontSize: '1.45cqw', letterSpacing: '0.16em' }}
          >
            KHYTE
          </span>
          <span
            className="font-mono uppercase text-[color:var(--board-dim)]"
            style={{ fontSize: '0.82cqw', letterSpacing: '0.22em' }}
          >
            {period}
          </span>
        </header>

        {/* ——— north star ——— */}
        {northStar && (
          <div className="shrink-0" style={{ marginTop: '3.4cqw' }}>
            <h2
              className="mb-[1.1cqw] font-mono uppercase text-[color:var(--board-dim)]"
              style={{ fontSize: '0.82cqw', letterSpacing: '0.22em' }}
            >
              Nordstjärna
            </h2>
            <p
              className="font-display leading-[1.12] text-white"
              style={{ fontSize: '3.15cqw' }}
            >
              {northStar.title}
            </p>
            {northStar.detail && (
              <p
                className="text-[color:var(--board-dim)]"
                style={{ fontSize: '1cqw', marginTop: '0.9cqw' }}
              >
                {northStar.detail}
              </p>
            )}
          </div>
        )}

        <div
          aria-hidden
          className="shrink-0 bg-white/10"
          style={{ height: '1px', margin: '3.2cqw 0' }}
        />

        {/* ——— the three columns: year · quarter · person ——— */}
        <div
          className="grid min-h-0 flex-1"
          style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: '4.2cqw' }}
        >
          <Section label="2026">
            <ul className="flex flex-col" style={{ gap: '1.5cqw' }}>
              {annual.map((goal) => (
                <li key={goal.id}>
                  <div
                    className="flex items-baseline justify-between"
                    style={{ gap: '1cqw' }}
                  >
                    <span
                      className="leading-snug text-white/92"
                      style={{ fontSize: '1.08cqw' }}
                    >
                      {goal.title}
                    </span>
                    {goal.progress !== undefined && (
                      <span
                        className="shrink-0 font-mono tabular-nums text-[color:var(--board-dim)]"
                        style={{ fontSize: '0.9cqw' }}
                      >
                        {goal.progress}%
                      </span>
                    )}
                  </div>
                  {goal.progress !== undefined && (
                    <div style={{ marginTop: '0.7cqw' }}>
                      <ProgressBar value={goal.progress} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Section>

          <Section label="Detta kvartal">
            <ol className="flex flex-col" style={{ gap: '1.5cqw' }}>
              {quarter.map((goal, index) => (
                <li key={goal.id} className="flex" style={{ gap: '1.1cqw' }}>
                  <span
                    className="shrink-0 font-mono tabular-nums text-[color:var(--board-accent)]"
                    style={{ fontSize: '0.9cqw', paddingTop: '0.15cqw' }}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* The status dot rides in the text flow rather than as a
                        flex sibling, so on a title that wraps it follows the
                        last word instead of stranding itself at the column's
                        right edge a line above. */}
                    <p
                      className="leading-snug text-white/92"
                      style={{ fontSize: '1.08cqw' }}
                    >
                      {goal.title}
                      <span
                        aria-hidden
                        className="ml-[0.8cqw] inline-block rounded-full align-middle"
                        style={{
                          width: '0.42cqw',
                          height: '0.42cqw',
                          background: statusColor[goal.status],
                        }}
                      />
                    </p>
                    {goal.progress !== undefined && (
                      <div style={{ marginTop: '0.7cqw' }}>
                        <ProgressBar value={goal.progress} />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          {/* The personal layer — the only region that differs between the
              boards. Everything left of here is identical for the whole team. */}
          <Section label={`${person.name} — denna vecka`}>
            <ul className="flex flex-col" style={{ gap: '1.35cqw' }}>
              {focus.map((item) => (
                <li
                  key={item.id}
                  className="flex items-baseline"
                  style={{ gap: '1cqw' }}
                >
                  <span
                    aria-hidden
                    className="shrink-0 rounded-full"
                    style={{
                      width: '0.42cqw',
                      height: '0.42cqw',
                      marginTop: '0.42cqw',
                      background: item.done ? statusColor.done : person.color,
                    }}
                  />
                  <span
                    className={cn(
                      'leading-snug',
                      item.done
                        ? 'text-white/35 line-through decoration-white/25'
                        : 'text-white/92'
                    )}
                    style={{ fontSize: '1.08cqw' }}
                  >
                    {item.title}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <div
          aria-hidden
          className="shrink-0 bg-white/10"
          style={{ height: '1px', margin: '3.2cqw 0' }}
        />

        {/* ——— scoreboard ——— */}
        <div
          className="grid shrink-0"
          style={{
            gridTemplateColumns: `repeat(${Math.max(metrics.length, 1)}, minmax(0, 1fr))`,
            gap: '3.2cqw',
          }}
        >
          {metrics
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((metric) => {
              const pct =
                metric.targetValue && metric.targetValue > 0
                  ? Math.round((metric.currentValue / metric.targetValue) * 100)
                  : undefined
              return (
                <div key={metric.id}>
                  <p
                    className="font-mono uppercase text-[color:var(--board-dim)]"
                    style={{ fontSize: '0.72cqw', letterSpacing: '0.2em' }}
                  >
                    {metric.label}
                  </p>
                  <p
                    className="font-jakarta font-semibold tabular-nums text-white"
                    style={{ fontSize: '2.35cqw', marginTop: '0.55cqw', lineHeight: 1 }}
                  >
                    {formatMetric(metric.currentValue, metric.unit)}
                    {metric.targetValue !== undefined && (
                      <span
                        className="font-mono font-normal text-[color:var(--board-dim)]"
                        style={{ fontSize: '1cqw', marginLeft: '0.55cqw' }}
                      >
                        / {formatMetric(metric.targetValue, metric.unit)}
                      </span>
                    )}
                  </p>
                  {pct !== undefined && (
                    // Fixed track width rather than the full grid cell. The
                    // columns are sized by their labels, so a full-width bar
                    // made 18% under a short label longer than 33% under a
                    // long one — the one comparison a scoreboard has to get
                    // right.
                    <div style={{ marginTop: '0.9cqw', width: '11cqw' }}>
                      <ProgressBar value={pct} />
                    </div>
                  )}
                </div>
              )
            })}
        </div>

        {/* ——— footer: principles and what we are not doing ——— */}
        {(principles.length > 0 || notNow.length > 0) && (
          <footer
            className="flex shrink-0 items-baseline justify-between"
            style={{ marginTop: '3.2cqw', gap: '4cqw' }}
          >
            {principles.length > 0 && (
              <p
                className="font-display italic text-white/70"
                style={{ fontSize: '1.15cqw' }}
              >
                {principles.map((p) => p.title).join('   ·   ')}
              </p>
            )}
            {notNow.length > 0 && (
              <p
                className="shrink-0 text-right font-mono uppercase text-white/28"
                style={{ fontSize: '0.72cqw', letterSpacing: '0.18em' }}
              >
                Inte nu: {notNow.map((n) => n.title).join(' · ')}
              </p>
            )}
          </footer>
        )}
      </div>
    </div>
  )
}
