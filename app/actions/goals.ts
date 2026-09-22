'use server'

import type { ActionScope, PersonalGoal, Goal, GoalMetric } from '@/lib/types'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/server'
import { isRetryableWrite, withRetry } from '@/lib/db/retry'
import { requireAuth, type AuthContext } from '@/lib/auth/guard'
import {
  toPersonalGoalInsert,
  toPersonalGoalUpdate,
  toGoalInsert,
  toGoalMetricInsert,
  toGoalMetricUpdate,
  toGoalUpdate,
} from '@/lib/db/mappers'

/**
 * Write path for the direction board.
 *
 * Same shape and same reasoning as ./crm — narrow writes behind an optimistic
 * client store, ids minted on the client, no revalidatePath. Kept in its own
 * file because goals are a Khyte-internal module rather than part of the CRM
 * proper; if Intenti is ever commercialised, this is the file that does not
 * ship.
 *
 * SECURITY. Every export here is a POST endpoint in its own right, gated on
 * the caller's session through run() and guardedOk() exactly as in ./crm — a
 * new action cannot skip the check without bypassing both helpers. The
 * session resolves to one person in one organization, and that organization
 * — never anything the client sent — is what every write below is scoped by:
 * inserts carry it, updates and deletes filter by it and report not_found
 * when the id was not theirs to touch.
 *
 * The display token in lib/auth/display-token.ts does NOT open these. It only
 * satisfies proxy.ts for /goals/display/* pathnames; requireAuth() below reads
 * the session cookie and nothing else, so a wallpaper link cannot write — it
 * names an organization to read, and that is all it names.
 *
 * IDENTITY. Every action takes a trailing `scope: ActionScope` — the
 * organization and person the calling tab believed it was acting as — which
 * run() and guardedOk() compare with the session that actually arrived,
 * before any read or write. A tab whose cookie changed underneath it (another
 * tab signed in as someone else) must not commit its half-typed goals as the
 * new identity; it gets `context_mismatch` back with nothing written, and the
 * editor shows that rather than the save it thought it made. The scope is an
 * expectation to verify, never an authority — no query below is scoped by it.
 * Same contract, and the same reasoning, as ./crm.
 */

export type ActionResult = { ok: true } | { ok: false; error: string }

const OK: ActionResult = { ok: true }

/** The same string ./crm reports, so one client-side contract covers both. */
const CONTEXT_MISMATCH = 'context_mismatch'

/**
 * What the caller thought it was against what the session says it is — the
 * refusal to return, or null when they agree. See ./crm for the full why; the
 * short version is that this compares and nothing more, so the organization
 * every write below is scoped by still comes from `context` alone.
 */
function scopeMismatch(context: AuthContext, scope: ActionScope): ActionResult | null {
  if (scope.organizationId === context.organizationId && scope.userId === context.userId) {
    return null
  }
  return { ok: false, error: CONTEXT_MISMATCH }
}

/** See ./crm — writes have nowhere to go on demo data, so report success. */
function skipUnconfigured(): boolean {
  return !isSupabaseConfigured
}

/** The unconfigured early-return with the session and scope checks kept in
 *  front of it — see ./crm for why the early return is guarded at all. */
async function guardedOk(scope: ActionScope): Promise<ActionResult> {
  const context = await requireAuth()
  return scopeMismatch(context, scope) ?? OK
}

/** See ./crm for both of these: the affected rows come back only when the
 *  query chained `.select()`, and a `row` write with none of them is a miss. */
type WriteResponse = { data: unknown[] | null; error: { message: string } | null }
type Expect = 'insert' | 'row'

const NOT_FOUND = 'not_found'

async function run(
  table: string,
  scope: ActionScope,
  operation: (context: AuthContext) => Promise<WriteResponse>,
  expect: Expect = 'insert'
): Promise<ActionResult> {
  const context = await requireAuth()

  // Before the try and before `operation` runs, so a tab acting as somebody
  // else is turned away without touching a row. Returned rather than thrown:
  // the client store tells this apart from a failed write by the error string.
  const mismatch = scopeMismatch(context, scope)
  if (mismatch) return mismatch

  try {
    return await withRetry(
      `${table} write`,
      async () => {
        const { data, error } = await operation(context)
        if (error) throw new Error(error.message)
        if (expect === 'row') {
          if (data === null) throw new Error(`affected rows not requested — chain .select('id')`)
          if (data.length === 0) throw new Error(NOT_FOUND)
        }
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

// --- goals -----------------------------------------------------------------

export async function createGoal(goal: Goal, scope: ActionScope): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk(scope)
  return run('goals', scope, async (context) =>
    getSupabase()
      .from('goals')
      .insert({ ...toGoalInsert(goal), organization_id: context.organizationId })
  )
}

export async function updateGoal(
  id: string,
  updates: Partial<Goal>,
  scope: ActionScope
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk(scope)
  const payload = toGoalUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk(scope)
  return run(
    'goals',
    scope,
    async (context) =>
      getSupabase()
        .from('goals')
        .update(payload)
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

export async function deleteGoal(id: string, scope: ActionScope): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk(scope)
  return run(
    'goals',
    scope,
    async (context) =>
      getSupabase()
        .from('goals')
        .delete()
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

// --- goal metrics ----------------------------------------------------------

export async function createGoalMetric(
  metric: GoalMetric,
  scope: ActionScope
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk(scope)
  return run('goal_metrics', scope, async (context) =>
    getSupabase()
      .from('goal_metrics')
      .insert({ ...toGoalMetricInsert(metric), organization_id: context.organizationId })
  )
}

export async function updateGoalMetric(
  id: string,
  updates: Partial<GoalMetric>,
  scope: ActionScope
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk(scope)
  const payload = toGoalMetricUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk(scope)
  return run(
    'goal_metrics',
    scope,
    async (context) =>
      getSupabase()
        .from('goal_metrics')
        .update(payload)
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

export async function deleteGoalMetric(id: string, scope: ActionScope): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk(scope)
  return run(
    'goal_metrics',
    scope,
    async (context) =>
      getSupabase()
        .from('goal_metrics')
        .delete()
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

// --- focus items -----------------------------------------------------------

export async function createPersonalGoal(
  item: PersonalGoal,
  scope: ActionScope
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk(scope)
  return run('personal_goals', scope, async (context) =>
    getSupabase()
      .from('personal_goals')
      .insert({ ...toPersonalGoalInsert(item), organization_id: context.organizationId })
  )
}

export async function updatePersonalGoal(
  id: string,
  updates: Partial<PersonalGoal>,
  scope: ActionScope
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk(scope)
  const payload = toPersonalGoalUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk(scope)
  return run(
    'personal_goals',
    scope,
    async (context) =>
      getSupabase()
        .from('personal_goals')
        .update(payload)
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

export async function deletePersonalGoal(id: string, scope: ActionScope): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk(scope)
  return run(
    'personal_goals',
    scope,
    async (context) =>
      getSupabase()
        .from('personal_goals')
        .delete()
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}
