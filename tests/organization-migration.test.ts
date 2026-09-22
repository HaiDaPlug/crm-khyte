import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { applyMigrations, finishRollout, readSql } from './support/migrations'

/**
 * Rehearses supabase/migrations/20260920120000_organizations.sql the way it
 * will actually run in production: against a database that already holds
 * rows in every table, shaped exactly as the schema stood the moment before.
 *
 * tests/mcp.test.ts applies every migration to an EMPTY database and then
 * writes through the new code. That proves the end state and says nothing
 * about the backfill — and the backfill is the whole risk. A migration that
 * strands a row, trips over data its foreign-key rebuild did not anticipate,
 * or leaves half its objects behind after a failed attempt is exactly the
 * kind of thing that took this CRM down once before (a migration applied
 * ahead of its code). So this suite seeds the legacy schema, runs the
 * migration, and asserts what the live database will look like afterwards.
 *
 * No .env files, remote database, production credentials, or network access.
 */

const ORGANIZATION_MIGRATION = '20260920120000_organizations.sql'
/** Fixed in the migration so every environment agrees which organization the
 *  existing data belongs to. */
const KHYTE = '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10'

const pg = new PGlite()
const rows = async <T extends Record<string, unknown>>(sql: string, values: unknown[] = []) => (await pg.query<T>(sql, values)).rows
const count = async (table: string) => Number((await rows<{ n: number }>(`select count(*)::int as n from ${table}`))[0].n)
const migration = (file: string) => readSql(`supabase/migrations/${file}`)

/**
 * Every table the migration gives an organization to, except crm_oauth_codes:
 * a code with no person behind it is deleted rather than backfilled, and that
 * is asserted on its own below.
 */
const LEGACY_TABLES = [
  'companies', 'contacts', 'opportunities', 'notes', 'leads',
  'strategy_boards', 'strategy_board_opportunities', 'strategy_columns', 'strategy_cards',
  'tasks', 'goals', 'goal_metrics', 'personal_goals', 'crm_events', 'weekly_snapshots',
  'crm_interactions', 'crm_tool_receipts', 'crm_oauth_connections',
] as const

/** Fixed ids, so every assertion can name the exact row it means. */
const legacy = {
  company: randomUUID(), contact: randomUUID(), opportunity: randomUUID(), note: randomUUID(), task: randomUUID(),
  board: randomUUID(), column: randomUUID(), card: randomUUID(), lead: randomUUID(),
  goal: randomUUID(), metric: randomUUID(), personalGoal: randomUUID(), event: randomUUID(), snapshot: randomUUID(),
  interaction: randomUUID(), receipt: randomUUID(), connection: randomUUID(),
}
const countsBefore: Record<string, number> = {}
/** A second organization. It cannot exist until the rollout follow-up has
 *  run — organizations_rollout_guard refuses it — so the test that applies
 *  that file is the one that creates it, and the isolation tests that need
 *  something for Khyte's rows to be isolated from are declared after it. */
const OTHER = randomUUID()

