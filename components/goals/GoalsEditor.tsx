'use client'

import { useCallback, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/crm/Button'
import { inputClass } from '@/components/crm/FormFields'
import { COLLEAGUE_IDS, colleagues } from '@/lib/colleagues'
import { measureGoal } from '@/lib/goal-measure'
import { useCRMStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type {
  ActionScope,
  ColleagueId,
  CrmEventKind,
  PersonalGoal,
  Goal,
  GoalMetric,
  GoalSection,
  GoalStatus,
  GoalsSnapshot,
  MetricUnit,
} from '@/lib/types'
import * as api from '@/app/actions/goals'

/**
 * The editable workspace behind the wallpaper.
 *
 * Structured, not a canvas. Every row belongs to a named section and the
 * wallpaper knows where each section is drawn, which is what lets the board
 * stay beautiful without anyone laying it out by hand. The deliberate cost is
 * that you cannot put an arbitrary sticky note in an arbitrary place — that
 * would mean building a design tool in here, and the output would stop being
 * dependable.
 *
 * State is local rather than in the CRM store. Goals are read by loadGoals(),
 * not loadSnapshot(), so there is no goals slice in that store to update — and
 * keeping them out of it is what stops the wallpaper's refresh from dragging
 * the whole pipeline through Postgres. See lib/db/queries.ts.
 *
 * Writes are optimistic and per-edit, same contract as the CRM store: apply
 * locally, fire the action, surface a failure rather than rolling back. There
 * is no Save button because there is no pending state to flush — a field
 * commits when it loses focus.
 *
 * Every write declares the identity it believes it is acting as, which is the
 * one thing this editor does take from the CRM store. The rows are local, but
 * the workspace is not something this page can know on its own — and a tab
 * whose cookie changed underneath it must not commit a half-typed goal into
 * the organization of whoever signed in second. See app/actions/goals.ts.
 */

const SECTION_LABELS: Record<GoalSection, string> = {
  north_star: 'Nordstjärna',
  goal: 'Mål',
  weekly: 'Veckans icke-förhandlingsbara',
  principle: 'Principer',
  not_now: 'Inte nu',
}

const SECTION_HINTS: Record<GoalSection, string> = {
  north_star:
    'Valfri. Står under loggan på tavlan, max tre rader — längre text kapas.',
  goal:
    'Årsmål och kvartalsmål i ett — sätt ett datum så hamnar målet rätt på /goals/timeline. Nu och Mål ger målet en stapel ("1 av 3"); utan mål ritas ingen. De tre närmast i tid ritas på tavlan, resten sparas men syns bara i tidslinjen.',
  weekly:
    'Räknas från aktivitet i Leads och Prospekt — kan inte skrivas in för hand. Veckan börjar om på måndagen och den gamla arkiveras.',
  principle: 'Hur ni arbetar. Sparas här — ritas inte på tavlan.',
  not_now: 'Medvetet bortvalt. Sparas här — ritas inte på tavlan.',
}

const STATUS_LABELS: Record<GoalStatus, string> = {
  on_track: 'På spår',
  at_risk: 'Risk',
  off_track: 'Ur spår',
  done: 'Klart',
}

/** What each countable CRM action is called on screen. */
const METRIC_KIND_LABELS: Record<CrmEventKind, string> = {
  meeting_booked: 'Möten bokade',
  prospect_contacted: 'Prospekt kontaktade',
  lead_added: 'Leads tillagda',
  deal_won: 'Affärer vunna',
}

/**
 * The scoreboard's three rows, in the order the board draws them.
 *
 * These are fixed rather than user-added: DisplayBoard computes each figure
 * from the pipeline and matches its target by label, so a fourth invented row
 * would have no number behind it and never appear. The labels are the join
 * key between the two files — changing one means changing both.
 */
const SCOREBOARD_ROWS = [
  {
    key: 'revenue' as const,
    label: 'Intäkt',
    unit: 'currency' as const,
    source: 'Summan av affärer i steget Won.',
  },
  {
    key: 'pipeline' as const,
    label: 'Pipeline',
    unit: 'currency' as const,
    source: 'Summan av öppna affärer på tavlan — varken Won eller Lost.',
  },
  {
    key: 'customers' as const,
    label: 'Kunder',
    unit: 'number' as const,
    source: 'Antal affärer i steget Won.',
  },
]

/**
 * Formats a derived figure exactly as the wallpaper does.
 *
 * Deliberately NOT useFormat: that converts out of a base currency into the
 * user's display currency, which rendered 467 000 SEK as "49 tn US$" before
 * localStorage hydrated. These figures come straight from the pipeline in the
 * currency the deals are stored in, and DisplayBoard prints them with a fixed
 * sv-SE locale — the editor has to agree with the board about the same number.
 */
function formatDerived(value: number, unit: MetricUnit): string {
  const formatted = new Intl.NumberFormat('sv-SE').format(value)
  return unit === 'currency' ? `${formatted} kr` : formatted
}

/**
 * Sections whose rows carry a number. A principle is not something you are
 * 40% of the way through, so it gets a title and nothing else.
 */
const MEASURED_SECTIONS: GoalSection[] = ['goal']

function SectionShell({
  title,
  hint,
  children,
  onAdd,
  addLabel,
}: {
  title: string
  hint: string
  children: React.ReactNode
  onAdd?: () => void
  addLabel?: string
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="label-mono mb-1">{title}</h3>
          <p className="text-[13px] leading-snug text-foreground/55">{hint}</p>
        </div>
        {onAdd && (
          <Button variant="secondary" size="sm" onClick={onAdd} className="shrink-0">
            <Plus size={14} />
            {addLabel}
          </Button>
        )}
      </div>
      {children}
    </section>
  )
}

/** Delete control shared by every row type. */
function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground/40',
        'transition-colors hover:bg-danger-muted hover:text-danger'
      )}
    >
      <Trash2 size={15} />
    </button>
  )
}

