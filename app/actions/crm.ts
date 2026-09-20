'use server'

import type {
  ColleagueId,
  Company,
  Contact,
  Lead,
  Stage,
  Note,
  Opportunity,
  StrategyBoard,
  StrategyCard,
  StrategyColumn,
  Task,
} from '@/lib/types'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/server'
import { isRetryableWrite, withRetry } from '@/lib/db/retry'
import { requireAuth, type AuthContext } from '@/lib/auth/guard'
import {
  PIPELINE_START,
  eventsForArrival,
  recordEvents,
  type EventScope,
  type RecordEventInput,
} from '@/lib/db/events'
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
 * gated on the caller's session by run() and guardedOk() — the two paths out
 * of an action — rather than by a check repeated in every body, so a new
 * action cannot be added without a session check unless it also bypasses both
 * helpers. run() hands the operation the AuthContext it resolved, and that
 * context is the only place an organization id ever comes from.
 *
 * proxy.ts turns away unauthenticated requests before they get here, but it
 * is an optimistic cookie check and not the last line: this is.
 *
 * SCOPE. A session belongs to one person in one organization
 * (lib/auth/context.ts), and every write below carries that organization:
 * inserts set `organization_id` explicitly rather than leaning on the
 * column's rollout default, and updates and deletes filter by it and check
 * that a row was actually hit. A row id from the client is therefore only
 * ever a name for a row inside the caller's own organization — an id lifted
 * from anywhere else matches nothing and comes back `not_found` instead of
 * silently succeeding. `owner_id` is left alone: the organization, not the
 * individual, is the unit of access, and the composite foreign keys in
 * 20260920120000_organizations.sql hold that line even for a query that
 * forgets to filter.
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

/**
 * What PostgREST hands back from a write: the affected rows when the query
 * chained `.select()`, null when it did not.
 */
type WriteResponse = { data: unknown[] | null; error: { message: string } | null }

/**
 * What it takes for a write to count as having happened.
 *
 *   insert — a failed insert raises, so a clean response is the whole answer.
 *   row    — an update or delete filtered by id AND organization succeeds
 *            with zero rows when the id belongs to another organization, or
 *            to nothing at all: PostgREST reports "0 rows matched" as no
 *            error whatsoever. The action chains `.select('id')` so the
 *            affected rows come back, and none means the row was not there
 *            to be written — which the caller must hear as a failure, not as
 *            a save that landed.
 */
type Expect = 'insert' | 'row'

/** The error a `row` write reports when it hit nothing. Part of the contract
 *  with the client store, which shows it verbatim in the toast. */
const NOT_FOUND = 'not_found'

/**
 * Whose activity an event is filed under.
 *
 * `recordedBy` is the account that made the write, which is a different fact
 * from the roster label on the event itself: `colleague` says whose work it
 * was, `recorded_by` says who typed it in. They agree for a person working
 * their own prospects and differ when someone logs a teammate's call.
 */
function eventScope(context: AuthContext): EventScope {
  return { organizationId: context.organizationId, recordedBy: context.userId }
}

