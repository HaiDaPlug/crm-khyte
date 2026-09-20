import 'server-only'

import { connection } from 'next/server'

import type { AuthContext } from '@/lib/auth/context'
import type { CRMSnapshot, GoalsSnapshot, WeeklyProgress } from '@/lib/types'
import { crmDatabase } from '@/lib/crm/database'
import { loadWorkspace } from '@/lib/org/members'
import { isSupabaseConfigured } from '@/lib/supabase/server'
import { getDb, isDirectDbConfigured } from './pg'
import { isClockSkew, isTransientRead, withRetry } from './retry'
import {
  archiveFinishedWeeks,
  countEventsByColleagueSince,
  countEventsSince,
  loadDerivedTotals,
  weekStart,
} from './board-metrics'
import { mockCompanies } from '@/lib/mock-data/companies'
import { mockContacts } from '@/lib/mock-data/contacts'
import { mockOpportunities } from '@/lib/mock-data/opportunities'
import { mockLeads } from '@/lib/mock-data/leads'
import { mockNotes } from '@/lib/mock-data/notes'
import {
  mockStrategyBoardOpportunities,
  mockStrategyBoards,
  mockStrategyCards,
  mockStrategyColumns,
} from '@/lib/mock-data/strategy'
import { mockTasks } from '@/lib/mock-data/tasks'
import { mockPersonalGoals, mockGoalMetrics, mockGoals } from '@/lib/mock-data/goals'
import {
  fromCompanyRow,
  fromContactRow,
  fromPersonalGoalRow,
  fromGoalMetricRow,
  fromGoalRow,
  fromLeadRow,
  fromNoteRow,
  fromOpportunityRow,
  fromStrategyBoardOpportunityRow,
  fromStrategyBoardRow,
  fromStrategyCardRow,
  fromStrategyColumnRow,
  fromTaskRow,
} from './mappers'
import type {
  CompanyRow,
  ContactRow,
  PersonalGoalRow,
  GoalMetricRow,
  GoalRow,
  LeadRow,
  NoteRow,
  OpportunityRow,
  StrategyBoardOpportunityRow,
  StrategyBoardRow,
  StrategyCardRow,
  StrategyColumnRow,
  TaskRow,
} from './rows'

let warnedAboutMissingConfig = false

/**
 * Reads one organization's entire working set in one pass.
 *
 * The whole CRM is a few hundred rows per workspace, and every screen already
 * reads from one in-memory store, so a single snapshot on boot is both simpler
 * and fewer round-trips than per-route queries. Revisit if a workspace ever
 * grows past a few thousand opportunities.
 *
 * The context, not a bare organization id, is the parameter. The snapshot
 * carries the workspace — organization, viewer, roster — beside the rows, and
 * that needs the viewer the session resolved, not only which organization to
 * filter by. Every query below is scoped to `context.organizationId`, which
 * came from a verified session joined to an active membership (see
 * lib/auth/context.ts); nothing in this module reads a business table without
 * that filter.
 *
 * Without credentials this returns the demo data instead, so the UI still runs
 * on a fresh clone. With credentials, a failed query throws — a configured but
 * broken database should be loud, not silently empty.
 */
export async function loadSnapshot(context: AuthContext): Promise<CRMSnapshot> {
  // Opt out of prerendering. Every caller reaches this after reading the
  // session cookie, which already makes the render dynamic — but that is a
  // caller's side effect, not this function's contract. Without this, a
  // future caller with no request-time API would have Next bake one
  // organization's CRM into static HTML at build time and serve that frozen
  // pipeline to everyone until a redeploy.
  await connection()

  if (!isSupabaseConfigured || !isDirectDbConfigured) {
    if (!warnedAboutMissingConfig) {
      warnedAboutMissingConfig = true
      console.warn(
        '[khyte] No Supabase credentials found — serving in-memory demo data. ' +
          'Changes will not persist. See .env.example to connect a database.'
      )
    }
    return demoSnapshot(context)
  }

  // Reads go straight to Postgres via SUPABASE_DB_URL rather than through
  // PostgREST — see ./pg. That path mints no JWT, so it cannot hit the
  // `JWT issued at future` clock-skew fault ./retry was written to wait out;
  // a misconfigured database still fails immediately, same as before.
  return readSnapshot(context)
}

