import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { Database, Queryable, Row } from '../lib/crm/database'
import type { ColleagueId, MemberRole } from '../lib/types'
import { actionSchemas, calendarDate } from '../lib/crm/contracts'
import { commitAction, previewAction, getRecord, searchRecords, safeError,
  previewBulkOutreach, commitBulkOutreach, getBulkResult } from '../lib/crm/service'
import { createCrmMcpServer } from '../lib/mcp/server'
import { authenticateBearer, exchangeToken, issueCode, revokeToken, validateAuthorization, authorizationMetadata } from '../lib/mcp/oauth'
import { config, hashToken, pkceChallenge, previewToken, readEnvelope, signEnvelope, verifyPreview } from '../lib/mcp/security'
import { checkOrigin, readBody } from '../lib/mcp/http'
import { loginReturnTo } from '../lib/auth/return-to'
import { SESSION_MAX_AGE, hashSessionToken, mintSession, readSessionCookie } from '../lib/auth/session'
import { resolveAuthContext } from '../lib/auth/context'
import { displayToken, verifyDisplayToken } from '../lib/auth/display-token'
// Only resolveDisplayGrant is exercised: displayOrganization is the Next
// wrapper and reads the session through next/headers, the same reason
// resolveAuthContext rather than getAuthContext is used above.
import { resolveDisplayGrant } from '../lib/auth/display-access'
import { addMember, assertCanAddMember, hasActiveMembershipElsewhere, revokeConnectionsForUser,
  revokeMember, revokeSessionsForUser, updateMember } from '../lib/org/members'
import { register } from '../instrumentation'
import { exportProspects, EXPORT_ROWS_BYTES } from '../lib/mcp/export'
import { EXPORT_GROUPS } from '../lib/mcp/export-schema'
import { exportProspectsSchema } from '../lib/crm/contracts'

// No .env files, remote database, production credentials, or network access.
process.env.MCP_PUBLIC_URL = 'https://crm.example.test'
process.env.MCP_SECRET = 'test-only-signing-secret-with-at-least-32-characters'
process.env.MCP_CLIENT_ID = 'test-chatgpt'
process.env.MCP_CLIENT_SECRET = 'test-only-client-secret-with-at-least-32-characters'
process.env.MCP_REDIRECT_URIS = 'https://chatgpt.com/connector_platform_oauth_redirect'
// Session signing reads AUTH_SECRET at call time (lib/auth/session.ts), the
// same way config() reads the MCP keys above, so it is in place before
// anything mints or verifies a cookie. lib/auth/context imports next/headers
// but nothing here calls cookies(): only the database-backed
// resolveAuthContext is exercised, with the cookie value passed in.
const AUTH_SECRET = 'test-only-session-secret-with-at-least-32-characters'
process.env.AUTH_SECRET = AUTH_SECRET
// Wallpaper tokens read DISPLAY_SECRET at call time as well (lib/auth/
// display-token.ts), so a link can be minted and verified here without the
// secret ever being one a deployment uses.
process.env.DISPLAY_SECRET = 'test-only-display-secret-with-at-least-32-characters'
process.env.NEXT_RUNTIME = 'nodejs'
register()
const pg = new PGlite()
const wrap = (client: Pick<PGlite, 'query'>): Queryable => ({ async query<T extends Row>(sql: string, values: unknown[] = []) { return (await client.query<T>(sql, values)).rows } })
const db: Database = { ...wrap(pg), transaction: run => pg.transaction(tx => run(wrap(tx))) }
// Two organizations. Khyte is created by the migration itself, under a fixed
// id so every environment agrees which organization the existing data belongs
// to; the second is what makes every isolation assertion mean something.
const KHYTE = '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10'
const OTHER_ORG = randomUUID()
// Accounts are rows in the stubbed auth.users; Supabase Auth itself is never
// contacted. An actor is a connection acting as a person in an organization —
// exactly what authenticateBearer hands the tools. The Khyte actor is that
// organization's owner and is mapped to the 'erik' roster label.
const actor = { connectionId: randomUUID(), userId: randomUUID(), organizationId: KHYTE }
const otherActor = { connectionId: randomUUID(), userId: randomUUID(), organizationId: OTHER_ORG }
const identity = { userId: actor.userId, organizationId: actor.organizationId }
const lead = () => ({ requestId: randomUUID(), companyName: `Lead ${randomUUID()}`, followedUpBy: 'abdi' as const, tags: ['referral', 'referral'] })
const task = () => ({ requestId: randomUUID(), title: 'Send the agreed proposal', assignee: 'hai' as const, dueDate: null, tags: ['proposal'] })
const outreach = () => ({ requestId: randomUUID(), target: { kind: 'new' as const, company: { name: `Company ${randomUUID()}` }, contact: { name: 'Anna', email: `${randomUUID()}@example.test` } },
  occurredOn: '2026-08-18', channel: 'email' as const, summary: 'Sent an introduction.', followedUpBy: 'erik' as const, tags: ['outbound'] })
/** For assert.rejects: a CrmError carrying this code. Checked by field rather
 *  than instanceof so a second copy of the class could not fool it. */
const failsWith = (code: string) => (error: unknown) => (error as { code?: unknown } | null)?.code === code

/** An account in the stubbed auth schema plus its membership — what an owner
 *  adding a teammate produces, minus GoTrue. */
async function member(organizationId: string, input: { userId?: string; role?: MemberRole; colleague?: ColleagueId | null; displayName?: string } = {}) {
  const userId = input.userId ?? randomUUID(), email = `${userId.slice(0, 8)}@example.test`
  await db.query('insert into auth.users (id, email) values ($1, $2)', [userId, email])
  const row = await addMember(db, { organizationId, userId, email, displayName: input.displayName ?? 'Testperson', role: input.role ?? 'member', colleague: input.colleague ?? null })
  return { userId, email, memberId: row.id }
}

/** What app/actions/auth.ts does once a password checks out: mint a session
 *  and store only the token's keyed hash. */
async function login(userId: string, organizationId: string) {
  const minted = mintSession()
  await db.query('insert into app_sessions (user_id, organization_id, token_hash, expires_at) values ($1, $2, $3, $4)',
    [userId, organizationId, hashSessionToken(minted.token), minted.expiresAt.toISOString()])
  return minted
}

test('server initialization uses Stockholm day boundaries in winter, summer and DST transitions', () => {
  assert.equal(new Date(2026, 0, 15).toISOString(), '2026-01-14T23:00:00.000Z')
  assert.equal(new Date(2026, 6, 15).toISOString(), '2026-07-14T22:00:00.000Z')
  assert.equal(new Date(2026, 2, 30).toISOString(), '2026-03-29T22:00:00.000Z')
  assert.equal(new Date(2026, 9, 26).toISOString(), '2026-10-25T23:00:00.000Z')
})

