'use server'

import type { PersonalGoal, Goal, GoalMetric } from '@/lib/types'
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
 */

export type ActionResult = { ok: true } | { ok: false; error: string }

const OK: ActionResult = { ok: true }

/** See ./crm — writes have nowhere to go on demo data, so report success. */
function skipUnconfigured(): boolean {
  return !isSupabaseConfigured
}

/** The unconfigured early-return with the session check kept in front of it. */
async function guardedOk(): Promise<ActionResult> {
  await requireAuth()
  return OK
}

/** See ./crm for both of these: the affected rows come back only when the
 *  query chained `.select()`, and a `row` write with none of them is a miss. */
type WriteResponse = { data: unknown[] | null; error: { message: string } | null }
type Expect = 'insert' | 'row'

const NOT_FOUND = 'not_found'

async function run(
  table: string,
  operation: (context: AuthContext) => Promise<WriteResponse>,
  expect: Expect = 'insert'
): Promise<ActionResult> {
  const context = await requireAuth()

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

export async function createGoal(goal: Goal): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('goals', async (context) =>
    getSupabase()
      .from('goals')
      .insert({ ...toGoalInsert(goal), organization_id: context.organizationId })
  )
}

export async function updateGoal(
  id: string,
  updates: Partial<Goal>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toGoalUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run(
    'goals',
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

export async function deleteGoal(id: string): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run(
    'goals',
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

export async function createGoalMetric(metric: GoalMetric): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('goal_metrics', async (context) =>
    getSupabase()
      .from('goal_metrics')
      .insert({ ...toGoalMetricInsert(metric), organization_id: context.organizationId })
  )
}

export async function updateGoalMetric(
  id: string,
  updates: Partial<GoalMetric>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toGoalMetricUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run(
    'goal_metrics',
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

export async function deleteGoalMetric(id: string): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run(
    'goal_metrics',
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

export async function createPersonalGoal(item: PersonalGoal): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('personal_goals', async (context) =>
    getSupabase()
      .from('personal_goals')
      .insert({ ...toPersonalGoalInsert(item), organization_id: context.organizationId })
  )
}

export async function updatePersonalGoal(
  id: string,
  updates: Partial<PersonalGoal>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toPersonalGoalUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run(
    'personal_goals',
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

export async function deletePersonalGoal(id: string): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run(
    'personal_goals',
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
