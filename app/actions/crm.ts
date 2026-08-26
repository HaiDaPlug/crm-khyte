'use server'

import type {
  Company,
  Contact,
  Lead,
  Note,
  Opportunity,
  StrategyCard,
  StrategyColumn,
  Task,
} from '@/lib/types'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/server'
import { isRetryableWrite, withRetry } from '@/lib/db/retry'
import { requireAuth } from '@/lib/auth/guard'
import {
  toCompanyInsert,
  toCompanyUpdate,
  toContactInsert,
  toContactUpdate,
  toLeadInsert,
  toLeadUpdate,
  toNoteInsert,
  toNoteUpdate,
  toOpportunityInsert,
  toOpportunityUpdate,
  toStrategyCardInsert,
  toStrategyCardUpdate,
  toStrategyColumnInsert,
  toStrategyColumnUpdate,
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
 * SECURITY. Server Actions are reachable by direct POST, not just through the
 * UI, so every function below is an endpoint in its own right. Each one is
 * gated on the shared-password session by run() and guardedOk() — the two
 * paths out of an action — rather than by a check repeated in all 21 bodies,
 * so a new action cannot be added without a session check unless it also
 * bypasses both helpers.
 *
 * proxy.ts turns away unauthenticated requests before they get here, but it
 * is an optimistic cookie check and not the last line: this is.
 *
 * Still outstanding: there is one shared password and no per-user identity,
 * so these actions authenticate but do not authorize — there is no owner_id
 * to check a caller against. The RLS policies in 20260819120000_init.sql are
 * the other half of that work, and land when accounts do.
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

/**
 * The unconfigured early-return, with the session check kept in front of it.
 *
 * Actions bail out to a bare OK when there is no database, which would
 * otherwise be a way to skip run() — and with it the only auth check — by
 * pointing an unauthenticated POST at an app running on demo data. Rare, but
 * it is exactly the sort of gap that turns into a real one the moment someone
 * deploys a preview without credentials.
 */
async function guardedOk(): Promise<ActionResult> {
  await requireAuth()
  return OK
}

async function run(
  table: string,
  operation: () => Promise<{ error: { message: string } | null }>
): Promise<ActionResult> {
  // Ahead of the try: an unauthorized call must reject, not be caught below
  // and returned as { ok: false } that the client store treats as a failed
  // write to retry.
  await requireAuth()

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
  if (skipUnconfigured()) return guardedOk()
  return run('companies', async () =>
    getSupabase().from('companies').insert(toCompanyInsert(company))
  )
}

export async function updateCompany(
  id: string,
  updates: Partial<Company>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toCompanyUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run('companies', async () =>
    getSupabase().from('companies').update(payload).eq('id', id)
  )
}

// --- contacts --------------------------------------------------------------

export async function createContact(contact: Contact): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('contacts', async () =>
    getSupabase().from('contacts').insert(toContactInsert(contact))
  )
}

export async function updateContact(
  id: string,
  updates: Partial<Contact>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toContactUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run('contacts', async () =>
    getSupabase().from('contacts').update(payload).eq('id', id)
  )
}

// --- opportunities ---------------------------------------------------------

export async function createOpportunity(
  opportunity: Opportunity
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('opportunities', async () =>
    getSupabase().from('opportunities').insert(toOpportunityInsert(opportunity))
  )
}

export async function updateOpportunity(
  id: string,
  updates: Partial<Opportunity>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toOpportunityUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run('opportunities', async () =>
    getSupabase().from('opportunities').update(payload).eq('id', id)
  )
}

// --- leads -------------------------------------------------------------

export async function createLead(lead: Lead): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('leads', async () =>
    getSupabase().from('leads').insert(toLeadInsert(lead))
  )
}

export async function updateLead(
  id: string,
  updates: Partial<Lead>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toLeadUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run('leads', async () =>
    getSupabase().from('leads').update(payload).eq('id', id)
  )
}

export async function deleteLead(id: string): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('leads', async () =>
    getSupabase().from('leads').delete().eq('id', id)
  )
}

// --- notes -----------------------------------------------------------------

export async function createNote(note: Note): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('notes', async () =>
    getSupabase().from('notes').insert(toNoteInsert(note))
  )
}

export async function updateNote(
  id: string,
  updates: Partial<Note>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toNoteUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run('notes', async () =>
    getSupabase().from('notes').update(payload).eq('id', id)
  )
}

export async function deleteNote(id: string): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('notes', async () =>
    getSupabase().from('notes').delete().eq('id', id)
  )
}

// --- strategy headlines ----------------------------------------------------

export async function createStrategyColumn(
  column: StrategyColumn
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('strategy_columns', async () =>
    getSupabase().from('strategy_columns').insert(toStrategyColumnInsert(column))
  )
}

export async function updateStrategyColumn(
  id: string,
  updates: Partial<StrategyColumn>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toStrategyColumnUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run('strategy_columns', async () =>
    getSupabase().from('strategy_columns').update(payload).eq('id', id)
  )
}

/** The deal's cards under this headline go with it (`on delete cascade`). */
export async function deleteStrategyColumn(id: string): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('strategy_columns', async () =>
    getSupabase().from('strategy_columns').delete().eq('id', id)
  )
}

// --- strategy cards --------------------------------------------------------

export async function createStrategyCard(
  card: StrategyCard
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('strategy_cards', async () =>
    getSupabase().from('strategy_cards').insert(toStrategyCardInsert(card))
  )
}

export async function updateStrategyCard(
  id: string,
  updates: Partial<StrategyCard>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toStrategyCardUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run('strategy_cards', async () =>
    getSupabase().from('strategy_cards').update(payload).eq('id', id)
  )
}

// --- tasks -----------------------------------------------------------------

export async function createTask(task: Task): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('tasks', async () =>
    getSupabase().from('tasks').insert(toTaskInsert(task))
  )
}

export async function updateTask(
  id: string,
  updates: Partial<Task>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toTaskUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run('tasks', async () =>
    getSupabase().from('tasks').update(payload).eq('id', id)
  )
}

/**
 * Permanent. Reserved for tasks created in error — anything worth keeping in
 * the record should be archived instead.
 */
export async function deleteTask(id: string): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('tasks', async () =>
    getSupabase().from('tasks').delete().eq('id', id)
  )
}