before(async () => {
  await pg.exec(`create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`)
  const files = (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()
  for (const file of files) {
    // gen_random_uuid is built into modern Postgres; PGlite does not bundle pgcrypto.
    const sql = (await readFile(`supabase/migrations/${file}`, 'utf8')).replace('create extension if not exists pgcrypto;', '')
    await pg.exec(sql)
  }
  // The organization migration leaves the rollout aids standing: the Khyte id
  // as a default on every organization_id column, and the old single-column
  // week index. Both are only safe while Khyte is the only organization, and
  // organizations_rollout_guard makes that a rule the database keeps rather
  // than a sentence in a document — a second organization is refused until
  // the follow-up has dropped them.
  await assert.rejects(db.query(`insert into organizations (id, name, slug) values ($1, 'Refused AB', 'refused')`, [OTHER_ORG]), /rollout finished/)
  // The follow-up lives outside supabase/migrations/ so `db:push` cannot run
  // it ahead of the code that writes organization_id explicitly — the one
  // ordering this whole arrangement exists to prevent. Applying it here is
  // how this suite reaches the finished state without it being pushed
  // anywhere, and every assertion below therefore runs against a database
  // with no defaults left to hide a forgotten organization_id.
  await pg.exec(await readFile('supabase/followups/20260927120000_drop_organization_rollout.sql', 'utf8'))
  await db.query(`insert into organizations (id, name, slug) values ($1, 'Other AB', 'other')`, [OTHER_ORG])
  await member(KHYTE, { userId: actor.userId, role: 'owner', colleague: 'erik', displayName: 'Erik' })
  await member(OTHER_ORG, { userId: otherActor.userId, role: 'owner', displayName: 'Other Owner' })
})
after(async () => { await pg.close() })

test('export matches the CSV builder, filters contacted stages, and preserves provenance', async () => {
  const saved = await commitAction(db, 'log_outreach', { ...outreach(), stage: 'Lost' }, actor)
  const id = (saved.record as Row).id as string
  await db.query('delete from crm_events where subject_id=$1', [id])
  for (const kind of ['prospect_contacted', 'meeting_booked']) {
    await db.query("insert into crm_events (organization_id, kind, subject_id, detail, occurred_at) values ($1,$2::crm_event_kind,$3,'{\"backfilled\":true}'::jsonb,'2026-08-18T00:00:00+02:00')", [KHYTE, kind, id])
  }
  const page = await exportProspects(db, { stages: ['Lost'], fields: ['dates', 'intervals', 'written', 'history'], asOf: '2026-09-10' }, actor)
  const row = page.rows.find(row => row.prospectId === id)!
  assert.ok(row)
  assert.equal(row.firstContactSource, 'backfilled')
  assert.equal(row.meetingBookedSource, 'backfilled')
  assert.equal(row.historyQuality, 'backfilled')
  assert.equal(row.eventDayCount, '1')
  assert.equal(row.daysContactedToMeeting, undefined)
  assert.equal(row.exportedOn, '2026-09-10')
  assert.equal(row.noteCount, '1')
  assert.ok(row.noteHistory)
  const defaults = await exportProspects(db, { stages: ['Lost'] }, actor)
  assert.equal(defaults.rows.find(row => row.prospectId === id)?.noteHistory, undefined)
  assert.equal((await exportProspects(db, { stages: ['New'] }, actor)).rows.length, 0)
  assert.equal((await exportProspects(db, { stages: ['Lost'], contactedSince: '2026-09-01', countOnly: true }, actor)).total, 0)

  const { buildExportRows } = await import('../lib/export-prospects')
  const { fromOpportunityRow, fromCompanyRow, fromContactRow } = await import('../lib/db/mappers')
  const [opp] = await db.query('select *, last_interaction::text as last_interaction, follow_up_date::text as follow_up_date from opportunities where id=$1', [id])
  const [company] = await db.query('select * from companies where id=$1', [opp.company_id])
  const [contact] = await db.query('select * from contacts where id=$1', [opp.contact_id])
  const [csv] = buildExportRows([{ opportunity: fromOpportunityRow(opp as never), company: fromCompanyRow(company as never), contact: fromContactRow(contact as never) }], { colleagueName: () => 'Erik', today: new Date(2026, 8, 10) })
  assert.equal(row.company, csv.company)
  assert.equal(row.lastContacted, csv.lastContacted)
  assert.equal(row.daysSinceContact, csv.daysSinceContact)
})

test('export cursor survives tied dates and edits without skipping remaining records', async () => {
  for (let i = 0; i < 5; i++) await commitAction(db, 'log_outreach', outreach(), actor)
  const before = await db.query('select id from opportunities where stage <> \'New\' order by id')
  const seen: string[] = []
  let cursor: string | undefined
  do {
    const result = await exportProspects(db, { limit: 2, cursor, fields: ['identity'] }, actor)
    seen.push(...result.rows.map(row => String(row.prospectId)))
    cursor = result.nextCursor as string | undefined
    if (seen.length === 2) await db.query("update opportunities set last_interaction='2026-09-10' where id > $1", [cursor])
  } while (cursor)
  assert.deepEqual(seen, before.map(row => row.id))
  assert.equal(new Set(seen).size, seen.length)
})

test('export bounds output, reports history failures, and validates inputs', async () => {
  const saved = await commitAction(db, 'log_outreach', outreach(), actor)
  const id = (saved.record as Row).id
  await db.query('update opportunities set notes=$1 where id=$2', ['å'.repeat(10000), id])
  const snapshots = await db.query('select (select count(*) from opportunities) as prospects, (select count(*) from crm_tool_receipts) as receipts')
  const all = await exportProspects(db, { limit: 60, fields: ['written', 'history'] }, actor)
  assert.ok(Buffer.byteLength(JSON.stringify(all.rows)) <= EXPORT_ROWS_BYTES)
  const row = all.rows.find(row => row.prospectId === id)
  assert.ok(row?.truncatedFields && (row.truncatedFields as string[]).includes('notes'))
  assert.equal((row.notes as string).length, 600)
  const degraded = await exportProspects({ query: async (sql, values) => {
    if (sql.includes('from crm_events')) throw new Error('unavailable')
    return db.query(sql, values)
  } }, {}, actor)
  assert.equal(degraded.historyAvailable, false)
  assert.ok(degraded.rows.length)
  assert.deepEqual(await db.query('select (select count(*) from opportunities) as prospects, (select count(*) from crm_tool_receipts) as receipts'), snapshots)
  assert.equal(exportProspectsSchema.safeParse({ limit: 500 }).success, false)
  assert.equal(exportProspectsSchema.safeParse({ fields: ['unknown'] }).success, false)
  assert.equal(exportProspectsSchema.safeParse({ cursor: 'bad' }).success, false)
  assert.equal(exportProspectsSchema.safeParse({ contactedSince: '2026-02-30' }).success, false)
  assert.ok(EXPORT_GROUPS.dates.includes('firstContactDate') && EXPORT_GROUPS.dates.includes('firstContactSource'))
  assert.ok(EXPORT_GROUPS.dates.includes('meetingBookedDate') && EXPORT_GROUPS.dates.includes('meetingBookedSource'))
  const countOnly = await exportProspects({ query: async (sql, values) => {
    assert.ok(sql.startsWith('select count'))
    return db.query(sql, values)
  } }, { countOnly: true }, actor)
  assert.equal(countOnly.rows.length, 0)
  await assert.rejects(exportProspects({ query: async () => { throw new Error('database unavailable') } }, {}, actor), /database unavailable/)
})

test('export tool and schema resource require crm:read', async () => {
  const server = createCrmMcpServer(db, { ...actor, scopes: [] })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'export-auth-test', version: '1' })
  await server.connect(st); await client.connect(ct)
  try {
    assert.equal((await client.callTool({ name: 'export_prospects', arguments: {} })).isError, true)
    await assert.rejects(client.readResource({ uri: 'khyte://export-schema' }))
  } finally { await client.close(); await server.close() }
})

test('byte-limited export pages resume after the last emitted row without loss', async () => {
  for (let i = 0; i < 35; i++) {
    const saved = await commitAction(db, 'log_outreach', { ...outreach(), stage: 'Warm', summary: '漢'.repeat(1000) }, actor)
    await db.query('update opportunities set notes=$1, next_step=$1 where id=$2', ['漢'.repeat(2000), (saved.record as Row).id])
  }
  const seen = new Set<string>()
  let cursor: string | undefined
  let pages = 0
  do {
    const result = await exportProspects(db, { stages: ['Warm'], limit: 60, fields: ['written', 'history'], cursor }, actor)
    assert.ok(Buffer.byteLength(JSON.stringify(result.rows)) <= EXPORT_ROWS_BYTES)
    assert.ok(result.rows.length > 0)
    for (const row of result.rows) { assert.ok(!seen.has(String(row.prospectId))); seen.add(String(row.prospectId)) }
    cursor = result.nextCursor as string | undefined
    pages++
  } while (cursor)
  assert.equal(seen.size, 35)
  assert.ok(pages > 1)
})

