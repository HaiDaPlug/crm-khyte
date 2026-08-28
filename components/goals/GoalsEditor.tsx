'use client'

import { useCallback, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/crm/Button'
import { inputClass } from '@/components/crm/FormFields'
import { COLLEAGUE_IDS, colleagues } from '@/lib/colleagues'
import { cn } from '@/lib/utils'
import type {
  ColleagueId,
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
 */

const SECTION_LABELS: Record<GoalSection, string> = {
  north_star: 'Nordstjärna',
  annual: '2026 — Årsmål',
  quarter: 'Detta kvartal',
  weekly: 'Veckans icke-förhandlingsbara',
  principle: 'Principer',
  not_now: 'Inte nu',
}

const SECTION_HINTS: Record<GoalSection, string> = {
  north_star: 'En mening. Den enda raden högst upp på tavlan.',
  annual: 'Vad året ska ha gett. Sparas här — ritas inte på tavlan.',
  quarter: 'Vad som faktiskt görs nu. De tre första hamnar på tavlan.',
  weekly:
    'Räknas automatiskt från aktivitet i Leads och Prospekt. Nollställs varje måndag.',
  principle: 'Hur ni arbetar. Sparas här — ritas inte på tavlan.',
  not_now: 'Medvetet bortvalt. Sparas här — ritas inte på tavlan.',
}

const STATUS_LABELS: Record<GoalStatus, string> = {
  on_track: 'På spår',
  at_risk: 'Risk',
  off_track: 'Ur spår',
  done: 'Klart',
}

const UNIT_LABELS: Record<MetricUnit, string> = {
  currency: 'Valuta',
  number: 'Antal',
  percent: 'Procent',
}

/** Sections that take a progress bar. A principle has no percentage. */
const PROGRESS_SECTIONS: GoalSection[] = ['annual', 'quarter']

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

export function GoalsEditor({ initial }: { initial: GoalsSnapshot }) {
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
      if (!result.ok) setError(result.error)
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
      ...(PROGRESS_SECTIONS.includes(section) ? { progress: 0 } : {}),
      order: siblings.length,
    }
    setGoals((prev) => [...prev, goal])
    persist(() => api.createGoal(goal))
  }

  const editGoal = (id: string, updates: Partial<Goal>) => {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...updates } : g)))
    persist(() => api.updateGoal(id, updates))
  }

  const removeGoal = (id: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== id))
    persist(() => api.deleteGoal(id))
  }

  // --- metrics -------------------------------------------------------------

  const addMetric = () => {
    const metric: GoalMetric = {
      id: crypto.randomUUID(),
      label: '',
      currentValue: 0,
      unit: 'number',
      order: metrics.length,
    }
    setMetrics((prev) => [...prev, metric])
    persist(() => api.createGoalMetric(metric))
  }

  const editMetric = (id: string, updates: Partial<GoalMetric>) => {
    setMetrics((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)))
    persist(() => api.updateGoalMetric(id, updates))
  }

  const removeMetric = (id: string) => {
    setMetrics((prev) => prev.filter((m) => m.id !== id))
    persist(() => api.deleteGoalMetric(id))
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
    persist(() => api.createPersonalGoal(item))
  }

  const editPersonalGoal = (id: string, updates: Partial<PersonalGoal>) => {
    setPersonalGoals((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)))
    persist(() => api.updatePersonalGoal(id, updates))
  }

  const removePersonalGoal = (id: string) => {
    setPersonalGoals((prev) => prev.filter((f) => f.id !== id))
    persist(() => api.deletePersonalGoal(id))
  }

  // --- rendering -----------------------------------------------------------

  const inSection = (section: GoalSection) =>
    goals.filter((g) => g.section === section).sort((a, b) => a.order - b.order)

  const renderGoalRows = (section: GoalSection) => {
    const rows = inSection(section)
    const withProgress = PROGRESS_SECTIONS.includes(section)

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

              {section === 'north_star' && (
                <input
                  className={inputClass}
                  value={goal.detail}
                  placeholder="Stödjande rad (valfri)"
                  onChange={(e) =>
                    setGoals((prev) =>
                      prev.map((g) =>
                        g.id === goal.id ? { ...g, detail: e.target.value } : g
                      )
                    )
                  }
                  onBlur={(e) => editGoal(goal.id, { detail: e.target.value })}
                />
              )}

              {withProgress && (
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

                  <label className="flex items-center gap-2">
                    <span className="label-mono">Framsteg</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className={cn(inputClass, 'h-9 w-20 text-[14px] tabular-nums')}
                      value={goal.progress ?? 0}
                      onChange={(e) =>
                        setGoals((prev) =>
                          prev.map((g) =>
                            g.id === goal.id
                              ? { ...g, progress: Number(e.target.value) }
                              : g
                          )
                        )
                      }
                      onBlur={(e) =>
                        editGoal(goal.id, {
                          // Clamped here rather than trusting the input's min/max,
                          // which browsers do not enforce on typed values.
                          progress: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                        })
                      }
                    />
                    <span className="text-[13.5px] text-foreground/50">%</span>
                  </label>
                </div>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionShell
          title={SECTION_LABELS.annual}
          hint={SECTION_HINTS.annual}
          addLabel="Lägg till"
          onAdd={() => addGoal('annual')}
        >
          {renderGoalRows('annual')}
        </SectionShell>

        <SectionShell
          title={SECTION_LABELS.quarter}
          hint={SECTION_HINTS.quarter}
          addLabel="Lägg till"
          onAdd={() => addGoal('quarter')}
        >
          {renderGoalRows('quarter')}
        </SectionShell>
      </div>

      {/* --- scoreboard --- */}
      <SectionShell
        title="Resultattavla"
        hint="De tre första visas längst ner på tavlan. Lämna målet tomt för att bara visa värdet."
        addLabel="Lägg till"
        onAdd={addMetric}
      >
        {metrics.length === 0 ? (
          <p className="py-2 text-[13.5px] text-foreground/40">Inget här ännu.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {metrics
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((metric) => (
                <li key={metric.id} className="flex items-start gap-2">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                    <input
                      className={inputClass}
                      value={metric.label}
                      placeholder="Etikett, t.ex. Intäkt"
                      onChange={(e) =>
                        setMetrics((prev) =>
                          prev.map((m) =>
                            m.id === metric.id ? { ...m, label: e.target.value } : m
                          )
                        )
                      }
                      onBlur={(e) => editMetric(metric.id, { label: e.target.value })}
                    />
                    <input
                      type="number"
                      className={cn(inputClass, 'sm:w-32', 'tabular-nums')}
                      value={metric.currentValue}
                      placeholder="Nu"
                      onChange={(e) =>
                        setMetrics((prev) =>
                          prev.map((m) =>
                            m.id === metric.id
                              ? { ...m, currentValue: Number(e.target.value) }
                              : m
                          )
                        )
                      }
                      onBlur={(e) =>
                        editMetric(metric.id, {
                          currentValue: Number(e.target.value) || 0,
                        })
                      }
                    />
                    <input
                      type="number"
                      className={cn(inputClass, 'sm:w-32', 'tabular-nums')}
                      value={metric.targetValue ?? ''}
                      placeholder="Mål"
                      onChange={(e) =>
                        setMetrics((prev) =>
                          prev.map((m) =>
                            m.id === metric.id
                              ? {
                                  ...m,
                                  targetValue:
                                    e.target.value === ''
                                      ? undefined
                                      : Number(e.target.value),
                                }
                              : m
                          )
                        )
                      }
                      onBlur={(e) =>
                        // An empty field means "no target", which has to reach
                        // the DB as null rather than 0 — 0 would draw a bar.
                        editMetric(metric.id, {
                          targetValue:
                            e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                    />
                    <select
                      className={cn(inputClass, 'sm:w-32')}
                      value={metric.unit}
                      onChange={(e) =>
                        editMetric(metric.id, { unit: e.target.value as MetricUnit })
                      }
                    >
                      {(Object.keys(UNIT_LABELS) as MetricUnit[]).map((unit) => (
                        <option key={unit} value={unit}>
                          {UNIT_LABELS[unit]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <RemoveButton onClick={() => removeMetric(metric.id)} label="Ta bort" />
                </li>
              ))}
          </ul>
        )}
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
                        {/* Both optional and independent: a deadline goal, a
                            measurable one, or neither. The board shows the date
                            as a countdown and prefers it over the bar when both
                            are set. */}
                        <div className="flex flex-wrap items-center gap-2">
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
                          <label className="flex items-center gap-2">
                            <span className="label-mono">%</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              className={cn(inputClass, 'h-9 w-20 text-[14px] tabular-nums')}
                              value={item.progress ?? ''}
                              placeholder="—"
                              onChange={(e) =>
                                setPersonalGoals((prev) =>
                                  prev.map((f) =>
                                    f.id === item.id
                                      ? {
                                          ...f,
                                          progress:
                                            e.target.value === ''
                                              ? undefined
                                              : Number(e.target.value),
                                        }
                                      : f
                                  )
                                )
                              }
                              onBlur={(e) =>
                                editPersonalGoal(item.id, {
                                  progress:
                                    e.target.value === ''
                                      ? undefined
                                      : Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                                })
                              }
                            />
                          </label>
                        </div>
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