/**
 * A labelled whole-number field for one half of an "X of Y" pair.
 *
 * Empty is not zero, and keeping them apart is the whole job: an empty field
 * means "no number here", which draws no bar, while a typed 0 means "measured,
 * nothing yet", which draws an empty one. Both reach the DB differently — see
 * the `in` treatment in toGoalUpdate.
 *
 * Draft on change, commit on blur, exactly like every other field on this page:
 * one write per edit rather than one per keystroke.
 */
function NumberField({
  label,
  value,
  placeholder,
  onDraft,
  onCommit,
}: {
  label: string
  value: number | undefined
  placeholder?: string
  onDraft: (value: number | undefined) => void
  onCommit: (value: number | undefined) => void
}) {
  const read = (raw: string) => (raw === '' ? undefined : Number(raw))

  return (
    <label className="flex items-center gap-2">
      <span className="label-mono">{label}</span>
      <input
        type="number"
        min={0}
        className={cn(inputClass, 'h-9 w-24 text-[14px] tabular-nums')}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onDraft(read(e.target.value))}
        // Floored on commit rather than trusting the input's `min`, which
        // browsers do not enforce on a typed value.
        onBlur={(e) => {
          const next = read(e.target.value)
          onCommit(next === undefined ? undefined : Math.max(0, next || 0))
        }}
      />
    </label>
  )
}