test('schemas require explicit attribution/assignment, real dates, and reject invented fields', () => {
  assert.equal(calendarDate.safeParse('2026-02-30').success, false)
  assert.equal(actionSchemas.create_lead.safeParse({ companyName: 'Acme', requestId: randomUUID() }).success, false)
  assert.equal(actionSchemas.create_task.safeParse({ ...task(), assignee: 'anna' }).success, false)
  assert.equal(actionSchemas.create_task.safeParse({ ...task(), sendEmail: true }).success, false)
  assert.deepEqual(actionSchemas.create_lead.parse(lead()).tags, ['referral'])
})

test('preview is read-only; lead creation retains tags and credits the named colleague', async () => {
  const a = lead()
  const preview = await previewAction(db, 'create_lead', a, actor)
  assert.equal(preview.status, 'preview')
  assert.equal((await db.query('select id from leads where company_name = $1', [a.companyName])).length, 0)
  const saved = await commitAction(db, 'create_lead', a, actor)
  assert.equal(saved.status, 'saved')
  assert.equal((saved.record as Row).followedUpBy, 'abdi')
  assert.deepEqual((saved.record as Row).tags, ['referral'])
  assert.equal((await db.query('select colleague from crm_events where subject_id = $1', [(saved.record as Row).id]))[0].colleague, 'abdi')
  assert.equal((await commitAction(db, 'create_lead', a, actor)).status, 'already_saved')
  await assert.rejects(commitAction(db, 'create_lead', { ...a, companyName: 'Different' }, actor), /request ID/)
  // The same person, a different connection: a request id belongs to the
  // connection that used it, not to the organization.
  await assert.rejects(commitAction(db, 'create_lead', a, { ...actor, connectionId: randomUUID() }), /request ID/)
  await assert.rejects(commitAction(db, 'create_lead', { ...a, requestId: randomUUID() }, actor), /already exist/)
})

test('creates, reassigns and unassigns tasks without changing other fields; stale versions fail', async () => {
  const saved = await commitAction(db, 'create_task', task(), actor)
  const record = saved.record as Row
  const assigned = await commitAction(db, 'assign_task', { requestId: randomUUID(), taskId: record.id, expectedVersion: saved.version, assignee: 'abdi' }, actor)
  assert.equal((assigned.record as Row).assignee, 'abdi')
  assert.equal((assigned.record as Row).title, record.title)
  assert.equal((assigned.record as Row).dueDate, '')
  assert.deepEqual((assigned.record as Row).tags, ['proposal'])
  await assert.rejects(commitAction(db, 'assign_task', { requestId: randomUUID(), taskId: record.id, expectedVersion: saved.version, assignee: 'erik' }, actor), /record changed/)
  const cleared = await commitAction(db, 'assign_task', { requestId: randomUUID(), taskId: record.id, expectedVersion: assigned.version, assignee: null }, actor)
  assert.equal((cleared.record as Row).assignee, undefined)
})

test('outreach saves linked records and history, keeps owner and latest date, deduplicates messages', async () => {
  const a = { ...outreach(), source: { system: 'gmail', account: 'team@example.test', messageId: randomUUID() } }
  const saved = await commitAction(db, 'log_outreach', a, actor)
  const record = saved.record as Row
  assert.equal(record.stage, 'Contacted')
  assert.equal(record.followedUpBy, 'erik')
  assert.equal((saved.interactions as Row[]).length, 1)
  assert.equal((saved.notes as Row[]).length, 1)
  assert.equal((await commitAction(db, 'log_outreach', a, actor)).status, 'already_saved')
  const older = { requestId: randomUUID(), target: { kind: 'existing', opportunityId: record.id, expectedVersion: saved.version },
    occurredOn: '2026-08-17', channel: 'phone', followedUpBy: 'hai', summary: 'Hai made the earlier call.', tags: ['call'] }
  const updated = await commitAction(db, 'log_outreach', older, actor)
  assert.equal((updated.record as Row).lastInteraction, '2026-08-18')
  assert.equal((updated.record as Row).followedUpBy, 'erik')
  assert.deepEqual((updated.record as Row).tags, ['outbound', 'call'])
  assert.equal((await db.query('select colleague from crm_events where subject_id = $1 order by occurred_at', [record.id]))[0].colleague, 'hai')
  const again = { ...older, requestId: randomUUID(), target: { ...older.target, expectedVersion: updated.version }, occurredOn: a.occurredOn, source: a.source }
  await assert.rejects(commitAction(db, 'log_outreach', again, actor), /already been logged/)
  const sameDay = await commitAction(db, 'log_outreach', { ...again, source: undefined }, actor)
  assert.equal((sameDay.interactions as Row[]).length, 3)
  assert.equal((await db.query('select id from crm_events where subject_id = $1', [record.id])).length, 2)
  const linkedTask = await commitAction(db, 'create_task', { ...task(), relatedOpportunityId: record.id }, actor)
  assert.equal((linkedTask.record as Row).relatedCompanyId, record.companyId)
})

test('transaction failure rolls back company, contact, prospect, note, event and receipt', async () => {
  const a = outreach()
  const failing: Database = { ...db, transaction: run => db.transaction(tx => run({
    async query<T extends Row>(sql: string, values: unknown[] = []) {
      if (sql.startsWith('insert into crm_tool_receipts')) throw new Error('simulated connection failure')
      return tx.query<T>(sql, values)
    },
  })) }
  await assert.rejects(commitAction(failing, 'log_outreach', a, actor), /simulated/)
  assert.equal((await db.query('select id from companies where name = $1', [a.target.company.name])).length, 0)
  assert.equal((await db.query('select request_id from crm_tool_receipts where request_id = $1', [a.requestId])).length, 0)
  assert.equal((await commitAction(db, 'log_outreach', a, actor)).status, 'saved')
})

test('matching blocks company/contact duplicates and task links across companies', async () => {
  const first = await commitAction(db, 'log_outreach', outreach(), actor)
  const second = await commitAction(db, 'log_outreach', outreach(), actor)
  await assert.rejects(commitAction(db, 'create_task', { ...task(), relatedOpportunityId: (first.record as Row).id, relatedCompanyId: (second.record as Row).companyId }, actor), /does not match/)
  const a = outreach()
  await assert.rejects(commitAction(db, 'log_outreach', { ...a, target: { kind: 'new', company: { id: (first.record as Row).companyId }, contact: { id: (second.record as Row).contactId } } }, actor), /different company/)
  await assert.rejects(commitAction(db, 'log_outreach', { ...a, target: { ...a.target, company: { name: (first.company as Row).name } } }, actor), /already exist/)
  const found = await searchRecords(db, { query: (first.company as Row).name, entity: 'prospect' }, actor)
  assert.equal(((found.results[0].matches as Row[])[0].record as Row).id, (first.record as Row).id)
})

test('historical interactions survive deletion without blocking the existing UI delete behavior', async () => {
  const saved = await commitAction(db, 'log_outreach', outreach(), actor)
  await db.query('delete from opportunities where id = $1', [(saved.record as Row).id])
  assert.equal((await db.query('select id from crm_interactions where opportunity_id = $1', [(saved.record as Row).id])).length, 1)
})

