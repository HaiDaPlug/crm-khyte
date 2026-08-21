'use server'

import type {
  Company,
  Contact,
  Note,
  Opportunity,
  StrategyCard,
  Task,
} from '@/lib/types'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/server'
import { isRetryableWrite, withRetry } from '@/lib/db/retry'
import {
  toCompanyInsert,
  toContactInsert,
  toNoteInsert,
  toNoteUpdate,
  toOpportunityInsert,
  toOpportunityUpdate,
  toStrategyCardInsert,
  toStrategyCardUpdate,
  toTaskInsert,
  toTaskUpdate,
} from '@/lib/db/mappers'

/**
 * Write path for the CRM.
 *
 * The client store applies every change optimistically and then calls one of
 * these to persist it, so each action is a single narrow write rather than a
 * form handler. Records carry an id generated on the client, which is what
 * lets the optimistic row and the stored row be the same row.
 *
 * No revalidatePath here on purpose: after boot the client store is the source
 * of truth for the current session, and the server snapshot is only read on a
 * full page load. Invalidating routes on every drag would refetch the whole
 * working set for a change the UI has already applied.
 *
 * SECURITY — read before deploying. Server Actions are reachable by direct
 * POST, not just through the UI, and there is no auth in the app yet. Every
 * function below is effectively a public write endpoint. Keep this app private
 * (local or an access-controlled preview) until auth ships and these actions
 * check a session and an owner_id. The RLS policies in 20260819120000_init.sql are the
 * other half of that work.
 */

export type ActionResult = { ok: true } | { ok: false; error: string }

const OK: ActionResult = { ok: true }

/**
 * Without credentials the app runs on in-memory demo data, so writes have
 * nowhere to go. Report success rather than surfacing an error on every
 * interaction — loadSnapshot already warns once at boot that nothing persists.
 */
function skipUnconfigured(): boolean {
  return !isSupabaseConfigured
}

async function run(
  table: string,
  operation: () => Promise<{ error: { message: string } | null }>
): Promise<ActionResult> {
  try {
    // A PostgREST error is raised rather than returned so withRetry can judge
    // it; only not-yet-valid-token failures retry, and anything else lands in
    // the catch below exactly as it did before.
    return await withRetry(
      `${table} write`,
      async () => {
        const { error } = await operation()
        if (error) throw new Error(error.message)
        return OK
      },
      isRetryableWrite
    )
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    console.error(`[khyte] ${table} write failed:`, message)
    return { ok: false, error: message }
  }
}

// --- companies -------------------------------------------------------------

export async function createCompany(company: Company): Promise<ActionResult> {
  if (skipUnconfigured()) return OK
  return run('companies', async () =>
    getSupabase().from('companies').insert(toCompanyInsert(company))
  )
}

// --- contacts --------------------------------------------------------------

export async function createContact(contact: Contact): Promise<ActionResult> {
  if (skipUnconfigured()) return OK
  return run('contacts', async () =>
    getSupabase().from('contacts').insert(toContactInsert(contact))
  )
}

// --- opportunities ---------------------------------------------------------

export async function createOpportunity(
  opportunity: Opportunity
): Promise<ActionResult> {
  if (skipUnconfigured()) return OK
  return run('opportunities', async () =>
    getSupabase().from('opportunities').insert(toOpportunityInsert(opportunity))
  )
}

export async function updateOpportunity(
  id: string,
  updates: Partial<Opportunity>
): Promise<ActionResult> {
  if (skipUnconfigured()) return OK
  const payload = toOpportunityUpdate(updates)
  if (Object.keys(payload).length === 0) return OK
  return run('opportunities', async () =>
    getSupabase().from('opportunities').update(payload).eq('id', id)
  )
}

// --- notes -----------------------------------------------------------------

export async function createNote(note: Note): Promise<ActionResult> {
  if (skipUnconfigured()) return OK
  return run('notes', async () =>
    getSupabase().from('notes').insert(toNoteInsert(note))
  )
}

export async function updateNote(
  id: string,
  updates: Partial<Note>
): Promise<ActionResult> {
  if (skipUnconfigured()) return OK
  const payload = toNoteUpdate(updates)
  if (Object.keys(payload).length === 0) return OK
  return run('notes', async () =>
    getSupabase().from('notes').update(payload).eq('id', id)
  )
}

// --- strategy cards --------------------------------------------------------

export async function createStrategyCard(
  card: StrategyCard
): Promise<ActionResult> {
  if (skipUnconfigured()) return OK
  return run('strategy_cards', async () =>
    getSupabase().from('strategy_cards').insert(toStrategyCardInsert(card))
  )
}

export async function updateStrategyCard(
  id: string,
  updates: Partial<StrategyCard>
): Promise<ActionResult> {
  if (skipUnconfigured()) return OK
  const payload = toStrategyCardUpdate(updates)
  if (Object.keys(payload).length === 0) return OK
  return run('strategy_cards', async () =>
    getSupabase().from('strategy_cards').update(payload).eq('id', id)
  )
}

// --- tasks -----------------------------------------------------------------

export async function createTask(task: Task): Promise<ActionResult> {
  if (skipUnconfigured()) return OK
  return run('tasks', async () =>
    getSupabase().from('tasks').insert(toTaskInsert(task))
  )
}

export async function updateTask(
  id: string,
  updates: Partial<Task>
): Promise<ActionResult> {
  if (skipUnconfigured()) return OK
  const payload = toTaskUpdate(updates)
  if (Object.keys(payload).length === 0) return OK
  return run('tasks', async () =>
    getSupabase().from('tasks').update(payload).eq('id', id)
  )
}
