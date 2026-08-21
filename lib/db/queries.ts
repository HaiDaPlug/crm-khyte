import 'server-only'

import { connection } from 'next/server'

import type { CRMSnapshot } from '@/lib/types'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/server'
import { isClockSkew, isTransientRead, withRetry } from './retry'
import { mockCompanies } from '@/lib/mock-data/companies'
import { mockContacts } from '@/lib/mock-data/contacts'
import { mockOpportunities } from '@/lib/mock-data/opportunities'
import { mockNotes } from '@/lib/mock-data/notes'
import { mockStrategyCards } from '@/lib/mock-data/strategy'
import { mockTasks } from '@/lib/mock-data/tasks'
import {
  fromCompanyRow,
  fromContactRow,
  fromNoteRow,
  fromOpportunityRow,
  fromStrategyCardRow,
  fromTaskRow,
} from './mappers'
import type {
  CompanyRow,
  ContactRow,
  NoteRow,
  OpportunityRow,
  StrategyCardRow,
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

  if (!isSupabaseConfigured) {
    if (!warnedAboutMissingConfig) {
      warnedAboutMissingConfig = true
      console.warn(
        '[khyte] No Supabase credentials found — serving in-memory demo data. ' +
          'Changes will not persist. See .env.example to connect a database.'
      )
    }
    return demoSnapshot()
  }

  // Retried because Supabase occasionally rejects a read with a not-yet-valid
  // token; see ./retry. A misconfigured database still fails on the first try.
  return withRetry('loadSnapshot', readSnapshot, isTransientRead)
}

async function readSnapshot(): Promise<CRMSnapshot> {
  const supabase = getSupabase()

  const [companies, contacts, opportunities, notes, strategyCards, tasks] =
    await Promise.all([
      supabase.from('companies').select('*').order('created_at'),
      supabase.from('contacts').select('*').order('created_at'),
      supabase
        .from('opportunities')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase.from('notes').select('*').order('created_at', { ascending: false }),
      supabase
        .from('strategy_cards')
        .select('*')
        .order('column_name')
        .order('sort_order'),
      supabase.from('tasks').select('*').order('created_at', { ascending: false }),
    ])

  return {
    companies: unwrap<CompanyRow>(companies, 'companies').map(fromCompanyRow),
    contacts: unwrap<ContactRow>(contacts, 'contacts').map(fromContactRow),
    opportunities: unwrap<OpportunityRow>(opportunities, 'opportunities').map(
      fromOpportunityRow
    ),
    notes: unwrap<NoteRow>(notes, 'notes').map(fromNoteRow),
    strategyCards: unwrap<StrategyCardRow>(strategyCards, 'strategy_cards').map(
      fromStrategyCardRow
    ),
    tasks: unwrap<TaskRow>(tasks, 'tasks').map(fromTaskRow),
  }
}

type QueryResult = { data: unknown; error: { message: string } | null }

/**
 * PostgREST hands back `unknown` without generated database types, so the row
 * shape is asserted here against the hand-written types in ./rows.
 */
function unwrap<Row>(result: QueryResult, table: string): Row[] {
  if (result.error) {
    // Two very different failures wear the same shape here. Sending someone to
    // re-check a key that is provably fine costs more than the outage did.
    const hint = isClockSkew(result.error.message)
      ? 'The database rejected a token it considered not yet valid — a clock ' +
        'disagreement upstream, not a credential problem. It clears on its own; ' +
        'retrying is all that is needed. See lib/db/retry.ts.'
      : 'Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are right, ' +
        'and that supabase/migrations/20260819120000_init.sql has been run on this project.'

    throw new Error(`[khyte] Failed to load "${table}": ${result.error.message}. ${hint}`)
  }
  return (result.data ?? []) as Row[]
}

/** Credential-free fallback so the app is runnable before the DB is set up. */
function demoSnapshot(): CRMSnapshot {
  return {
    companies: mockCompanies,
    contacts: mockContacts,
    opportunities: mockOpportunities,
    notes: mockNotes,
    strategyCards: mockStrategyCards,
    tasks: mockTasks,
  }
}

// Row types are re-exported so callers can type intermediate values without
// reaching into ./rows directly.
export type {
  CompanyRow,
  ContactRow,
  NoteRow,
  OpportunityRow,
  StrategyCardRow,
  TaskRow,
}