export function GoalsEditor({ initial }: { initial: GoalsSnapshot }) {
  // The live figures, so the editor shows the same numbers as the wallpaper
  // rather than a stale stored value the board no longer reads.
  //
  // Read straight from props on every render, deliberately, while the editable
  // rows below are seeded into useState once. That split is what makes
  // GoalsSync work: `router.refresh()` re-runs the server component and these
  // two update, while a half-typed goal title in state is left untouched.
  const derived = initial.totals
  const counts = initial.weeklyCounts

  // From the CRM store, which /goals sits inside — the root layout wraps every
  // authed page in AppShell, and AppShell is the CRMStoreProvider. Nothing
  // else here reads that store; this is the identity the writes below declare,
  // and the server refuses any that disagrees with the session it receives.
  const workspace = useCRMStore((s) => s.workspace)
  const scope: ActionScope = {
    organizationId: workspace.organization.id,
    userId: workspace.viewer.userId,
  }

  const [goals, setGoals] = useState<Goal[]>(initial.goals)
  const [metrics, setMetrics] = useState<GoalMetric[]>(initial.metrics)
  const [personalGoals, setPersonalGoals] = useState<PersonalGoal[]>(initial.personalGoals)
  const [error, setError] = useState<string | null>(null)

  /**
   * Fires a write and keeps the first failure on screen.
   *
   * Not awaited by callers: the local state is already updated, so blocking the
   * interaction on the round-trip would only make typing feel slow.
   */
  const persist = useCallback((run: () => Promise<api.ActionResult>) => {
    void run().then((result) => {
      if (result.ok) return
      // The server answered as someone else: the session this tab was built
      // on is gone and another has replaced it (another tab logged in). The
      // write was refused before it touched anything; a banner would leave a
      // stale editor on screen for the wrong person, so reload — the same
      // move SnapshotSync makes for the CRM store.
      if (result.error === 'context_mismatch') {
        window.location.reload()
        return
      }
      setError(result.error)
    })
  }, [])

  // --- goals ---------------------------------------------------------------

  const addGoal = (section: GoalSection) => {
    const siblings = goals.filter((g) => g.section === section)
    const goal: Goal = {
      id: crypto.randomUUID(),
      section,
      title: '',
      detail: '',
      status: 'on_track',
      // No measurement to begin with, deliberately: a goal nobody has put a
      // number on draws no bar, and an empty "Mål" field is the prompt to put
      // one there. Seeding 0 would have drawn a full-width empty bar instead,
      // which reads as "measured, at zero".
      // A weekly row is counted, never typed, so it is born bound to an event
      // kind — an unbound one would show a number that never moves.
      ...(section === 'weekly'
        ? { metricKind: 'meeting_booked' as const, metricTarget: 5 }
        : {}),
      order: siblings.length,
    }
    setGoals((prev) => [...prev, goal])
    persist(() => api.createGoal(goal, scope))
  }

  const editGoal = (id: string, updates: Partial<Goal>) => {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...updates } : g)))
    persist(() => api.updateGoal(id, updates, scope))
  }

  const removeGoal = (id: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== id))
    persist(() => api.deleteGoal(id, scope))
  }

  // --- metrics -------------------------------------------------------------

  // No add/remove here. The scoreboard's rows are fixed (SCOREBOARD_ROWS) —
  // a row is created lazily the first time someone types a target into it, and
  // there is nothing to delete because the row is the target.
  const editMetric = (id: string, updates: Partial<GoalMetric>) => {
    setMetrics((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)))
    persist(() => api.updateGoalMetric(id, updates, scope))
  }

  // --- focus ---------------------------------------------------------------

  const addPersonalGoal = (colleague: ColleagueId) => {
    const siblings = personalGoals.filter((f) => f.colleague === colleague)
    const item: PersonalGoal = {
      id: crypto.randomUUID(),
      colleague,
      title: '',
      done: false,
      order: siblings.length,
    }
    setPersonalGoals((prev) => [...prev, item])
    persist(() => api.createPersonalGoal(item, scope))
  }

  const editPersonalGoal = (id: string, updates: Partial<PersonalGoal>) => {
    setPersonalGoals((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)))
    persist(() => api.updatePersonalGoal(id, updates, scope))
  }

  const removePersonalGoal = (id: string) => {
    setPersonalGoals((prev) => prev.filter((f) => f.id !== id))
    persist(() => api.deletePersonalGoal(id, scope))
  }

  // --- rendering -----------------------------------------------------------

  const inSection = (section: GoalSection) =>
    goals.filter((g) => g.section === section).sort((a, b) => a.order - b.order)

  const renderGoalRows = (section: GoalSection) => {
    const rows = inSection(section)
    const isMeasuredSection = MEASURED_SECTIONS.includes(section)

    if (rows.length === 0) {
      return (
        <p className="py-2 text-[13.5px] text-foreground/40">Inget här ännu.</p>
      )
    }

    return (
      <ul className="flex flex-col gap-3">
        {rows.map((goal) => (
          <li key={goal.id} className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <input
                className={inputClass}
                value={goal.title}
                placeholder="Vad ska uppnås?"
                onChange={(e) =>
                  setGoals((prev) =>
                    prev.map((g) =>
                      g.id === goal.id ? { ...g, title: e.target.value } : g
                    )
                  )
                }
                // Committed on blur rather than on every keystroke — one write
                // per edit instead of one per character.
                onBlur={(e) => editGoal(goal.id, { title: e.target.value })}
              />

              {isMeasuredSection && (
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2">
                    <span className="label-mono">Status</span>
                    <select
                      className={cn(inputClass, 'h-9 w-auto py-0 text-[14px]')}
                      value={goal.status}
                      onChange={(e) =>
                        editGoal(goal.id, { status: e.target.value as GoalStatus })
                      }
                    >
                      {(Object.keys(STATUS_LABELS) as GoalStatus[]).map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* "X av Y", the same pair the weekly rows show — the only
                      difference is that nothing counts these for you, so the
                      left-hand number is typed. It is still a count rather
                      than an estimate: "1 av 3 bolag" is checkable in a way
                      "33 %" never was. */}
                  <NumberField
                    label="Nu"
                    value={goal.metricCurrent}
                    placeholder="—"
                    onDraft={(next) =>
                      setGoals((prev) =>
                        prev.map((g) =>
                          g.id === goal.id ? { ...g, metricCurrent: next } : g
                        )
                      )
                    }
                    onCommit={(next) => editGoal(goal.id, { metricCurrent: next })}
                  />

                  <NumberField
                    label="Mål"
                    value={goal.metricTarget}
                    placeholder="—"
                    onDraft={(next) =>
                      setGoals((prev) =>
                        prev.map((g) =>
                          g.id === goal.id ? { ...g, metricTarget: next } : g
                        )
                      )
                    }
                    onCommit={(next) => editGoal(goal.id, { metricTarget: next })}
                  />

                  {/* Deadline, not a picked cadence — the timeline derives
                      "Q3 2026" / "Vecka 35" / etc. from this rather than the
                      goal being typed into a quarter-shaped box to begin
                      with. See lib/goal-period.ts. */}
                  <label className="flex items-center gap-2">
                    <span className="label-mono">Datum</span>
                    <input
                      type="date"
                      className={cn(inputClass, 'h-9 w-auto text-[14px]')}
                      value={goal.targetDate ?? ''}
                      onChange={(e) =>
                        editGoal(goal.id, {
                          targetDate: e.target.value || undefined,
                        })
                      }
                    />
                  </label>
                </div>
              )}

              {/* The retired percentage, shown only while this goal has no
                  target yet. It is the one record of what anyone thought at
                  the time and it would otherwise vanish silently the moment
                  the bar stopped being drawn from it — so it stays visible
                  exactly where someone can translate it into a real Nu/Mål,
                  and disappears as soon as they do. The column is kept, not
                  dropped: see 20260915120000_goal_metric_current.sql. */}
              {isMeasuredSection &&
                goal.progress !== undefined &&
                goal.metricTarget === undefined && (
                  <p className="text-[12.5px] text-foreground/40">
                    Tidigare uppskattning: {goal.progress} %. Sätt ett mål för att
                    mäta på riktigt.
                  </p>
                )}
            </div>
            <RemoveButton onClick={() => removeGoal(goal.id)} label="Ta bort" />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger-muted px-4 py-3 text-[14px] text-danger">
          Kunde inte spara: {error}
        </div>
      )}

      {/* North star takes one row; a second would have nowhere to go on the
          board, so the add button disappears once there is one. */}
      <SectionShell
        title={SECTION_LABELS.north_star}
        hint={SECTION_HINTS.north_star}
        addLabel="Lägg till"
        onAdd={
          inSection('north_star').length === 0
            ? () => addGoal('north_star')
            : undefined
        }
      >
        {renderGoalRows('north_star')}
      </SectionShell>

      <SectionShell
        title={SECTION_LABELS.goal}
        hint={SECTION_HINTS.goal}
        addLabel="Lägg till"
        onAdd={() => addGoal('goal')}
      >
        {renderGoalRows('goal')}
      </SectionShell>

      {/* --- weekly non-negotiables: counted, not typed --- */}
      <SectionShell
        title={SECTION_LABELS.weekly}
        hint={SECTION_HINTS.weekly}
        addLabel="Lägg till"
        onAdd={() => addGoal('weekly')}
      >
        {inSection('weekly').length === 0 ? (
          <p className="py-2 text-[13.5px] text-foreground/40">Inget här ännu.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {inSection('weekly').map((goal) => {
              // Counted, not typed — resolved by the one helper the wallpaper
              // and the timeline also use, so no two surfaces can disagree
              // about the same goal. See lib/goal-measure.ts.
              const { current, hit } = measureGoal(goal, counts)

              return (
                <li key={goal.id} className="flex items-start gap-2">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                    <input
                      className={inputClass}
                      value={goal.title}
                      placeholder="T.ex. Möten bokade"
                      onChange={(e) =>
                        setGoals((prev) =>
                          prev.map((g) =>
                            g.id === goal.id ? { ...g, title: e.target.value } : g
                          )
                        )
                      }
                      onBlur={(e) => editGoal(goal.id, { title: e.target.value })}
                    />
                    <select
                      className={cn(inputClass, 'sm:w-52')}
                      value={goal.metricKind ?? 'meeting_booked'}
                      onChange={(e) =>
                        editGoal(goal.id, { metricKind: e.target.value as CrmEventKind })
                      }
                    >
                      {(Object.keys(METRIC_KIND_LABELS) as CrmEventKind[]).map((kind) => (
                        <option key={kind} value={kind}>
                          {METRIC_KIND_LABELS[kind]}
                        </option>
                      ))}
                    </select>
                    {/* Read-only: this is what the CRM recorded this week.
                        Showing it as an input would invite edits that nothing
                        stores — the number comes from crm_events, not from a
                        column. Green once the target is met, the same single
                        signal the wallpaper uses. */}
                    <div className="flex items-center justify-end gap-2 sm:w-20">
                      <span className="label-mono">Nu</span>
                      <span
                        className={cn(
                          'font-mono text-[15px] tabular-nums',
                          hit ? 'text-success' : 'text-foreground'
                        )}
                      >
                        {current}
                      </span>
                    </div>
                    <input
                      type="number"
                      min={0}
                      className={cn(inputClass, 'sm:w-24', 'tabular-nums')}
                      value={goal.metricTarget ?? ''}
                      placeholder="Mål"
                      onChange={(e) =>
                        setGoals((prev) =>
                          prev.map((g) =>
                            g.id === goal.id
                              ? {
                                  ...g,
                                  metricTarget:
                                    e.target.value === ''
                                      ? undefined
                                      : Number(e.target.value),
                                }
                              : g
                          )
                        )
                      }
                      onBlur={(e) =>
                        editGoal(goal.id, {
                          metricTarget:
                            e.target.value === ''
                              ? undefined
                              : Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                    />
                  </div>
                  <RemoveButton onClick={() => removeGoal(goal.id)} label="Ta bort" />
                </li>
              )
            })}
          </ul>
        )}
      </SectionShell>

      {/* --- scoreboard --- */}
      {/* --- scoreboard: targets only, actuals come from the CRM --- */}
      <SectionShell
        title="Resultattavla"
        hint="Siffrorna räknas ut från affärerna i pipelinen — bara målet sätts här. Raderna Intäkt, Pipeline och Kunder visas på tavlan."
      >
        <ul className="flex flex-col gap-3">
          {SCOREBOARD_ROWS.map((row) => {
            // Matched by label, the same way DisplayBoard resolves its targets.
            const metric = metrics.find(
              (m) => m.label.toLowerCase() === row.label.toLowerCase()
            )
            const actual = derived[row.key]

            return (
              <li key={row.key} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-medium text-foreground">{row.label}</p>
                  <p className="text-[13px] text-foreground/50">{row.source}</p>
                </div>

                {/* Read-only: this is what the CRM says right now. Showing it
                    as an input would invite edits the board would discard. */}
                <div className="shrink-0 text-right">
                  <p className="label-mono mb-1">Nu</p>
                  <p className="font-mono text-[15px] tabular-nums text-foreground">
                    {formatDerived(actual, row.unit)}
                  </p>
                </div>

                <div className="shrink-0">
                  <p className="label-mono mb-1">Mål</p>
                  <input
                    type="number"
                    min={0}
                    className={cn(inputClass, 'h-9 w-32 text-[14px] tabular-nums')}
                    value={metric?.targetValue ?? ''}
                    placeholder="—"
                    // The row is created on the FIRST keystroke, not on blur.
                    // It was the other way round, which made this field
                    // impossible to type into on any database where
                    // `goal_metrics` was still empty — every fresh one, since
                    // nothing else creates these rows. `value` is bound to
                    // `metric?.targetValue`, so with no row this is a
                    // controlled input pinned to '' whose onChange did
                    // nothing; React restored '' after each keypress and the
                    // blur handler that would have created the row only ever
                    // saw an empty string. No target could be set at all, so
                    // the board drew bare numbers with no bar.
                    onChange={(e) => {
                      const next =
                        e.target.value === '' ? undefined : Number(e.target.value)

                      if (metric) {
                        setMetrics((prev) =>
                          prev.map((m) =>
                            m.id === metric.id ? { ...m, targetValue: next } : m
                          )
                        )
                        return
                      }

                      // Nothing to hold the value yet. Clearing an already
                      // empty field is not worth a row.
                      if (next === undefined) return

                      // The label is what DisplayBoard matches on, so it has
                      // to be exactly this string.
                      const created: GoalMetric = {
                        id: crypto.randomUUID(),
                        label: row.label,
                        currentValue: 0,
                        targetValue: next,
                        unit: row.unit,
                        order: metrics.length,
                      }
                      setMetrics((prev) => [...prev, created])
                      persist(() => api.createGoalMetric(created, scope))
                    }}
                    onBlur={(e) => {
                      // `metric` is resolved fresh on the render that follows
                      // the create above, so by the time focus leaves there is
                      // always a row to update.
                      if (!metric) return
                      const next =
                        e.target.value === '' ? undefined : Number(e.target.value)
                      // Empty means "no target", which must reach the DB as
                      // null — 0 would draw an empty bar instead of none.
                      editMetric(metric.id, { targetValue: next })
                    }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </SectionShell>

      {/* --- the personal layer, one block per colleague --- */}
      <div className="grid gap-4 lg:grid-cols-3">
        {COLLEAGUE_IDS.map((id) => {
          const person = colleagues[id]
          const items = personalGoals
            .filter((f) => f.colleague === id)
            .sort((a, b) => a.order - b.order)

          return (
            <SectionShell
              key={id}
              title={person.name}
              hint="Egna mål. Syns bara på den här personens tavla — inte Khytes."
              addLabel="Lägg till"
              onAdd={() => addPersonalGoal(id)}
            >
              {items.length === 0 ? (
                <p className="py-2 text-[13.5px] text-foreground/40">Inget här ännu.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={(e) => editPersonalGoal(item.id, { done: e.target.checked })}
                        aria-label="Klar"
                        className="mt-3 h-4 w-4 shrink-0 accent-[var(--accent)]"
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <input
                          className={cn(inputClass, item.done && 'text-foreground/45 line-through')}
                          value={item.title}
                          placeholder="T.ex. Flytta ut i december"
                          onChange={(e) =>
                            setPersonalGoals((prev) =>
                              prev.map((f) =>
                                f.id === item.id ? { ...f, title: e.target.value } : f
                              )
                            )
                          }
                          onBlur={(e) => editPersonalGoal(item.id, { title: e.target.value })}
                        />
                        {/* Only a date. Personal goals are motivation, not
                            tracking — the board deliberately shows no bar for
                            them, so offering a percentage here would promise
                            something that never appears. */}
                        <label className="flex items-center gap-2">
                          <span className="label-mono">Datum</span>
                          <input
                            type="date"
                            className={cn(inputClass, 'h-9 w-auto text-[14px]')}
                            value={item.targetDate ?? ''}
                            onChange={(e) =>
                              editPersonalGoal(item.id, {
                                // Empty clears the deadline; the mapper turns
                                // undefined into a null column write.
                                targetDate: e.target.value || undefined,
                              })
                            }
                          />
                        </label>
                      </div>
                      <RemoveButton onClick={() => removePersonalGoal(item.id)} label="Ta bort" />
                    </li>
                  ))}
                </ul>
              )}
            </SectionShell>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionShell
          title={SECTION_LABELS.principle}
          hint={SECTION_HINTS.principle}
          addLabel="Lägg till"
          onAdd={() => addGoal('principle')}
        >
          {renderGoalRows('principle')}
        </SectionShell>

        <SectionShell
          title={SECTION_LABELS.not_now}
          hint={SECTION_HINTS.not_now}
          addLabel="Lägg till"
          onAdd={() => addGoal('not_now')}
        >
          {renderGoalRows('not_now')}
        </SectionShell>
      </div>
    </div>
  )
}