async function readSnapshot(context: AuthContext): Promise<CRMSnapshot> {
  const sql = getDb()
  const { organizationId } = context

  const [
    workspace,
    companies,
    contacts,
    opportunities,
    leads,
    notes,
    strategyBoards,
    strategyBoardOpportunities,
    strategyColumns,
    strategyCards,
    tasks,
  ] = await withDbErrors('snapshot read', () =>
    Promise.all([
      // The roster rides along with the rows so the chrome and Settings can
      // draw who is here without a second request — see `Workspace` in
      // lib/types. Same retry envelope as the rows: a workspace that loaded
      // without its members would render a sidebar with nobody in it.
      loadWorkspace(crmDatabase(), context),
      sql`select * from companies where organization_id = ${organizationId} order by created_at`,
      sql`select * from contacts where organization_id = ${organizationId} order by created_at`,
      sql`select * from opportunities where organization_id = ${organizationId} order by stage, sort_order`,
      sql`select * from leads where organization_id = ${organizationId} order by created_at desc`,
      sql`select * from notes where organization_id = ${organizationId} order by created_at desc`,
      sql`select * from strategy_boards where organization_id = ${organizationId} order by created_at`,
      sql`select * from strategy_board_opportunities where organization_id = ${organizationId}`,
      sql`select * from strategy_columns where organization_id = ${organizationId} order by board_id, sort_order`,
      sql`select * from strategy_cards where organization_id = ${organizationId} order by sort_order`,
      sql`select * from tasks where organization_id = ${organizationId} order by created_at desc`,
    ])
  )

  return {
    workspace,
    companies: (companies as unknown as CompanyRow[]).map(fromCompanyRow),
    contacts: (contacts as unknown as ContactRow[]).map(fromContactRow),
    opportunities: (opportunities as unknown as OpportunityRow[]).map(fromOpportunityRow),
    leads: (leads as unknown as LeadRow[]).map(fromLeadRow),
    notes: (notes as unknown as NoteRow[]).map(fromNoteRow),
    strategyBoards: (strategyBoards as unknown as StrategyBoardRow[]).map(fromStrategyBoardRow),
    strategyBoardOpportunities: (
      strategyBoardOpportunities as unknown as StrategyBoardOpportunityRow[]
    ).map(fromStrategyBoardOpportunityRow),
    strategyColumns: (strategyColumns as unknown as StrategyColumnRow[]).map(
      fromStrategyColumnRow
    ),
    strategyCards: (strategyCards as unknown as StrategyCardRow[]).map(fromStrategyCardRow),
    tasks: (tasks as unknown as TaskRow[]).map(fromTaskRow),
  }
}

/**
 * Reads one organization's direction board — company goals, scoreboard,
 * everyone's focus.
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
 *
 * Takes an organization id rather than a context because the wallpaper has
 * no session: its organization comes from the display token
 * (lib/auth/display-token.ts), and the page resolves that before calling here.
 * Either way the id has been verified by the time it arrives — a token's HMAC
 * or a session's membership — and is never read from the URL in the clear.
 */
export async function loadGoals(organizationId: string): Promise<GoalsSnapshot> {
  // Same reasoning as loadSnapshot: opt out of prerendering, or the wallpaper
  // would be baked at build time and never change again.
  await connection()

  if (!isSupabaseConfigured || !isDirectDbConfigured) {
    return {
      goals: mockGoals,
      metrics: mockGoalMetrics,
      personalGoals: mockPersonalGoals,
      weeklyCounts: {},
      totals: { revenue: 0, customers: 0, pipeline: 0 },
    }
  }

  const sql = getDb()

  const now = new Date()

  /**
   * Close out any week that has ended before counting this one.
   *
   * There is no scheduler in this app, and the wallpaper reloading all day is a
   * more dependable trigger than one would be: the first load after Monday
   * midnight freezes the week that just finished. Failing to archive must not
   * take the board down with it — a missing history row is worth far less than
   * the board itself — so this is caught and logged rather than thrown.
   */
  try {
    await archiveFinishedWeeks(organizationId, now)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    console.error('[khyte] weekly archive skipped:', message)
  }

  // The counted numbers are read in the same pass as the rows they belong to,
  // so a goal and its count always describe the same instant.
  const [goals, metrics, personalGoals, weeklyCounts, totals] =
    await withDbErrors('goals read', () =>
      Promise.all([
        sql`select * from goals where organization_id = ${organizationId} order by section, sort_order`,
        sql`select * from goal_metrics where organization_id = ${organizationId} order by sort_order`,
        sql`select * from personal_goals where organization_id = ${organizationId} order by colleague, sort_order`,
        // Every kind, meeting_booked included, counted from the event log
        // within this week — see the header on ./board-metrics for why that
        // one moved back here from a stage-occupancy count.
        countEventsSince(organizationId, weekStart(now)),
        loadDerivedTotals(organizationId),
      ])
    )

  return {
    goals: (goals as unknown as GoalRow[]).map(fromGoalRow),
    metrics: (metrics as unknown as GoalMetricRow[]).map(fromGoalMetricRow),
    personalGoals: (personalGoals as unknown as PersonalGoalRow[]).map(fromPersonalGoalRow),
    weeklyCounts,
    totals,
  }
}