async function run(
  table: string,
  operation: (context: AuthContext) => Promise<WriteResponse>,
  expect: Expect = 'insert'
): Promise<ActionResult> {
  // Ahead of the try: an unauthorized call must reject, not be caught below
  // and returned as { ok: false } that the client store treats as a failed
  // write to retry.
  const context = await requireAuth()

  try {
    // A PostgREST error is raised rather than returned so withRetry can judge
    // it; only not-yet-valid-token failures retry, and anything else lands in
    // the catch below exactly as it did before.
    return await withRetry(
      `${table} write`,
      async () => {
        const { data, error } = await operation(context)
        if (error) throw new Error(error.message)
        if (expect === 'row') {
          // A null here is a bug in the action, not a missing row: the query
          // never asked for its affected rows back, so the check below could
          // never fire. Loud the first time the action runs, rather than a
          // guard that quietly does nothing.
          if (data === null) throw new Error(`affected rows not requested — chain .select('id')`)
          // Not a retryable message, so withRetry hands it straight to the
          // catch and it is logged and returned like any other failed write.
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

// --- companies -------------------------------------------------------------

export async function createCompany(company: Company): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('companies', async (context) =>
    getSupabase()
      .from('companies')
      .insert({ ...toCompanyInsert(company), organization_id: context.organizationId })
  )
}

export async function updateCompany(
  id: string,
  updates: Partial<Company>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toCompanyUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run(
    'companies',
    async (context) =>
      getSupabase()
        .from('companies')
        .update(payload)
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

// --- contacts --------------------------------------------------------------

export async function createContact(contact: Contact): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('contacts', async (context) =>
    getSupabase()
      .from('contacts')
      .insert({ ...toContactInsert(contact), organization_id: context.organizationId })
  )
}

export async function updateContact(
  id: string,
  updates: Partial<Contact>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toContactUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run(
    'contacts',
    async (context) =>
      getSupabase()
        .from('contacts')
        .update(payload)
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

// --- opportunities ---------------------------------------------------------

export async function createOpportunity(
  opportunity: Opportunity
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  // Resolved here as well as inside run(). getAuthContext is cached per
  // request, so this is the same context and not a second query — it is
  // needed out here because the event scope below outlives the write.
  const context = await requireAuth()

  const result = await run('opportunities', async () =>
    getSupabase()
      .from('opportunities')
      .insert({ ...toOpportunityInsert(opportunity), organization_id: context.organizationId })
  )

  /**
   * A prospect added at a stage past the front of the pipeline has already
   * been worked, and the log has to say so.
   *
   * This is the team's main way of recording outreach: they contact a company
   * first and enter it afterwards, filed straight into Contacted with the date
   * it happened. Recording only on stage *changes* missed all of it, so a day
   * of calls read as zero on the board.
   *
   * Dated by `lastInteraction`, which is why adding a prospect contacted last
   * week credits last week rather than today. AddProspectModal fills that field
   * with today when it is left blank, which is the right default here: the
   * stage decides whether anything is recorded at all, and the date only
   * decides which week it lands in.
   */
  if (result.ok) {
    await recordEvents(
      eventScope(context),
      eventsForArrival(PIPELINE_START, opportunity.stage, {
        subjectId: opportunity.id,
        colleague: opportunity.followedUpBy,
        occurredOn: opportunity.lastInteraction,
      })
    )
  }

  return result
}

export async function updateOpportunity(
  id: string,
  updates: Partial<Opportunity>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toOpportunityUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  // Same request-cached context as run() resolves; see createOpportunity.
  // Needed ahead of the write here because the pre-read must be scoped too.
  const context = await requireAuth()

  /**
   * A stage change is the CRM's only record that something happened, and the
   * row about to be overwritten is the only place the previous stage exists.
   * Read it first, or "moved into Meeting Booked" is unknowable a moment later.
   *
   * Only for stage changes: every other edit skips this round-trip entirely.
   * The read is not transactional with the write, so two people moving the same
   * deal at the same instant could both see the same `from` — acceptable for an
   * activity counter on a three-person team, and the alternative is a stored
   * procedure for a number on a wallpaper.
   *
   * Scoped to the caller's organization like the write that follows. A row
   * from another organization reads as absent here, and the write then comes
   * back not_found, so no event is ever recorded against it.
   */
  let previousStage: Stage | undefined
  let currentOwner: ColleagueId | undefined
  if (updates.stage !== undefined || updates.lastInteraction) {
    const { data } = await getSupabase()
      .from('opportunities')
      .select('stage, followed_up_by')
      .eq('id', id)
      .eq('organization_id', context.organizationId)
      .maybeSingle()
    const row = data as { stage: Stage; followed_up_by: ColleagueId | null } | null
    previousStage = row?.stage
    currentOwner = row?.followed_up_by ?? undefined
  }

  /**
   * Who to credit: whoever this edit names, else whoever already owns the row.
   *
   * `updates.followedUpBy` is only set when the edit is *changing* the owner, so
   * using it alone filed every ordinary drag as unattributed — the prospect had
   * an owner, the edit just wasn't about that. The result was a "Utan ansvarig"
   * bucket counting work that was in fact somebody's: 24 of 29 unattributed
   * events belonged to prospects with an owner, against 0 genuinely unowned
   * prospects.
   *
   * Reading the row rather than trusting the client keeps this honest. The
   * `in` check rather than `?? `: clearing an owner passes
   * `{ followedUpBy: undefined }` — the same shape as an edit that says nothing
   * about ownership — and only the key's presence tells the two apart. Same
   * treatment, and the same reason, as `assignee` in toTaskUpdate. So
   * deliberately unassigning still records as unattributed, while an ordinary
   * drag credits the person who owns the prospect.
   */
  const actor = 'followedUpBy' in updates ? updates.followedUpBy : currentOwner

  const result = await run(
    'opportunities',
    async () =>
      getSupabase()
        .from('opportunities')
        .update(payload)
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )

  // Only after the write is known to have landed — see lib/db/events.ts.
  if (result.ok) {
    const events: RecordEventInput[] = []

    if (updates.stage !== undefined && previousStage) {
      events.push(
        ...eventsForArrival(previousStage, updates.stage, {
          subjectId: id,
          colleague: actor,
          // A drag is dated now, not by lastInteraction: moving a card today
          // is something that happened today, whatever date the deal carries.
        })
      )
    }

    /**
     * Setting "senaste kontakt" is the other half of how outreach gets logged.
     *
     * Without this the counter only ever saw the pipeline drag, so a week spent
     * working the phone and recording it in the drawer read as zero prospects
     * contacted. Dated to the day entered rather than to now, so logging on
     * Thursday that the call happened Tuesday files it in Tuesday's week.
     *
     * Update only, deliberately — not createOpportunity. AddProspectModal
     * defaults this field to today when it is left blank (see its submit
     * handler), so counting it on creation would score every prospect added as
     * a prospect contacted, which is the one number this must not invent.
     */
    if (updates.lastInteraction) {
      events.push({
        kind: 'prospect_contacted',
        subjectId: id,
        colleague: actor,
        detail: { loggedVia: 'last_interaction' },
        occurredOn: updates.lastInteraction,
        oncePerDay: true,
      })
    }

    await recordEvents(eventScope(context), events)
  }

  return result
}

/**
 * Notes go with it (`on delete cascade`). Strategy boards do not, unless this
 * was the board's last remaining link — see the cleanup below.
 *
 * A board can now be shared by more than one prospect, so a plain cascading
 * delete would wipe a board still in use by others the moment any one of them
 * is removed. Instead: read which boards this opportunity links to, delete
 * the opportunity (cascading its own link row), then delete only the boards
 * that read has left with zero remaining links — the common case (a board
 * used by exactly one prospect) still disappears with it, same as before.
 *
 * Every step is scoped to the caller's organization. The composite foreign
 * keys already make a cross-organization link impossible, so the filter on
 * the link reads changes nothing for a real row — it is there so the reads
 * and the writes describe the same set, and a guessed id from outside the
 * organization sees no boards and deletes nothing.
 */
export async function deleteOpportunity(id: string): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const context = await requireAuth()

  const { data: links } = await getSupabase()
    .from('strategy_board_opportunities')
    .select('board_id')
    .eq('opportunity_id', id)
    .eq('organization_id', context.organizationId)
  const boardIds = [...new Set((links ?? []).map((l) => l.board_id as string))]

  const result = await run(
    'opportunities',
    async () =>
      getSupabase()
        .from('opportunities')
        .delete()
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
  if (!result.ok || boardIds.length === 0) return result

  const { data: stillLinked } = await getSupabase()
    .from('strategy_board_opportunities')
    .select('board_id')
    .in('board_id', boardIds)
    .eq('organization_id', context.organizationId)
  const stillLinkedIds = new Set((stillLinked ?? []).map((l) => l.board_id as string))
  const orphanedIds = boardIds.filter((boardId) => !stillLinkedIds.has(boardId))

  if (orphanedIds.length > 0) {
    // Failing here must not turn a successful prospect deletion into a
    // reported failure — an orphaned board left behind is a cleanup gap, not
    // a lost edit, and the next visit to a board sharing none of its links
    // never surfaces it again anyway.
    const cleanup = await run(
      'strategy_boards',
      async () =>
        getSupabase()
          .from('strategy_boards')
          .delete()
          .in('id', orphanedIds)
          .eq('organization_id', context.organizationId)
          .select('id'),
      'row'
    )
    if (!cleanup.ok) {
      console.error('[khyte] orphaned strategy board cleanup failed:', cleanup.error)
    }
  }

  return result
}

// --- leads -------------------------------------------------------------

export async function createLead(lead: Lead): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  // Same request-cached context as run() resolves; see createOpportunity.
  const context = await requireAuth()

  const result = await run('leads', async () =>
    getSupabase()
      .from('leads')
      .insert({ ...toLeadInsert(lead), organization_id: context.organizationId })
  )

  // Counted for the week's non-negotiables. Recorded rather than derived from
  // leads.created_at because a lead promoted to a Prospect is deleted, and
  // "we added 9 leads this week" must survive that.
  if (result.ok) {
    await recordEvents(eventScope(context), [
      {
        kind: 'lead_added',
        subjectId: lead.id,
        colleague: lead.followedUpBy,
        detail: { companyName: lead.companyName },
      },
    ])
  }

  return result
}

export async function updateLead(
  id: string,
  updates: Partial<Lead>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toLeadUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run(
    'leads',
    async (context) =>
      getSupabase()
        .from('leads')
        .update(payload)
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

export async function deleteLead(id: string): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run(
    'leads',
    async (context) =>
      getSupabase()
        .from('leads')
        .delete()
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

// --- notes -----------------------------------------------------------------

export async function createNote(note: Note): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('notes', async (context) =>
    getSupabase()
      .from('notes')
      .insert({ ...toNoteInsert(note), organization_id: context.organizationId })
  )
}

export async function updateNote(
  id: string,
  updates: Partial<Note>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toNoteUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run(
    'notes',
    async (context) =>
      getSupabase()
        .from('notes')
        .update(payload)
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

export async function deleteNote(id: string): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run(
    'notes',
    async (context) =>
      getSupabase()
        .from('notes')
        .delete()
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

// --- strategy boards ---------------------------------------------------------

export async function createStrategyBoard(board: StrategyBoard): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('strategy_boards', async (context) =>
    getSupabase()
      .from('strategy_boards')
      .insert({ id: board.id, organization_id: context.organizationId })
  )
}

/**
 * Idempotent: two clicks on the same checkbox, or a retried write, must not
 * insert the same link twice and fail on the table's primary key.
 *
 * The link row carries the organization too, and its foreign keys are
 * composite on (board, organization) and (prospect, organization) — so a
 * board id and a prospect id that do not both live in the caller's
 * organization are rejected by the database, not merely unfiltered.
 */
export async function linkOpportunityToBoard(
  boardId: string,
  opportunityId: string
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('strategy_board_opportunities', async (context) =>
    getSupabase()
      .from('strategy_board_opportunities')
      .upsert(
        {
          board_id: boardId,
          opportunity_id: opportunityId,
          organization_id: context.organizationId,
        },
        { onConflict: 'board_id,opportunity_id', ignoreDuplicates: true }
      )
  )
}

export async function unlinkOpportunityFromBoard(
  boardId: string,
  opportunityId: string
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run(
    'strategy_board_opportunities',
    async (context) =>
      getSupabase()
        .from('strategy_board_opportunities')
        .delete()
        .eq('board_id', boardId)
        .eq('opportunity_id', opportunityId)
        .eq('organization_id', context.organizationId)
        .select('board_id'),
    'row'
  )
}

/** Columns and cards go with it (`on delete cascade`). Only ever called from
 * the orphan cleanup in deleteOpportunity — a board is never deleted directly
 * from the UI, only by unlinking every prospect from it. */
export async function deleteStrategyBoard(id: string): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run(
    'strategy_boards',
    async (context) =>
      getSupabase()
        .from('strategy_boards')
        .delete()
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

// --- strategy headlines ----------------------------------------------------

export async function createStrategyColumn(
  column: StrategyColumn
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('strategy_columns', async (context) =>
    getSupabase()
      .from('strategy_columns')
      .insert({ ...toStrategyColumnInsert(column), organization_id: context.organizationId })
  )
}

export async function updateStrategyColumn(
  id: string,
  updates: Partial<StrategyColumn>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toStrategyColumnUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run(
    'strategy_columns',
    async (context) =>
      getSupabase()
        .from('strategy_columns')
        .update(payload)
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

/** The deal's cards under this headline go with it (`on delete cascade`). */
export async function deleteStrategyColumn(id: string): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run(
    'strategy_columns',
    async (context) =>
      getSupabase()
        .from('strategy_columns')
        .delete()
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

// --- strategy cards --------------------------------------------------------

export async function createStrategyCard(
  card: StrategyCard
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('strategy_cards', async (context) =>
    getSupabase()
      .from('strategy_cards')
      .insert({ ...toStrategyCardInsert(card), organization_id: context.organizationId })
  )
}

export async function updateStrategyCard(
  id: string,
  updates: Partial<StrategyCard>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toStrategyCardUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run(
    'strategy_cards',
    async (context) =>
      getSupabase()
        .from('strategy_cards')
        .update(payload)
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

export async function deleteStrategyCard(id: string): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run(
    'strategy_cards',
    async (context) =>
      getSupabase()
        .from('strategy_cards')
        .delete()
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

// --- tasks -----------------------------------------------------------------

export async function createTask(task: Task): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run('tasks', async (context) =>
    getSupabase()
      .from('tasks')
      .insert({ ...toTaskInsert(task), organization_id: context.organizationId })
  )
}

export async function updateTask(
  id: string,
  updates: Partial<Task>
): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  const payload = toTaskUpdate(updates)
  if (Object.keys(payload).length === 0) return guardedOk()
  return run(
    'tasks',
    async (context) =>
      getSupabase()
        .from('tasks')
        .update(payload)
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}

/**
 * Permanent. Reserved for tasks created in error — anything worth keeping in
 * the record should be archived instead.
 */
export async function deleteTask(id: string): Promise<ActionResult> {
  if (skipUnconfigured()) return guardedOk()
  return run(
    'tasks',
    async (context) =>
      getSupabase()
        .from('tasks')
        .delete()
        .eq('id', id)
        .eq('organization_id', context.organizationId)
        .select('id'),
    'row'
  )
}