before(async () => {
  await pg.exec(`create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`)
  // Everything up to, but not including, the migration under rehearsal: the
  // schema exactly as it stood the moment before it ran.
  await applyMigrations(pg, { stopBefore: ORGANIZATION_MIGRATION })

  // One row per table, written the way the pre-organization code wrote them:
  // no organization_id (the column does not exist yet), owner_id null
  // everywhere (it was never populated), plain single-column foreign keys.
  // The task links to both a deal and a company because the migration
  // rebuilds those two keys with different on-delete rules, and the strategy
  // objects follow the post-20260910 shape (board_id / column_id, no
  // opportunity_id) because that is what production holds.
  await pg.query(`insert into companies (id, name, domain) values ($1, 'Nordvik AB', 'nordvik.test')`, [legacy.company])
  await pg.query(`insert into contacts (id, company_id, name, email) values ($1, $2, 'Anna', 'anna@nordvik.test')`, [legacy.contact, legacy.company])
  await pg.query(`insert into opportunities (id, company_id, contact_id, stage, in_pipeline, last_interaction, followed_up_by)
    values ($1, $2, $3, 'Contacted', true, '2026-09-01', 'erik')`, [legacy.opportunity, legacy.company, legacy.contact])
  await pg.query(`insert into notes (id, opportunity_id, company_id, raw) values ($1, $2, $3, 'Called, interested.')`, [legacy.note, legacy.opportunity, legacy.company])
  await pg.query(`insert into tasks (id, title, related_opportunity_id, related_company_id, assignee, due_date)
    values ($1, 'Send the proposal', $2, $3, 'hai', '2026-09-10')`, [legacy.task, legacy.opportunity, legacy.company])
  await pg.query(`insert into strategy_boards (id) values ($1)`, [legacy.board])
  await pg.query(`insert into strategy_board_opportunities (board_id, opportunity_id) values ($1, $2)`, [legacy.board, legacy.opportunity])
  await pg.query(`insert into strategy_columns (id, board_id, title, sort_order) values ($1, $2, 'Pain Points', 0)`, [legacy.column, legacy.board])
  await pg.query(`insert into strategy_cards (id, column_id, content, sort_order) values ($1, $2, 'Manual reporting', 0)`, [legacy.card, legacy.column])
  await pg.query(`insert into leads (id, company_name, followed_up_by, tags) values ($1, 'Fjällvind AB', 'abdi', '{referral}')`, [legacy.lead])
  await pg.query(`insert into goals (id, section, title, metric_kind, metric_target) values ($1, 'weekly', '15 möten', 'meeting_booked', 15)`, [legacy.goal])
  await pg.query(`insert into goal_metrics (id, label, current_value, target_value, unit) values ($1, 'ARR', 100, 1000, 'currency')`, [legacy.metric])
  await pg.query(`insert into personal_goals (id, colleague, title, target_date) values ($1, 'hai', 'Flytta ut', '2026-12-01')`, [legacy.personalGoal])
  await pg.query(`insert into crm_events (id, kind, subject_id, colleague, detail, occurred_at)
    values ($1, 'prospect_contacted', $2, 'erik', '{"backfilled":true}'::jsonb, '2026-09-01T09:00:00+02:00')`, [legacy.event, legacy.opportunity])
  await pg.query(`insert into weekly_snapshots (id, week_start, counts) values ($1, '2026-08-31', '[]'::jsonb)`, [legacy.snapshot])
  await pg.query(`insert into crm_oauth_connections (id, client_id, access_hash, refresh_hash, scopes, access_expires_at, refresh_expires_at)
    values ($1, 'test-chatgpt', 'access-hash', 'refresh-hash', '{crm:read}', now() + interval '1 hour', now() + interval '30 days')`, [legacy.connection])
  await pg.query(`insert into crm_interactions (id, opportunity_id, company_id, contact_id, occurred_on, channel, summary, followed_up_by, connection_id)
    values ($1, $2, $3, $4, '2026-09-01', 'phone', 'Intro call.', 'erik', $5)`, [legacy.interaction, legacy.opportunity, legacy.company, legacy.contact, legacy.connection])
  await pg.query(`insert into crm_tool_receipts (request_id, action, payload_hash, connection_id, result)
    values ($1, 'log_outreach', 'payload-hash', $2, '{"status":"saved"}'::jsonb)`, [legacy.receipt, legacy.connection])
  await pg.query(`insert into crm_oauth_codes (code_hash, client_id, redirect_uri, challenge, scopes, resource, expires_at)
    values ('code-hash', 'test-chatgpt', 'https://chatgpt.com/connector_platform_oauth_redirect', 'challenge', '{crm:read}', 'https://crm.example.test/mcp', now() + interval '5 minutes')`)

  for (const table of LEGACY_TABLES) countsBefore[table] = await count(table)
  countsBefore.crm_oauth_codes = await count('crm_oauth_codes')
})
after(async () => { await pg.close() })

