import 'server-only'

import { connection } from 'next/server'

import type { CRMSnapshot, GoalsSnapshot } from '@/lib/types'
import { isSupabaseConfigured } from '@/lib/supabase/server'
import { getDb, isDirectDbConfigured } from './pg'
import { isClockSkew } from './retry'
import { mockCompanies } from '@/lib/mock-data/companies'
import { mockContacts } from '@/lib/mock-data/contacts'
import { mockOpportunities } from '@/lib/mock-data/opportunities'
import { mockLeads } from '@/lib/mock-data/leads'
import { mockNotes } from '@/lib/mock-data/notes'
import { mockStrategyCards, mockStrategyColumns } from '@/lib/mock-data/strategy'
import { mockTasks } from '@/lib/mock-data/tasks'
import { mockFocusItems, mockGoalMetrics, mockGoals } from '@/lib/mock-data/goals'
import {
  fromCompanyRow,
  fromContactRow,
  fromFocusItemRow,
  fromGoalMetricRow,
  fromGoalRow,
  fromLeadRow,
  fromNoteRow,
  fromOpportunityRow,
  fromStrategyCardRow,
  fromStrategyColumnRow,
  fromTaskRow,
} from './mappers'
import type {
  CompanyRow,
  ContactRow,
  FocusItemRow,
  GoalMetricRow,
  GoalRow,
  LeadRow,
  NoteRow,
  OpportunityRow,
  StrategyCardRow,
  StrategyColumnRow,
  TaskRow,
} from './rows'

let warnedAboutMissingConfig = false

/**
 * Reads the entire working set in one pass.
 *
 * The whole CRM is a few hundred rows for a single operator, and every screen
 * already reads from one in-memory store, so a single snapshot on boot is both
 * simpler and fewer round-trips than per-route queries. Revisit if a workspace
 * ever grows past a few thousand opportunities.
 *
 * Without credentials this returns the demo data instead, so the UI still runs
 * on a fresh clone. With credentials, a failed query throws — a configured but
 * broken database should be loud, not silently empty.
 */
export async function loadSnapshot(): Promise<CRMSnapshot> {
  // Opt out of prerendering. The layout that calls this uses no request-time
  // API, so without this Next would happily bake the CRM into static HTML at
  // build time and serve everyone the same frozen pipeline until a redeploy.
  await connection()

  if (!isSupabaseConfigured || !isDirectDbConfigured) {
    if (!warnedAboutMissingConfig) {
      warnedAboutMissingConfig = true
      console.warn(
        '[khyte] No Supabase credentials found — serving in-memory demo data. ' +
          'Changes will not persist. See .env.example to connect a database.'
      )
    }
    return demoSnapshot()
  }

  // Reads go straight to Postgres via SUPABASE_DB_URL rather than through
  // PostgREST — see ./pg. That path mints no JWT, so it cannot hit the
  // `JWT issued at future` clock-skew fault ./retry was written to wait out;
  // a misconfigured database still fails immediately, same as before.
  return readSnapshot()
}

async function readSnapshot(): Promise<CRMSnapshot> {
  const sql = getDb()

  const [
    companies,
    contacts,
    opportunities,
    leads,
    notes,
    strategyColumns,
    strategyCards,
    tasks,
  ] = await withDbErrors(() =>
    Promise.all([
      sql`select * from companies order by created_at`,
      sql`select * from contacts order by created_at`,
      sql`select * from opportunities order by created_at desc`,
      sql`select * from leads order by created_at desc`,
      sql`select * from notes order by created_at desc`,
      sql`select * from strategy_columns order by opportunity_id, sort_order`,
      sql`select * from strategy_cards order by sort_order`,
      sql`select * from tasks order by created_at desc`,
    ])
  )

  return {
    companies: (companies as unknown as CompanyRow[]).map(fromCompanyRow),
    contacts: (contacts as unknown as ContactRow[]).map(fromContactRow),
    opportunities: (opportunities as unknown as OpportunityRow[]).map(fromOpportunityRow),
    leads: (leads as unknown as LeadRow[]).map(fromLeadRow),
    notes: (notes as unknown as NoteRow[]).map(fromNoteRow),
    strategyColumns: (strategyColumns as unknown as StrategyColumnRow[]).map(
      fromStrategyColumnRow
    ),
    strategyCards: (strategyCards as unknown as StrategyCardRow[]).map(fromStrategyCardRow),
    tasks: (tasks as unknown as TaskRow[]).map(fromTaskRow),
  }
}

/**
 * Reads the direction board — company goals, scoreboard, everyone's focus.
 *
 * Deliberately separate from loadSnapshot rather than another key on it. The
 * wallpaper route at /goals/display/[colleague] repaints on a timer, and it
 * has no use for companies, contacts, opportunities, notes or the strategy
 * boards — folding this into the snapshot would drag the entire CRM working
 * set through Postgres on every refresh, forever, for three small tables.
 *
 * The editor at /goals calls this too, which is why it returns all colleagues'
 * focus items rather than filtering to one: the display route filters in
 * memory, the editor needs the lot.
 */
export async function loadGoals(): Promise<GoalsSnapshot> {
  // Same reasoning as loadSnapshot: opt out of prerendering, or the wallpaper
  // would be baked at build time and never change again.
  await connection()

  if (!isSupabaseConfigured || !isDirectDbConfigured) {
    return {
      goals: mockGoals,
      metrics: mockGoalMetrics,
      focusItems: mockFocusItems,
    }
  }

  const sql = getDb()

  const [goals, metrics, focusItems] = await withDbErrors(() =>
    Promise.all([
      sql`select * from goals order by section, sort_order`,
      sql`select * from goal_metrics order by sort_order`,
      sql`select * from focus_items order by colleague, sort_order`,
    ])
  )

  return {
    goals: (goals as unknown as GoalRow[]).map(fromGoalRow),
    metrics: (metrics as unknown as GoalMetricRow[]).map(fromGoalMetricRow),
    focusItems: (focusItems as unknown as FocusItemRow[]).map(fromFocusItemRow),
  }
}

/**
 * Wraps the raw driver error with the same diagnostic shape `unwrap` used to
 * give the PostgREST path — a wrong connection string or an un-migrated
 * database should still fail loud and specific, not just "connection error".
 */
async function withDbErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)

    // The clock-skew fault this whole module was reworked to avoid is a
    // PostgREST-only failure mode — it cannot happen on this connection. If
    // this text ever appears here, something upstream changed; say so rather
    // than silently mis-attributing it.
    const hint = isClockSkew(message)
      ? 'Unexpected: this is a PostgREST-only fault and this path bypasses PostgREST. ' +
        'See lib/db/pg.ts.'
      : 'Check SUPABASE_DB_URL is right, and that ' +
        'supabase/migrations/20260819120000_init.sql has been run on this project.'

    throw new Error(`[khyte] Failed to load snapshot: ${message}. ${hint}`)
  }
}

/** Credential-free fallback so the app is runnable before the DB is set up. */
function demoSnapshot(): CRMSnapshot {
  return {
    companies: mockCompanies,
    contacts: mockContacts,
    opportunities: mockOpportunities,
    leads: mockLeads,
    notes: mockNotes,
    strategyColumns: mockStrategyColumns,
    strategyCards: mockStrategyCards,
    tasks: mockTasks,
  }
}

// Row types are re-exported so callers can type intermediate values without
// reaching into ./rows directly.
export type {
  CompanyRow,
  ContactRow,
  LeadRow,
  NoteRow,
  OpportunityRow,
  StrategyCardRow,
  StrategyColumnRow,
  TaskRow,
}