/**
 * Just the weekly non-negotiables and their counts, for the progress cards the
 * CRM pages show.
 *
 * Deliberately not `loadGoals()`. That reads three tables plus the derived
 * revenue/customers/pipeline totals, and a card on /leads needs exactly one of
 * those things — the `weekly` goals and the counts they resolve against. It is
 * also not folded into `loadSnapshot()`: that runs in the root layout on every
 * page load, and most pages have no progress card to feed.
 *
 * `archiveFinishedWeeks` is *not* called here, unlike in loadGoals. Closing out
 * a finished week is a write, and the polling that keeps these cards fresh
 * would otherwise fire it from every open CRM tab several times a minute. The
 * wallpaper and /goals already trigger it, which is enough — this read stays a
 * read.
 *
 * Also returns today's counts, for the day card that sits beside the weekly
 * one. Same event log, narrower window, and no target — see `WeeklyProgress.today`.
 */
export async function loadWeeklyProgress(organizationId: string): Promise<WeeklyProgress> {
  await connection()

  if (!isSupabaseConfigured || !isDirectDbConfigured) {
    return {
      goals: mockGoals.filter((g) => g.section === 'weekly'),
      counts: {},
      today: {},
      byColleague: {},
      todayByColleague: {},
    }
  }

  const sql = getDb()

  const now = new Date()
  // Local midnight, matching how weekStart() and isoDate() treat a day — the
  // day counter and the week counter have to agree on where a day begins, or a
  // late-evening call lands in today's tally and last week's total.
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)

  // Every kind comes from the event log now, meeting_booked included — see the
  // header on ./board-metrics. "Today" and "this week" are therefore genuinely
  // different windows for it, where they used to be the same stage-occupancy
  // number printed twice.
  const [goals, counts, today, byColleague, todayByColleague] =
    await withDbErrors('weekly progress read', () =>
      Promise.all([
        sql`select * from goals where organization_id = ${organizationId} and section = 'weekly' order by sort_order`,
        countEventsSince(organizationId, weekStart(now)),
        countEventsSince(organizationId, dayStart),
        countEventsByColleagueSince(organizationId, weekStart(now)),
        countEventsByColleagueSince(organizationId, dayStart),
      ])
  )

  return {
    goals: (goals as unknown as GoalRow[]).map(fromGoalRow),
    counts,
    today,
    byColleague,
    todayByColleague,
  }
}