test('a failed attempt leaves nothing behind, so the migration can simply be run again', async () => {
  const sql = await migration(ORGANIZATION_MIGRATION)
  // `supabase db push` runs a migration file inside a transaction: one
  // statement failing half-way rolls the whole file back. Rehearse exactly
  // that — apply it inside a transaction that is then aborted — and check the
  // database is as it was, with no table, type, column or function left over
  // that would make the real run trip on "already exists".
  await assert.rejects(pg.transaction(async tx => { await tx.exec(sql); throw new Error('rehearsal: roll it back') }), /rehearsal/)
  assert.equal((await rows<{ t: string | null }>("select to_regclass('public.organizations') as t"))[0].t, null)
  assert.equal((await rows("select 1 from pg_type where typname in ('org_member_role', 'org_member_status')")).length, 0)
  assert.equal((await rows("select 1 from information_schema.columns where table_name = 'companies' and column_name = 'organization_id'")).length, 0)
  assert.equal((await rows("select 1 from pg_proc where proname = 'is_org_member'")).length, 0)
  assert.equal((await rows("select 1 from pg_constraint where conname = 'companies_id_organization_key'")).length, 0)
  // The rollout guard is created without `if not exists`, so a leftover from
  // a half-applied attempt is exactly what would make the re-run fail.
  assert.equal((await rows("select 1 from pg_trigger where tgname = 'organizations_rollout_guard'")).length, 0)
  assert.equal((await rows("select 1 from pg_proc where proname = 'assert_rollout_finished'")).length, 0)
  await pg.exec(sql)
  assert.ok((await rows<{ t: string | null }>("select to_regclass('public.organizations') as t"))[0].t)
})

test('every existing row now belongs to Khyte, and none was lost or duplicated', async () => {
  const [khyte] = await rows<{ name: string; slug: string }>('select name, slug from organizations where id = $1', [KHYTE])
  assert.deepEqual(khyte, { name: 'Khyte', slug: 'khyte' })
  for (const table of LEGACY_TABLES) {
    const [after] = await rows<{ n: number; khyte: number }>(
      `select count(*)::int as n, (count(*) filter (where organization_id = $1))::int as khyte from ${table}`, [KHYTE])
    assert.equal(Number(after.n), countsBefore[table], `${table}: row count changed`)
    assert.equal(Number(after.khyte), countsBefore[table], `${table}: a row does not belong to Khyte`)
  }
  // Nobody was invented. Which email is Erik and which is Abdi is a fact only
  // the team knows, so the migration creates no accounts and no memberships.
  assert.equal(await count('organization_members'), 0)
  assert.equal(await count('auth.users'), 0)
})

test('the shared-password MCP connection is revoked; its receipts and interactions stay as history', async () => {
  const [connection] = await rows<{ revoked_at: string | null; user_id: string | null }>(
    'select revoked_at, user_id from crm_oauth_connections where id = $1', [legacy.connection])
  assert.ok(connection.revoked_at, 'a connection with no person behind it must not stay authorized')
  assert.equal(connection.user_id, null)
  // Codes live five minutes; a personless one is simply gone rather than
  // carried into a world where every code names who approved it.
  assert.equal(countsBefore.crm_oauth_codes, 1)
  assert.equal(await count('crm_oauth_codes'), 0)
  assert.equal((await rows('select 1 from crm_tool_receipts where request_id = $1 and connection_id = $2', [legacy.receipt, legacy.connection])).length, 1)
  assert.equal((await rows('select 1 from crm_interactions where id = $1 and connection_id = $2', [legacy.interaction, legacy.connection])).length, 1)
})

/**
 * Declared before every test that needs a second organization, because until
 * this one has run there cannot be one: the guard refuses it. It is also the
 * test that finishes the rollout, so everything below runs against a database
 * with no default left to hide a forgotten organization_id.
 */