test('preview tokens bind action, normalized values, connection and expiry', () => {
  const a = actionSchemas.create_lead.parse(lead())
  const token = previewToken('create_lead', a, actor.connectionId)
  verifyPreview(token, 'create_lead', a, actor.connectionId)
  assert.throws(() => verifyPreview(token, 'create_lead', { ...a, followedUpBy: 'hai' }, actor.connectionId), /differ/)
  assert.throws(() => verifyPreview(token, 'create_lead', a, randomUUID()), /differ/)
  assert.throws(() => readEnvelope(signEnvelope({ purpose: 'preview', expiresAt: Date.now() - 1000 })), /expired/)
  assert.throws(() => readEnvelope(`${token}tampered`), /Invalid/)
})

test('bulk preview classifies rows, applies defaults, and never guesses an existing company', async () => {
  // An existing company with a live deal, so the matcher has something to find.
  const seed = { ...outreach(), target: { kind: 'new' as const, company: { name: 'Nordvik Bulk AB' }, contact: { name: 'Anna', email: 'anna@nordvikbulk.test' } } }
  await commitAction(db, 'log_outreach', seed, actor)

  const batchId = randomUUID()
  const preview = await previewBulkOutreach(db, {
    batchId,
    defaults: { occurredOn: '2026-08-20', channel: 'email', summary: 'Email outreach sent.', followedUpBy: 'hai' },
    records: [
      { ref: 'fresh', companyName: 'Brand New Bulk AB', contactName: 'Bo', email: 'bo@brandnewbulk.test' },
      { ref: 'by-email', companyName: 'Whatever', contactName: 'Anna', email: 'anna@nordvikbulk.test' },
      { ref: 'by-company', companyName: 'Nordvik Bulk AB', contactName: 'Someone Else' },
      { ref: 'no-company', contactName: 'Nobody' },
    ],
  }, actor)

  assert.equal(preview.counts.requested, 4)
  assert.equal(preview.counts.ready, 1)
  assert.equal(preview.counts.ambiguous, 2)
  assert.equal(preview.counts.invalid, 1)

  // Defaults reach the row without being restated per record.
  const ready = preview.ready[0] as Record<string, any>
  assert.equal(ready.ref, 'fresh')
  assert.equal(ready.parameters.occurredOn, '2026-08-20')
  assert.equal(ready.parameters.followedUpBy, 'hai')
  assert.equal(ready.parameters.summary, 'Email outreach sent.')

  // An email hit reports the existing prospect rather than logging against it.
  const byEmail = preview.ambiguous.find(r => (r as Record<string, unknown>).ref === 'by-email') as Record<string, any>
  assert.ok(byEmail.opportunityId, 'email match should return a candidate prospect')
  assert.ok(byEmail.expectedVersion, 'candidate must carry a version for the follow-up commit')

  // A company-name hit is surfaced, never merged.
  const byCompany = preview.ambiguous.find(r => (r as Record<string, unknown>).ref === 'by-company') as Record<string, any>
  assert.match(byCompany.reason, /already has prospects|already exists/)

  assert.equal((preview.invalid[0] as Record<string, unknown>).ref, 'no-company')

  // Preview writes nothing.
  const after = await db.query("select count(*)::int n from companies where name = 'Brand New Bulk AB'")
  assert.equal(after[0].n, 0)
})

test('bulk commit saves ready rows, skips unresolved ones, and replays without duplicating', async () => {
  const batchId = randomUUID()
  const body = {
    batchId,
    defaults: { occurredOn: '2026-08-21', channel: 'email' as const, summary: 'Bulk email sent.', followedUpBy: 'erik' as const },
    records: [
      { ref: 'a', companyName: 'Bulk Commit One AB', contactName: 'Ada', email: 'ada@bulkone.test' },
      { ref: 'b', companyName: 'Bulk Commit Two AB', contactName: 'Bea', email: 'bea@bulktwo.test' },
      { ref: 'bad', contactName: 'Missing Company' },
    ],
    previewToken: 'unused-by-the-service-layer',
  }

  const first = await commitBulkOutreach(db, body, actor)
  assert.equal(first.counts.saved, 2)
  assert.equal(first.counts.newlySaved, 2)
  assert.equal(first.counts.alreadySaved, 0)
  assert.equal(first.counts.skippedInvalid, 1)
  assert.equal(first.counts.failed, 0)

  const created = await db.query("select count(*)::int n from companies where name like 'Bulk Commit%'")
  assert.equal(created[0].n, 2)

  // Replaying the same batch is idempotent: same rows, no new records.
  const second = await commitBulkOutreach(db, body, actor)
  assert.equal(second.counts.saved, 2)
  assert.equal(second.counts.alreadySaved, 2)
  assert.equal(second.counts.newlySaved, 0)
  const afterReplay = await db.query("select count(*)::int n from companies where name like 'Bulk Commit%'")
  assert.equal(afterReplay[0].n, 2, 'replay must not create duplicate companies')

  // Interactions are not duplicated either.
  const interactions = await db.query("select count(*)::int n from crm_interactions where summary = 'Bulk email sent.'")
  assert.equal(interactions[0].n, 2)

  // The receipt trail is retrievable by batchId alone.
  const receipt = await getBulkResult(db, batchId, actor)
  assert.equal(receipt.status, 'found')
  assert.equal(receipt.savedRows, 2)
})

test('a stale version fails only its own row and leaves the rest of the batch saved', async () => {
  const seed = { ...outreach(), target: { kind: 'new' as const, company: { name: 'Stale Row AB' }, contact: { name: 'Cal', email: 'cal@stalerow.test' } } }
  const saved = await commitAction(db, 'log_outreach', seed, actor)
  const opportunityId = String((saved as Record<string, any>).record.id)

  const result = await commitBulkOutreach(db, {
    batchId: randomUUID(),
    defaults: { occurredOn: '2026-08-22', channel: 'email' as const, summary: 'Second touch.', followedUpBy: 'hai' as const },
    records: [
      { ref: 'stale', opportunityId, expectedVersion: '1999-01-01 00:00:00+00' },
      { ref: 'fine', companyName: 'Unrelated Row AB', contactName: 'Dee', email: 'dee@unrelatedrow.test' },
    ],
    previewToken: 'unused-by-the-service-layer',
  }, actor)

  assert.equal(result.counts.failed, 1)
  assert.equal(result.counts.saved, 1)
  const failure = result.failed[0] as Record<string, any>
  assert.equal(failure.ref, 'stale')
  assert.equal(failure.code, 'conflict')
  assert.equal((result.saved[0] as Record<string, unknown>).ref, 'fine')
  // The healthy row still persisted despite its neighbour failing.
  const ok = await db.query("select count(*)::int n from companies where name = 'Unrelated Row AB'")
  assert.equal(ok[0].n, 1)
})