/**
 * A stamp that changes whenever anything on one organization's direction
 * board changes.
 *
 * This is the cheap half of the wallpaper's update loop. Reloading the whole
 * page every few seconds to find out whether anything moved is wasteful; asking
 * this instead costs one indexed aggregate per table and a few bytes on the
 * wire, so the board can check often and reload only when there is something to
 * see.
 *
 * WHY NOT SUPABASE REALTIME. It would be the obvious answer and it is already
 * installed, but Realtime enforces RLS, and no browser holds anything RLS
 * could evaluate. The policies on these tables are membership-shaped now
 * (`is_org_member`, see 20260920120000_organizations.sql) — but the app mints
 * its own session cookie after Supabase Auth verifies the password, and no
 * Supabase JWT ever reaches the browser. A subscriber holding only the
 * publishable key connects as `anon`, `auth.uid()` is null, and it receives
 * nothing. Making it work would mean either shipping a per-user Supabase
 * session to the client or granting `anon` SELECT on the goals tables — and
 * since the publishable key ships in the browser bundle, the second would put
 * every organization's goals and revenue on the public internet. Revisit if
 * the browser ever carries a Supabase session of its own, at which point
 * Realtime works as designed and this function can go.
 *
 * `max(updated_at)` rather than a row count: an edit to an existing goal is the
 * common case and would not change a count. The `set_updated_at` triggers from
 * the init migration are what make this reliable — every table here has one.
 *
 * Deletes are the one gap. Removing a row lowers no timestamp, so a board whose
 * only change was a deletion will not notice until the slow fallback reload.
 * Counting rows alongside the timestamp closes that, which is why the count is
 * folded into the stamp below.
 *
 * Every branch of the union is filtered by organization, not the union as a
 * whole — it has no organization column of its own to filter on. A stamp that
 * moved on another workspace's edit would make this board reload for nothing,
 * and the row count would say how busy that other workspace is.
 */
export async function loadGoalsVersion(organizationId: string): Promise<string> {
  await connection()

  // Without a database the board is rendering demo data that never changes, so
  // a constant stamp is the honest answer — the client then never reloads.
  if (!isSupabaseConfigured || !isDirectDbConfigured) return 'demo'

  const sql = getDb()

  const [row] = await withDbErrors(
    'goals version read',
    () => sql`
      select
        coalesce(max(updated_at)::text, '') as stamp,
        count(*)                            as total
      from (
        select updated_at from goals where organization_id = ${organizationId}
        union all
        select updated_at from goal_metrics where organization_id = ${organizationId}
        union all
        select updated_at from personal_goals where organization_id = ${organizationId}
        union all
        -- Activity changes the counted numbers on the board just as much as
        -- editing a goal does, so it has to move the stamp too.
        select occurred_at as updated_at from crm_events where organization_id = ${organizationId}
      ) as board
    `
  )

  const { stamp, total } = row as unknown as { stamp: string; total: string | number }
  return `${stamp}:${total}`
}

/**
 * A stamp that changes whenever anything in one organization's CRM working
 * set changes.
 *
 * The same trick loadGoalsVersion() plays for the wallpaper, aimed at the other
 * half of the app. The working set is read once per full page load and then
 * lives in the client store for the rest of the session (see lib/store), so
 * until now a write by one colleague stayed invisible to the other two until
 * somebody happened to reload. Polling this lets a browser find out that
 * something moved without dragging all eight tables across the wire to
 * discover that nothing did.
 *
 * WHY NOT SUPABASE REALTIME. Unchanged from the reasoning on loadGoalsVersion()
 * above, and it applies with more force here: the browser holds no Supabase
 * session for the membership policies to evaluate, so a Realtime subscriber is
 * `anon` and receives nothing, and opening these tables to `anon` would put
 * every organization's pipeline on the public internet. The policies
 * themselves are ready — membership-scoped, so all of an organization's
 * members see the same pipeline — it is the client-side session that does not
 * exist.
 *
 * Same `max(updated_at)` + `count(*)` construction, for the same two reasons:
 * editing a row does not change a count, and deleting one does not lower a
 * timestamp. Every table below carries a `set_updated_at` trigger — the six
 * from the init migration, `strategy_columns`, `leads` and `strategy_boards`
 * from theirs, and `organization_members` from the organizations migration —
 * so the timestamp half is reliable across all ten.
 * `strategy_board_opportunities` is the one exception: a join row is never
 * updated, only inserted or deleted, so it has no `updated_at` to contribute —
 * its `created_at` covers linking, and unlinking is caught by the `count(*)`
 * half instead, the same way a deletion anywhere else in this query is.
 *
 * `organization_members` is in the union although it is not a working-set
 * table, because the roster travels with the snapshot
 * (`CRMSnapshot.workspace`) and is drawn in the sidebar and in Settings.
 * Without it, an owner adding, renaming or revoking a member would leave every
 * other open browser on the old roster until a full reload — and a revoked
 * member would keep being drawn as present, which is precisely the wrong thing
 * to be stale about. Adding a member changes the count; editing or revoking
 * one bumps `updated_at`; either moves the stamp.
 *
 * Every branch is filtered by organization, for the reason given on
 * loadGoalsVersion(): the union has no column of its own to filter on, and an
 * unscoped branch would both wake every browser here on a stranger's edit and
 * leak how busy that stranger is.
 */