test('the rollout guard holds until the follow-up runs, and then the aids, the guard and the old week index are gone', async () => {
  // Both week indexes stand while the rollout is in flight. The new code's
  // upsert names (organization_id, week_start); the code still deployed as
  // this migration lands names (week_start), and Postgres refuses an
  // `on conflict` whose columns match no unique index (42P10) — so the weekly
  // archive would be skipped for any week ending inside the deploy window.
  const weekIndexes = await rows<{ indexname: string; indexdef: string }>(
    "select indexname, indexdef from pg_indexes where tablename = 'weekly_snapshots' and indexname like '%week_idx'")
  const old = weekIndexes.find(i => i.indexname === 'weekly_snapshots_week_idx')
  const scoped = weekIndexes.find(i => i.indexname === 'weekly_snapshots_org_week_idx')
  assert.ok(old, 'the old conflict target survives the migration, because the running code still names it')
  assert.match(old.indexdef, /CREATE UNIQUE INDEX .* \(week_start\)/)
  assert.ok(scoped, 'the new one is what archiveFinishedWeeks names')
  assert.match(scoped.indexdef, /CREATE UNIQUE INDEX .* \(organization_id, week_start\)/)

  const defaults = async () => Number((await rows<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
     where table_schema = 'public' and column_name = 'organization_id' and column_default is not null`))[0].n)
  assert.equal(await defaults(), 19, 'every business and integration table still carries the rollout default')

  // While those aids stand, a second organization is not merely unwise: the
  // database refuses it. A forgotten insert would land silently in Khyte, and
  // under the old index two organizations could not archive the same week at
  // all. The guard turns both sentences into a rule Postgres keeps — which
  // finishRollout asserts before applying step 5 of the deploy order, from
  // wherever the cleanup currently lives (see tests/support/migrations.ts).
  await finishRollout(pg, OTHER)
  assert.equal(await count('organizations'), 1, 'the refused organization left nothing behind')
  assert.equal(await defaults(), 0, 'a forgotten organization_id is now a not-null violation, not a silent Khyte row')
  assert.equal((await rows("select 1 from pg_indexes where indexname = 'weekly_snapshots_week_idx'")).length, 0)
  assert.equal((await rows("select 1 from pg_trigger where tgname = 'organizations_rollout_guard'")).length, 0)
  assert.equal((await rows("select 1 from pg_proc where proname = 'assert_rollout_finished'")).length, 0)

  // Only now can a second organization exist — and archive the same week as
  // Khyte, which the old single-column index made impossible.
  await pg.query(`insert into organizations (id, name, slug) values ($1, 'Other AB', 'other')`, [OTHER])
  const [existing] = await rows<{ week_start: string }>('select week_start::text as week_start from weekly_snapshots where id = $1', [legacy.snapshot])
  await pg.query('insert into weekly_snapshots (organization_id, week_start) values ($1, $2)', [OTHER, existing.week_start])
  // … while the same organization still cannot archive a week twice, which
  // is what archiveFinishedWeeks' "on conflict do nothing" relies on.
  await assert.rejects(pg.query('insert into weekly_snapshots (organization_id, week_start) values ($1, $2)', [KHYTE, existing.week_start]), /weekly_snapshots_org_week_idx/)
  await pg.query('insert into weekly_snapshots (organization_id, week_start) values ($1, $2) on conflict (organization_id, week_start) do nothing', [KHYTE, existing.week_start])
  assert.equal((await rows('select 1 from weekly_snapshots where organization_id = $1', [KHYTE])).length, 1)
})

test("a record cannot point at another organization's parent, whatever the application forgets", async () => {
  const foreignKey = /violates foreign key constraint/
  await assert.rejects(pg.query(`insert into contacts (company_id, organization_id, name) values ($1, $2, 'Intruder')`, [legacy.company, OTHER]), foreignKey)
  await assert.rejects(pg.query(`insert into opportunities (company_id, contact_id, organization_id) values ($1, $2, $3)`, [legacy.company, legacy.contact, OTHER]), foreignKey)
  await assert.rejects(pg.query(`insert into tasks (title, related_opportunity_id, organization_id) values ('Borrowed deal', $1, $2)`, [legacy.opportunity, OTHER]), foreignKey)
  await assert.rejects(pg.query(`insert into tasks (title, related_company_id, organization_id) values ('Borrowed company', $1, $2)`, [legacy.company, OTHER]), foreignKey)
  await assert.rejects(pg.query(`insert into notes (opportunity_id, organization_id, raw) values ($1, $2, 'x')`, [legacy.opportunity, OTHER]), foreignKey)
  // A fresh Khyte board, so the link's (board, opportunity) primary key is
  // new and it is the composite foreign key that does the refusing.
  const [board] = await rows<{ id: string }>('insert into strategy_boards (organization_id) values ($1) returning id', [KHYTE])
  await assert.rejects(pg.query(`insert into strategy_board_opportunities (board_id, opportunity_id, organization_id) values ($1, $2, $3)`, [board.id, legacy.opportunity, OTHER]), foreignKey)
  await assert.rejects(pg.query(`insert into strategy_columns (board_id, organization_id, title) values ($1, $2, 'x')`, [legacy.board, OTHER]), foreignKey)
  await assert.rejects(pg.query(`insert into strategy_cards (column_id, organization_id, content) values ($1, $2, 'x')`, [legacy.column, OTHER]), foreignKey)
  // The same links within Khyte still work — the composite key is a boundary,
  // not a lock — and the other organization's own records are unaffected.
  await pg.query(`insert into tasks (title, related_opportunity_id, related_company_id, organization_id) values ('Own deal', $1, $2, $3)`, [legacy.opportunity, legacy.company, KHYTE])
  const [company] = await rows<{ id: string }>(`insert into companies (name, organization_id) values ('Other Co', $1) returning id`, [OTHER])
  await pg.query(`insert into contacts (company_id, organization_id, name) values ($1, $2, 'Theirs')`, [company.id, OTHER])
  // Every refused insert above was refused whole, not half-written.
  assert.equal((await rows('select 1 from tasks where organization_id = $1', [OTHER])).length, 0)
  assert.equal((await rows('select 1 from contacts where organization_id = $1', [OTHER])).length, 1)
})

test('deleting a deal unlinks its task without moving the task out of its organization', async () => {
  await pg.query('delete from opportunities where id = $1', [legacy.opportunity])
  const [task] = await rows<{ related_opportunity_id: string | null; related_company_id: string | null; organization_id: string }>(
    'select related_opportunity_id, related_company_id, organization_id from tasks where id = $1', [legacy.task])
  assert.ok(task, 'the task itself survives — only the link goes')
  assert.equal(task.related_opportunity_id, null)
  assert.equal(task.related_company_id, legacy.company, 'the company link is a separate key with its own rule')
  assert.equal(task.organization_id, KHYTE, '`set null (related_opportunity_id)` must never touch organization_id')
  // The rest of the on-delete behaviour is exactly what the single-column
  // keys had: children that cannot outlive a deal cascade, history stays.
  assert.equal((await rows('select 1 from notes where id = $1', [legacy.note])).length, 0, 'notes cascade')
  assert.equal((await rows('select 1 from strategy_board_opportunities where opportunity_id = $1', [legacy.opportunity])).length, 0, 'board links cascade')
  assert.equal((await rows('select 1 from strategy_boards where id = $1', [legacy.board])).length, 1, 'the board outlives the deal; the app cleans up orphans')
  assert.equal((await rows('select 1 from crm_interactions where id = $1', [legacy.interaction])).length, 1, 'interactions survive deletion')
  assert.equal((await rows('select 1 from crm_events where id = $1', [legacy.event])).length, 1, 'the event log is append-only')
})

test('row level security is by membership: is_org_member exists and the owner_id policies are gone', async () => {
  const [fn] = await rows<{ prosecdef: boolean }>("select prosecdef from pg_proc where proname = 'is_org_member'")
  assert.ok(fn, 'is_org_member must exist')
  assert.equal(fn.prosecdef, true, 'security definer, so the check can read organization_members without recursing into that table\'s own policy')
  // With auth.uid() null — the stub above — nobody is a member of anything.
  assert.equal((await rows<{ m: boolean }>('select public.is_org_member($1) as m', [KHYTE]))[0].m, false)
  const policies = await rows<{ tablename: string; policyname: string }>("select tablename, policyname from pg_policies where schemaname = 'public'")
  assert.ok(!policies.some(p => p.policyname.startsWith('owners manage')), 'no policy may still be keyed on owner_id')
  for (const table of ['companies', 'contacts', 'opportunities', 'notes', 'leads', 'tasks', 'goals', 'personal_goals', 'crm_events', 'weekly_snapshots']) {
    assert.ok(policies.some(p => p.tablename === table && p.policyname.startsWith("members manage their organization's")), `${table} needs a membership policy`)
  }
  // owner_id is retired, not dropped: deployed code may still select it, and
  // dropping a column the running query reads is the outage this CRM has had.
  assert.equal((await rows("select 1 from information_schema.columns where table_name = 'companies' and column_name = 'owner_id'")).length, 1)
})
