/**
 * Reconstructs crm_events for prospects that were entered before the CRM
 * recorded them.
 *
 * WHY THIS EXISTS. Activity used to be logged only when an opportunity's stage
 * *changed*, which missed the way the team actually works: a company is called
 * first and entered afterwards, filed straight into 'Contacted' with the date
 * of the call. Creation recorded nothing, so a day of outreach showed up on the
 * board as zero. app/actions/crm.ts now records on create as well — but only
 * for prospects added from here on. This is the catch-up for everything already
 * in the table.
 *
 * THE RULE, identical to lib/db/events.ts so the two cannot disagree:
 *
 *   - A prospect sitting at or past 'Contacted' has been contacted. Past
 *     'Meeting Booked', a meeting was booked. At 'Won', a deal was won. 'Lost'
 *     counts as none of them.
 *   - The event is dated by `last_interaction` — the day the contact actually
 *     happened — falling back to `created_at` when that is blank. This is what
 *     puts a prospect you called last Tuesday into last Tuesday's week.
 *   - Nothing is written where an event of that kind already exists for that
 *     prospect on that day, so running this twice adds nothing the second time.
 *
 * Idempotent and additive: it only ever inserts, never edits or deletes, which
 * is what the append-only log requires.
 *
 * Usage:
 *   node scripts/backfill-events.mjs             show what would be written
 *   node scripts/backfill-events.mjs --apply     actually write it
 */
import { createClient } from '@supabase/supabase-js'
import { readEnvLocal } from './supabase.mjs'

const APPLY = process.argv.includes('--apply')

const env = readEnvLocal()
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SECRET_KEY

if (!url || !key) {
  console.error(
    '\n[khyte] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in\n' +
      '  .env.local. Without a database there is nothing to backfill.\n'
  )
  process.exit(1)
}

const db = createClient(url, key)

// --- the rule, mirrored from lib/db/events.ts -------------------------------

const STAGES = [
  'New', 'Ongoing', 'Contacted', 'Warm',
  'Meeting Booked', 'Proposal Sent', 'Negotiation', 'Won', 'Lost',
]

/**
 * Position in the pipeline. Duplicated from lib/stage-config.ts because a
 * plain .mjs script cannot import the TypeScript module; keep the two in step.
 *
 * An unrecognised stage ranks -1, which puts it before 'Contacted' and so
 * records nothing. That is the safe direction — a stage this script has never
 * heard of must not be allowed to invent outreach — and it is what makes this
 * correct either side of the 'Researched' → 'New' merge in
 * supabase/migrations/20260901120100_stage_ongoing_backfill.sql, whose rows
 * produce no events under either name.
 */
const rank = (stage) => STAGES.indexOf(stage)

/** True when arriving at `to` crosses `threshold`, starting from the front. */
function crossedInto(to, threshold) {
  if (to === 'Lost') return false
  return rank(to) >= rank(threshold)
}

function kindsForStage(stage) {
  const kinds = []
  if (crossedInto(stage, 'Contacted')) kinds.push('prospect_contacted')
  if (crossedInto(stage, 'Meeting Booked')) kinds.push('meeting_booked')
  if (stage === 'Won') kinds.push('deal_won')
  return kinds
}

/**
 * Midnight local on the day a date string names.
 *
 * Field-by-field rather than `new Date(string)`, which reads a bare date as UTC
 * midnight and, west of Greenwich, files the touch in the previous local day —
 * and therefore possibly the previous week. Matches dayStart() in
 * lib/db/events.ts and weekStart() in lib/db/board-metrics.ts.
 */
function dayStart(value) {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * A Date rendered as the local calendar day it falls on.
 *
 * Deliberately not `toISOString().slice(0, 10)`: local midnight east of
 * Greenwich is the *previous* day in UTC, so that would label every key and
 * every printed week one day early.
 */
const dayKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`

// --- read what is already there ---------------------------------------------

const { data: opportunities, error: oppError } = await db
  .from('opportunities')
  .select('id, stage, last_interaction, created_at, followed_up_by')

if (oppError) {
  console.error(`[khyte] could not read opportunities: ${oppError.message}`)
  process.exit(1)
}

const { data: existing, error: eventError } = await db
  .from('crm_events')
  .select('kind, subject_id, occurred_at')

if (eventError) {
  console.error(`[khyte] could not read crm_events: ${eventError.message}`)
  process.exit(1)
}

// One key per (kind, prospect, local day) already on the log. Built once rather
// than queried per candidate — the whole table is a few dozen rows.
const already = new Set(
  existing.map((e) => `${e.kind}:${e.subject_id}:${dayKey(new Date(e.occurred_at))}`)
)

// --- work out what is missing ------------------------------------------------

const planned = []
const skipped = []

for (const opp of opportunities) {
  const when = dayStart(opp.last_interaction || opp.created_at)

  for (const kind of kindsForStage(opp.stage)) {
    const key = `${kind}:${opp.id}:${dayKey(when)}`
    if (already.has(key)) {
      skipped.push(key)
      continue
    }
    already.add(key)
    planned.push({
      kind,
      subject_id: opp.id,
      colleague: opp.followed_up_by ?? null,
      detail: { backfilled: true, stage: opp.stage },
      occurred_at: when.toISOString(),
    })
  }
}

// --- report ------------------------------------------------------------------

const tally = (rows, pick) =>
  rows.reduce((acc, r) => ({ ...acc, [pick(r)]: (acc[pick(r)] ?? 0) + 1 }), {})

console.log(`\n[khyte] ${opportunities.length} opportunities, ${existing.length} events on the log.`)
console.log(`[khyte] already recorded, leaving alone: ${skipped.length}`)
console.log(`[khyte] to write: ${planned.length}`)
console.log('\n  by kind:', tally(planned, (r) => r.kind))
console.log('  by week:', tally(planned, (r) => {
  const d = new Date(r.occurred_at)
  const monday = new Date(d)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return dayKey(monday)
}))

if (planned.length === 0) {
  console.log('\n[khyte] Nothing to do.\n')
  process.exit(0)
}

if (!APPLY) {
  console.log('\n[khyte] Dry run — nothing written. Re-run with --apply to write it.\n')
  process.exit(0)
}

const { error: insertError } = await db.from('crm_events').insert(planned)

if (insertError) {
  console.error(`\n[khyte] backfill failed: ${insertError.message}\n`)
  process.exit(1)
}

console.log(`\n[khyte] Wrote ${planned.length} events.\n`)