export async function loadSnapshotVersion(organizationId: string): Promise<string> {
  await connection()

  // No database means the store is holding demo data that nothing can change,
  // so a constant stamp is the honest answer and the client never polls.
  if (!isSupabaseConfigured || !isDirectDbConfigured) return 'demo'

  const sql = getDb()

  const [row] = await withDbErrors(
    'snapshot version read',
    () => sql`
      select
        coalesce(max(updated_at)::text, '') as stamp,
        count(*)                            as total
      from (
        select updated_at from companies where organization_id = ${organizationId}
        union all
        select updated_at from contacts where organization_id = ${organizationId}
        union all
        select updated_at from opportunities where organization_id = ${organizationId}
        union all
        select updated_at from leads where organization_id = ${organizationId}
        union all
        select updated_at from notes where organization_id = ${organizationId}
        union all
        select updated_at from strategy_boards where organization_id = ${organizationId}
        union all
        select created_at as updated_at from strategy_board_opportunities where organization_id = ${organizationId}
        union all
        select updated_at from strategy_columns where organization_id = ${organizationId}
        union all
        select updated_at from strategy_cards where organization_id = ${organizationId}
        union all
        select updated_at from tasks where organization_id = ${organizationId}
        union all
        -- The roster ships with the snapshot, so a roster edit has to reach
        -- every open browser the same way a pipeline edit does.
        select updated_at from organization_members where organization_id = ${organizationId}
      ) as working_set
    `
  )

  const { stamp, total } = row as unknown as { stamp: string; total: string | number }
  return `${stamp}:${total}`
}

/**
 * Every read goes through here: transient faults are retried, and whatever
 * survives is relabelled.
 *
 * The retry is what keeps a dropped pooler connection from becoming an error
 * screen. `loadSnapshot()` runs in the root layout, so nothing above it can
 * catch a throw except app/global-error.tsx, which replaces the whole
 * document — a one-second blip and the operator loses the page. Reads are
 * pure, so re-running one costs nothing but the wait, and ./retry caps that at
 * a couple of seconds.
 *
 * Failing loud is unchanged for the cases that meant it. Anything that is not
 * transient — a wrong connection string, an un-migrated database — still
 * throws on the first attempt, and still throws with the diagnostic shape
 * `unwrap` used to give the PostgREST path rather than a bare "connection
 * error".
 */
async function withDbErrors<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await withRetry(label, run, isTransientRead)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)

    // The clock-skew fault this whole module was reworked to avoid is a
    // PostgREST-only failure mode — it cannot happen on this connection. If
    // this text ever appears here, something upstream changed; say so rather
    // than silently mis-attributing it.
    const hint = isClockSkew(message)
      ? 'Unexpected: this is a PostgREST-only fault and this path bypasses PostgREST. ' +
        'See lib/db/pg.ts.'
      : 'Check SUPABASE_DB_URL is right, and that every file in supabase/migrations ' +
        '(through 20260920120000_organizations.sql) has been run on this project.'

    throw new Error(`[khyte] Failed to load snapshot: ${message}. ${hint}`)
  }
}

/**
 * Credential-free fallback so the app is runnable before the DB is set up.
 *
 * The workspace is the context's own organization and viewer with an empty
 * roster: without a database there are no members to list, and inventing some
 * would be demo data pretending to be people.
 */
function demoSnapshot(context: AuthContext): CRMSnapshot {
  return {
    workspace: { organization: context.organization, viewer: context.viewer, members: [] },
    companies: mockCompanies,
    contacts: mockContacts,
    opportunities: mockOpportunities,
    leads: mockLeads,
    notes: mockNotes,
    strategyBoards: mockStrategyBoards,
    strategyBoardOpportunities: mockStrategyBoardOpportunities,
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
  StrategyBoardOpportunityRow,
  StrategyBoardRow,
  StrategyCardRow,
  StrategyColumnRow,
  TaskRow,
}