const verifier = 'a'.repeat(64)
function authorization() {
  return validateAuthorization({ response_type: 'code', client_id: config().clientId, redirect_uri: config().redirects[0],
    state: 'state-value', resource: config().resource, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256', scope: 'crm:read crm:tasks:write' })
}
function tokenForm(code: string) {
  return new URLSearchParams({ grant_type: 'authorization_code', client_id: config().clientId, client_secret: config().clientSecret,
    redirect_uri: config().redirects[0], code, code_verifier: verifier, resource: config().resource })
}
/** Approves an MCP connection as this person, the way the consent page does. */
async function connect(who: { userId: string; organizationId: string }) {
  const code = new URL(await issueCode(db, authorization(), who)).searchParams.get('code')!
  return exchangeToken(db, tokenForm(code))
}

test('authorization tolerates ChatGPT extras and an absent resource, and names bad fields', async () => {
  const base = { response_type: 'code', client_id: config().clientId, redirect_uri: config().redirects[0],
    state: 'state-value', code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256', scope: 'crm:read' }
  // An unrecognized parameter is ignored, not fatal (RFC 6749 3.1).
  const extra = validateAuthorization({ ...base, resource: config().resource, prompt: 'consent' })
  assert.equal(extra.resource, config().resource)
  assert.equal((extra as Record<string, unknown>).prompt, undefined)
  // An omitted resource defaults to this server's only resource (RFC 8707).
  assert.equal(validateAuthorization(base).resource, config().resource)
  // A resource that disagrees is still refused.
  assert.throws(() => validateAuthorization({ ...base, resource: 'https://evil.example/mcp' }), /Unrecognized/)
  // A genuinely malformed request names the field instead of the old opaque fallback.
  assert.throws(() => validateAuthorization({ ...base, state: '' }), /missing or malformed: state/)
  // The token endpoint takes the same latitude on resource.
  const code = new URL(await issueCode(db, validateAuthorization(base), identity)).searchParams.get('code')!
  const form = tokenForm(code); form.delete('resource')
  assert.equal((await exchangeToken(db, form)).token_type, 'Bearer')
})

test('OAuth binds callback/resource/client/PKCE, consumes codes once, rotates tokens and revokes', async () => {
  assert.equal(authorizationMetadata().code_challenge_methods_supported[0], 'S256')
  assert.throws(() => validateAuthorization({ ...authorization(), redirect_uri: 'https://evil.example/' }), /Unrecognized/)
  assert.throws(() => validateAuthorization({ ...authorization(), resource: 'https://evil.example/mcp' }), /Unrecognized/)
  assert.throws(() => validateAuthorization({ ...authorization(), scope: 'crm:read admin' }), /supported/)
  const callback = new URL(await issueCode(db, authorization(), identity)), code = callback.searchParams.get('code')!
  assert.equal(callback.searchParams.get('state'), 'state-value')
  assert.equal(callback.searchParams.get('iss'), config().origin)
  const wrong = tokenForm(code); wrong.set('code_verifier', 'b'.repeat(64))
  await assert.rejects(exchangeToken(db, wrong), /authorization code/)
  const wrongClient = tokenForm(code); wrongClient.set('client_secret', 'wrong')
  await assert.rejects(exchangeToken(db, wrongClient), /client credentials/)
  const token = await exchangeToken(db, tokenForm(code))
  await assert.rejects(exchangeToken(db, tokenForm(code)), /authorization code/)
  const principal = await authenticateBearer(db, `Bearer ${token.access_token}`)
  assert.deepEqual(principal.scopes, ['crm:read', 'crm:tasks:write'])
  assert.equal((await db.query('select access_hash from crm_oauth_connections where id = $1', [principal.connectionId]))[0].access_hash, hashToken(token.access_token))
  const refresh = new URLSearchParams({ grant_type: 'refresh_token', client_id: config().clientId, client_secret: config().clientSecret, resource: config().resource, refresh_token: token.refresh_token })
  const rotated = await exchangeToken(db, refresh)
  await assert.rejects(exchangeToken(db, refresh), /expired or was revoked/)
  await assert.rejects(authenticateBearer(db, `Bearer ${token.access_token}`), /expired or was revoked/)
  assert.equal((await authenticateBearer(db, `Bearer ${rotated.access_token}`)).connectionId, principal.connectionId)
  await revokeToken(db, new URLSearchParams({ client_id: config().clientId, client_secret: config().clientSecret, token: rotated.refresh_token }))
  await assert.rejects(authenticateBearer(db, `Bearer ${rotated.access_token}`), /expired or was revoked/)
})

test('origin, payload size, redirect and error boundaries fail closed', async () => {
  assert.throws(() => checkOrigin(new Request('https://crm.example.test/mcp', { headers: { origin: 'https://evil.example' } })), /origin/)
  assert.throws(() => checkOrigin(new Request('https://crm.example.test/oauth/authorize'), true), /origin/)
  await assert.rejects(readBody(new Request('https://crm.example.test/mcp', { method: 'POST', body: '12345' }), 4), /too large/)
  assert.equal(loginReturnTo('https://evil.example'), '/')
  assert.equal(loginReturnTo('//evil.example'), '/')
  assert.equal(loginReturnTo('/oauth/authorize?state=x'), '/oauth/authorize?state=x')
  assert.equal(safeError(new Error('postgres://secret@host')).message.includes('secret'), false)
})

test('MCP client discovers annotated schemas, previews then saves a task, and enforces scopes', async () => {
  const server = createCrmMcpServer(db, { ...actor, scopes: ['crm:read', 'crm:tasks:write'] })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1' })
  await server.connect(serverTransport); await client.connect(clientTransport)
  try {
    const list = await client.listTools()
    assert.equal(list.tools.length, 13)
    assert.equal(list.tools.find(t => t.name === 'export_prospects')?.annotations?.readOnlyHint, true)
    assert.ok((await client.listResources()).resources.some(r => r.uri === 'khyte://export-schema'))
    assert.ok((await client.readResource({ uri: 'khyte://export-schema' })).contents.length)
    assert.notEqual((await client.callTool({ name: 'export_prospects', arguments: { countOnly: true } })).isError, true)
    assert.equal(list.tools.find(t => t.name === 'preview_crm_action')?.annotations?.readOnlyHint, true)
    assert.equal(list.tools.find(t => t.name === 'create_task')?.annotations?.readOnlyHint, false)
    assert.equal(list.tools.find(t => t.name === 'create_task')?.annotations?.idempotentHint, true)
    assert.equal(list.tools.find(t => t.name === 'assign_task')?.annotations?.destructiveHint, true)
    const rules = await client.callTool({ name: 'get_logging_rules', arguments: {} })
    assert.notEqual(rules.isError, true)
    const parameters = task()
    const preview = await client.callTool({ name: 'preview_crm_action', arguments: { action: 'create_task', parameters } })
    assert.notEqual(preview.isError, true)
    const data = preview.structuredContent as Row
    const saved = await client.callTool({ name: 'create_task', arguments: { ...(data.parameters as Row), previewToken: data.previewToken } })
    assert.notEqual(saved.isError, true)
    assert.equal((saved.structuredContent as Row).status, 'saved')
    const receipt = await client.callTool({ name: 'get_operation_result', arguments: { requestId: parameters.requestId } })
    assert.equal((receipt.structuredContent as Row).status, 'already_saved')
    const forbidden = await client.callTool({ name: 'create_lead', arguments: { ...lead(), previewToken: 'irrelevant' } })
    assert.equal(forbidden.isError, true)
    assert.ok(forbidden._meta?.['mcp/www_authenticate'])
  } finally { await client.close(); await server.close() }
})

test('stateless Streamable HTTP supports fresh servers for initialization, discovery and tool calls', async () => {
  const calls = [
    { method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { method: 'tools/list', params: {} },
    { method: 'tools/call', params: { name: 'get_logging_rules', arguments: {} } },
  ]
  for (const call of calls) {
    const server = createCrmMcpServer(db, { ...actor, scopes: ['crm:read'] })
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
    await server.connect(transport)
    const response = await transport.handleRequest(new Request('https://crm.example.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...call }) }))
    await server.close()
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.error, undefined)
    if (call.method === 'initialize') assert.equal(data.result.serverInfo.name, 'khyte-crm')
    if (call.method === 'tools/list') assert.equal(data.result.tools.length, 13)
    if (call.method === 'tools/call') assert.equal(data.result.structuredContent.timezone, 'Europe/Stockholm')
  }
})

/* ———— Organizations ———— */

test('organizations are invisible to each other through every read, write, receipt and export path', async () => {
  const prospect = await commitAction(db, 'log_outreach', outreach(), actor)
  const record = prospect.record as Row
  const leadInput = lead()
  const savedLead = await commitAction(db, 'create_lead', leadInput, actor)
  const savedTask = await commitAction(db, 'create_task', task(), actor)
  const companyName = (prospect.company as Row).name as string

  // Reads: a foreign id is simply not found, never "forbidden" — an error
  // that differs would itself confirm the record exists.
  for (const [entity, id] of [['prospect', record.id], ['company', record.companyId], ['contact', record.contactId],
    ['lead', (savedLead.record as Row).id], ['task', (savedTask.record as Row).id]] as const) {
    await getRecord(db, { entity, id }, actor)
    await assert.rejects(getRecord(db, { entity, id }, otherActor), failsWith('not_found'), entity)
  }
  const search = await searchRecords(db, { query: companyName }, otherActor)
  assert.ok((search.results as Row[]).every(r => (r.matches as Row[]).length === 0), 'search must not leak a match across organizations')
  assert.equal((await exportProspects(db, { countOnly: true }, otherActor)).total, 0)
  assert.ok(!(await exportProspects(db, { fields: ['identity'] }, otherActor)).rows.some(row => row.prospectId === record.id))

  // Writes against the other organization's ids fail the same way.
  await assert.rejects(commitAction(db, 'assign_task', { requestId: randomUUID(), taskId: (savedTask.record as Row).id, expectedVersion: savedTask.version, assignee: 'abdi' }, otherActor), failsWith('not_found'))
  await assert.rejects(commitAction(db, 'log_outreach', { ...outreach(), target: { kind: 'existing', opportunityId: record.id, expectedVersion: prospect.version } }, otherActor), failsWith('not_found'))
  await assert.rejects(commitAction(db, 'create_task', { ...task(), relatedOpportunityId: record.id }, otherActor), failsWith('not_found'))
  assert.equal((savedTask.record as Row).assignee, 'hai', 'nothing about the task changed')

  // Receipts: a request id is bound to the connection and organization that
  // used it, so a replay from elsewhere is a conflict, not a free result.
  await assert.rejects(commitAction(db, 'create_lead', leadInput, otherActor), failsWith('request_id_conflict'))
  const batchId = randomUUID()
  await commitBulkOutreach(db, { batchId, defaults: { occurredOn: '2026-08-23', channel: 'email' as const, summary: 'Isolated batch.', followedUpBy: 'erik' as const },
    records: [{ ref: 'only', companyName: `Isolated ${randomUUID()}`, contactName: 'Ida', email: `${randomUUID()}@example.test` }], previewToken: 'unused-by-the-service-layer' }, actor)
  assert.equal((await getBulkResult(db, batchId, actor)).status, 'found')
  assert.equal((await getBulkResult(db, batchId, otherActor)).status, 'not_found')

  // Matching is per organization: the other organization may know a company
  // by the same name, and that is its own record, not a duplicate of Khyte's.
  const theirs = await commitAction(db, 'log_outreach', { ...outreach(), target: { kind: 'new' as const, company: { name: companyName }, contact: { name: 'Ove', email: `${randomUUID()}@example.test` } } }, otherActor)
  assert.notEqual((theirs.record as Row).companyId, record.companyId)
  await assert.rejects(getRecord(db, { entity: 'prospect', id: (theirs.record as Row).id }, actor), failsWith('not_found'))
  assert.equal((await db.query('select organization_id from crm_events where subject_id = $1', [(theirs.record as Row).id]))[0].organization_id, OTHER_ORG)

  // The tools see exactly what the service sees.
  const server = createCrmMcpServer(db, { ...otherActor, scopes: ['crm:read'] })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'isolation-test', version: '1' })
  await server.connect(st); await client.connect(ct)
  try {
    assert.equal((await client.callTool({ name: 'get_crm_record', arguments: { entity: 'prospect', id: record.id } })).isError, true)
    const receipt = await client.callTool({ name: 'get_operation_result', arguments: { requestId: leadInput.requestId } })
    assert.equal((receipt.structuredContent as Row).status, 'not_found')
    const bulk = await client.callTool({ name: 'get_bulk_operation_result', arguments: { batchId } })
    assert.equal((bulk.structuredContent as Row).status, 'not_found')
    const found = await client.callTool({ name: 'search_crm', arguments: { query: companyName, entity: 'task' } })
    assert.ok(((found.structuredContent as Row).results as Row[]).every(r => (r.matches as Row[]).length === 0))
  } finally { await client.close(); await server.close() }
})

test("revoking a membership cuts that person's sessions and MCP connections in the organization, and nothing else", async () => {
  // Two owners in Khyte: the actor from the fixtures and the one leaving. The
  // roster refuses to revoke the last active owner — that rule has its own
  // test below; this one is about what revocation cuts.
  const leaving = await member(KHYTE, { role: 'owner', displayName: 'Leaving Owner' })
  const elsewhere = await addMember(db, { organizationId: OTHER_ORG, userId: leaving.userId, email: leaving.email, displayName: 'Leaving Owner', role: 'member', colleague: null })
  const token = await connect({ userId: leaving.userId, organizationId: KHYTE })
  const here = await login(leaving.userId, KHYTE)
  const there = await login(leaving.userId, OTHER_ORG)
  assert.equal((await authenticateBearer(db, `Bearer ${token.access_token}`)).userId, leaving.userId)
  assert.equal((await resolveAuthContext(db, here.cookie))?.viewer.memberId, leaving.memberId)

  const revoked = await revokeMember(db, KHYTE, leaving.memberId)
  assert.equal(revoked.status, 'revoked')
  assert.ok(revoked.revokedAt)
  await assert.rejects(authenticateBearer(db, `Bearer ${token.access_token}`), failsWith('unauthorized'))
  const refresh = new URLSearchParams({ grant_type: 'refresh_token', client_id: config().clientId, client_secret: config().clientSecret, resource: config().resource, refresh_token: token.refresh_token })
  await assert.rejects(exchangeToken(db, refresh), failsWith('invalid_grant'))
  assert.equal(await resolveAuthContext(db, here.cookie), null)
  // The cookie itself is still well-signed: revocation is a database fact,
  // which is the reason sessions live there and not only in a signature.
  assert.ok(readSessionCookie(here.cookie))
  // Their membership of the other organization is untouched.
  assert.equal((await resolveAuthContext(db, there.cookie))?.viewer.memberId, elsewhere.id)
  // Revoking twice is a no-op, not an error, and the organization is still
  // administered by the owner who stayed.
  assert.equal((await revokeMember(db, KHYTE, leaving.memberId)).status, 'revoked')
  assert.equal((await resolveAuthContext(db, (await login(actor.userId, KHYTE)).cookie))?.viewer.role, 'owner')
})

test('a session resolves to its viewer and organization until it is revoked, tampered with or expired', async () => {
  const minted = await login(actor.userId, KHYTE)
  const context = await resolveAuthContext(db, minted.cookie)
  assert.ok(context)
  assert.equal(context.userId, actor.userId)
  assert.equal(context.organizationId, KHYTE)
  assert.deepEqual(context.organization, { id: KHYTE, name: 'Khyte', slug: 'khyte', timezone: 'Europe/Stockholm' })
  assert.equal(context.viewer.userId, actor.userId)
  assert.equal(context.viewer.role, 'owner')
  assert.equal(context.viewer.displayName, 'Erik')
  assert.equal(context.viewer.colleague, 'erik')
  // Only the keyed hash is stored; the table alone opens nothing.
  const [row] = await db.query<{ token_hash: string }>('select token_hash from app_sessions where id = $1', [context.sessionId])
  assert.equal(row.token_hash, hashSessionToken(minted.token))
  assert.ok(!row.token_hash.includes(minted.token))
  assert.ok(Math.abs(readSessionCookie(minted.cookie)!.expiresAt - (Date.now() + SESSION_MAX_AGE * 1000)) < 60_000)

  // Tampering: the signature covers the token and the expiry, so changing
  // either — or the signature itself — is refused before any query.
  const [token, expiry, signature] = minted.cookie.split('.')
  const flipped = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A')
  assert.equal(readSessionCookie(`${token}.${expiry}.${flipped}`), null)
  assert.equal(await resolveAuthContext(db, `${token}.${Number(expiry) + 1000}.${signature}`), null)
  assert.equal(await resolveAuthContext(db, `${randomUUID()}.${expiry}.${signature}`), null)
  assert.equal(await resolveAuthContext(db, undefined), null)
  assert.equal(await resolveAuthContext(db, ''), null)
  // Expiry: a correctly signed cookie whose time has passed is null without
  // I/O, and a session the database says has lapsed is null even with a
  // fresh cookie.
  const past = Date.now() - 1000
  const expired = `${token}.${past}.${createHmac('sha256', AUTH_SECRET).update(`${token}.${past}`).digest('base64url')}`
  assert.equal(readSessionCookie(expired), null)
  assert.equal(await resolveAuthContext(db, expired), null)
  await db.query("update app_sessions set expires_at = now() - interval '1 second' where id = $1", [context.sessionId])
  assert.equal(await resolveAuthContext(db, minted.cookie), null)
  await db.query("update app_sessions set expires_at = now() + interval '1 hour' where id = $1", [context.sessionId])
  assert.ok(await resolveAuthContext(db, minted.cookie))
  // Revocation — logging out.
  await db.query('update app_sessions set revoked_at = now() where id = $1', [context.sessionId])
  assert.ok(readSessionCookie(minted.cookie))
  assert.equal(await resolveAuthContext(db, minted.cookie), null)
})

test('membership rules: one membership per account for life, one active member per roster label, never zero owners', async () => {
  const a = await member(KHYTE, { colleague: 'abdi', displayName: 'Abdi' })
  await assert.rejects(addMember(db, { organizationId: KHYTE, userId: a.userId, email: a.email, displayName: 'Abdi', role: 'member', colleague: 'abdi' }), failsWith('already_member'))

  // A roster label is carried by at most one active member. The service
  // refuses it and, should the service be bypassed, so does the database.
  const b = await member(KHYTE, { displayName: 'Bengt' })
  await assert.rejects(updateMember(db, KHYTE, b.memberId, { colleague: 'abdi' }), failsWith('colleague_taken'))
  await assert.rejects(member(KHYTE, { colleague: 'abdi' }), failsWith('colleague_taken'))
  await assert.rejects(db.query("update organization_members set colleague = 'abdi' where id = $1", [b.memberId]), /organization_members_colleague_idx/)

  // Revoking frees the label; moving it is two deliberate edits, never one.
  const revoked = await revokeMember(db, KHYTE, a.memberId)
  assert.equal(revoked.id, a.memberId)
  assert.equal(revoked.status, 'revoked')
  assert.ok(revoked.revokedAt)
  assert.equal((await updateMember(db, KHYTE, b.memberId, { colleague: 'abdi' })).colleague, 'abdi')
  await assert.rejects(addMember(db, { organizationId: KHYTE, userId: a.userId, email: a.email, displayName: 'Abdi', role: 'member', colleague: 'abdi' }), failsWith('colleague_taken'))

  // Re-adding reactivates the same membership rather than creating a second.
  const again = await addMember(db, { organizationId: KHYTE, userId: a.userId, email: a.email, displayName: 'Abdi Again', role: 'member', colleague: null })
  assert.equal(again.id, a.memberId)
  assert.equal(again.status, 'active')
  assert.equal(again.revokedAt, undefined)
  assert.equal(again.displayName, 'Abdi Again')
  assert.equal(again.colleague, undefined)
  assert.equal((await db.query('select count(*)::int as n from organization_members where user_id = $1', [a.userId]))[0].n, 1)

  // A revoked member is not edited; they are added again.
  const c = await member(KHYTE, { displayName: 'Cecilia' })
  await revokeMember(db, KHYTE, c.memberId)
  await assert.rejects(updateMember(db, KHYTE, c.memberId, { displayName: 'Cissi' }), failsWith('revoked_member'))

  // The last active owner can be neither revoked nor demoted: an
  // organization nobody can administer is a dead end, not a state.
  const [sole] = await db.query<{ id: string }>('select id from organization_members where organization_id = $1 and user_id = $2', [OTHER_ORG, otherActor.userId])
  await assert.rejects(revokeMember(db, OTHER_ORG, sole.id), failsWith('last_owner'))
  await assert.rejects(updateMember(db, OTHER_ORG, sole.id, { role: 'member' }), failsWith('last_owner'))
  assert.equal((await updateMember(db, OTHER_ORG, sole.id, { displayName: 'Still Owner' })).role, 'owner')

  // A member id is only ever resolved inside the caller's own organization.
  await assert.rejects(revokeMember(db, OTHER_ORG, a.memberId), failsWith('not_found'))
  await assert.rejects(updateMember(db, OTHER_ORG, a.memberId, { displayName: 'x' }), failsWith('not_found'))
})

test('an MCP connection carries the person who approved it and their organization, and nothing less', async () => {
  const callback = new URL(await issueCode(db, authorization(), identity)), code = callback.searchParams.get('code')!
  const [stored] = await db.query<{ user_id: string; organization_id: string }>('select user_id, organization_id from crm_oauth_codes where code_hash = $1', [hashToken(code)])
  assert.deepEqual(stored, { user_id: identity.userId, organization_id: KHYTE })
  const token = await exchangeToken(db, tokenForm(code))
  const principal = await authenticateBearer(db, `Bearer ${token.access_token}`)
  assert.equal(principal.userId, identity.userId)
  assert.equal(principal.organizationId, KHYTE)
  const [connection] = await db.query<{ user_id: string; organization_id: string }>('select user_id, organization_id from crm_oauth_connections where id = $1', [principal.connectionId])
  assert.deepEqual(connection, { user_id: identity.userId, organization_id: KHYTE })

  // A code with no person behind it — the legacy shape — is refused however
  // well-formed the rest of it is.
  const orphan = randomUUID(), a = authorization()
  await db.query(`insert into crm_oauth_codes (code_hash, client_id, redirect_uri, challenge, scopes, resource, expires_at, user_id, organization_id)
    values ($1, $2, $3, $4, $5::text[], $6, now() + interval '5 minutes', null, $7)`,
    [hashToken(orphan), a.client_id, a.redirect_uri, a.code_challenge, a.scope.split(' '), a.resource, KHYTE])
  await assert.rejects(exchangeToken(db, tokenForm(orphan)), failsWith('invalid_grant'))

  // And a person who is not an active member of the organization cannot
  // finish connecting, even with a code issued in their name.
  const outsider = randomUUID()
  await db.query('insert into auth.users (id, email) values ($1, $2)', [outsider, `${outsider.slice(0, 8)}@example.test`])
  const stranded = new URL(await issueCode(db, authorization(), { userId: outsider, organizationId: KHYTE })).searchParams.get('code')!
  await assert.rejects(exchangeToken(db, tokenForm(stranded)), failsWith('invalid_grant'))
})

test('the consent page says whose identity the connection will carry, behind the same headers as before', async () => {
  // Loaded here rather than at the top so that an unfinished consent module
  // fails this test alone, not the whole suite.
  const { renderConsentPage } = await import('../lib/mcp/consent')
  const render = (displayName: string) => renderConsentPage({ authorization: authorization(), approval: 'signed-approval-envelope',
    clientId: config().clientId, redirects: config().redirects, viewer: { displayName, organizationName: 'Khyte' } })
  const page = render('Erik Exempel')
  const headers = new Headers(page.headers)
  assert.equal(headers.get('x-frame-options'), 'DENY')
  // Under 'no-referrer' the browser serializes this page's own same-origin
  // form POST as 'Origin: null', which the consent handler refuses.
  assert.equal(headers.get('referrer-policy'), 'same-origin')
  // Chrome applies form-action to the redirect that follows the submission,
  // so the callback origin must be listed or approval navigates nowhere.
  const csp = headers.get('content-security-policy') ?? ''
  assert.ok(csp.includes("form-action 'self' https://chatgpt.com;"), csp)
  assert.ok(csp.includes("frame-ancestors 'none'"), csp)
  assert.ok(page.html.includes('Erik Exempel'))
  assert.ok(page.html.includes('Khyte'))
  assert.ok(page.html.includes('name="approval" value="signed-approval-envelope"'))
  // A display name is user-controlled text and is escaped like everything else.
  assert.ok(!render('<script>alert(1)</script>').html.includes('<script>'))
})

test('a wallpaper link opens one board in one organization, and dies with the membership that minted it', async () => {
  // A display token is minted by a person, not by the organization: revoking
  // one member has to end their links without blanking the rest of the team's
  // wallpapers. The signature alone cannot know that — it is the same for the
  // link's whole life — so the organization comes out of the token and the
  // membership behind it is looked up. proxy.ts and displayOrganization sit on
  // top of exactly these two steps; both need next/headers, so what is checked
  // here is the rule underneath them.
  const minter = await member(KHYTE, { displayName: 'Wallpaper Minter' })
  const bystander = await member(KHYTE, { displayName: 'Innocent Bystander' })
  const token = displayToken(KHYTE, minter.memberId, 'erik')!
  assert.ok(token)
  assert.deepEqual(verifyDisplayToken('erik', token), { organizationId: KHYTE, memberId: minter.memberId })
  assert.equal(await resolveDisplayGrant(db, 'erik', token), KHYTE)

  // The colleague is inside the HMAC, so one link is one board — a wallpaper
  // pointed at a teammate's numbers is a different link, deliberately minted.
  assert.equal(verifyDisplayToken('abdi', token), null)
  assert.equal(await resolveDisplayGrant(db, 'abdi', token), null)

  // So is the member id. Swapping it for another real membership's does not
  // borrow that person's link; it produces a signature that does not verify.
  const [, , sig] = token.split('.')
  const tampered = `${KHYTE}.${bystander.memberId}.${sig}`
  assert.equal(verifyDisplayToken('erik', tampered), null)
  assert.equal(await resolveDisplayGrant(db, 'erik', tampered), null)
  assert.equal(await resolveDisplayGrant(db, 'erik', `${KHYTE}.${minter.memberId}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`), null)
  assert.equal(await resolveDisplayGrant(db, 'erik', undefined), null)
  assert.equal(await resolveDisplayGrant(db, undefined, token), null)

  // A link minted in the other organization opens that organization's board
  // and only ever that one …
  const [theirs] = await db.query<{ id: string }>('select id from organization_members where organization_id = $1 and user_id = $2', [OTHER_ORG, otherActor.userId])
  assert.equal(await resolveDisplayGrant(db, 'erik', displayToken(OTHER_ORG, theirs.id, 'erik')), OTHER_ORG)
  // … and naming Khyte in the clear half of the token does not move it there:
  // the membership is looked up inside the organization the token claims, so
  // a member of somewhere else is simply not found.
  assert.equal(await resolveDisplayGrant(db, 'erik', displayToken(KHYTE, theirs.id, 'erik')), null)

  // Revocation is what ends a link, and it ends exactly the revoked person's.
  const survivor = displayToken(KHYTE, bystander.memberId, 'abdi')!
  await revokeMember(db, KHYTE, minter.memberId)
  assert.equal(await resolveDisplayGrant(db, 'erik', token), null)
  assert.ok(verifyDisplayToken('erik', token), 'the signature is still good — revocation is a database fact, which is why the lookup exists')
  assert.equal(await resolveDisplayGrant(db, 'abdi', survivor), KHYTE)
})

test('an owner may only administer an account their organization alone holds, and the guard answers before one exists', async () => {
  const person = await member(KHYTE, { displayName: 'Two Hats' })
  assert.equal(await hasActiveMembershipElsewhere(db, person.userId, KHYTE), false)
  // The account-takeover chain, at the layer this suite can reach: an account
  // active in Khyte is "elsewhere" seen from the other organization, which is
  // precisely what app/actions/members.ts consults before it creates, takes
  // over or resets an account — 'belongs_elsewhere' and 'shared_account'. An
  // owner over there therefore cannot replace this person's password and walk
  // into Khyte as them.
  assert.equal(await hasActiveMembershipElsewhere(db, person.userId, OTHER_ORG), true)
  const elsewhere = await addMember(db, { organizationId: OTHER_ORG, userId: person.userId, email: person.email, displayName: 'Two Hats', role: 'member', colleague: null })
  assert.equal(await hasActiveMembershipElsewhere(db, person.userId, KHYTE), true)
  // Revoking the other membership hands the account back to its one home.
  await revokeMember(db, OTHER_ORG, elsewhere.id)
  assert.equal(await hasActiveMembershipElsewhere(db, person.userId, KHYTE), false)

  // assertCanAddMember is the same refusal addMember makes, asked early so a
  // refused add never leaves an orphaned account whose password nobody saw.
  await assert.rejects(assertCanAddMember(db, { organizationId: KHYTE, userId: person.userId, colleague: null }), failsWith('already_member'))
  // `userId: null` is the shape it is called with for an address that has no
  // account at all — the label is decided before Supabase Auth is touched.
  await assert.rejects(assertCanAddMember(db, { organizationId: KHYTE, userId: null, colleague: 'erik' }), failsWith('colleague_taken'))
  // And for an account that exists but belongs to no membership here: the
  // label is carried by somebody else, so it is refused on the label rather
  // than waved through because the account is new to this roster.
  await assert.rejects(assertCanAddMember(db, { organizationId: KHYTE, userId: otherActor.userId, colleague: 'erik' }), failsWith('colleague_taken'))
  // A free label in an organization that does not know the address is the add
  // that will go through, and asking for it creates nothing.
  await assertCanAddMember(db, { organizationId: OTHER_ORG, userId: null, colleague: 'erik' })
  assert.equal((await db.query('select id from auth.users where email = $1', ['nobody@example.test'])).length, 0)
})

test("a replaced password ends that account's sessions everywhere; a reset cuts only this organization's connections", async () => {
  const person = await member(KHYTE, { displayName: 'Shared Person' })
  const elsewhere = await addMember(db, { organizationId: OTHER_ORG, userId: person.userId, email: person.email, displayName: 'Shared Person', role: 'member', colleague: null })
  const here = await login(person.userId, KHYTE)
  const there = await login(person.userId, OTHER_ORG)
  assert.equal((await resolveAuthContext(db, here.cookie))?.viewer.memberId, person.memberId)
  assert.equal((await resolveAuthContext(db, there.cookie))?.viewer.memberId, elsewhere.id)

  // A password belongs to an account, not to an organization, so whoever held
  // the old one holds no session either — in every organization it opened.
  // Deliberately wider than revokeMember's cut, which stops at its own roster.
  assert.equal(await revokeSessionsForUser(db, person.userId), 2)
  assert.equal(await resolveAuthContext(db, here.cookie), null)
  assert.equal(await resolveAuthContext(db, there.cookie), null)
  assert.equal(await revokeSessionsForUser(db, person.userId), 0, 'an already-revoked session is not revoked a second time')

  // Connections are the opposite shape: an owner resetting a password may cut
  // only what their own organization authorized, because the other
  // organization's connection is not theirs to end.
  const mine = await connect({ userId: person.userId, organizationId: KHYTE })
  const theirs = await connect({ userId: person.userId, organizationId: OTHER_ORG })
  assert.equal(await revokeConnectionsForUser(db, person.userId, KHYTE), 1)
  await assert.rejects(authenticateBearer(db, `Bearer ${mine.access_token}`), failsWith('unauthorized'))
  assert.equal((await authenticateBearer(db, `Bearer ${theirs.access_token}`)).organizationId, OTHER_ORG)
})
