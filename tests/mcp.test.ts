import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { Database, Queryable, Row } from '../lib/crm/database'
import type { ColleagueId, MemberRole } from '../lib/types'
import { actionSchemas, calendarDate } from '../lib/crm/contracts'
import { commitAction, previewAction, generatedId, getRecord, listJournal, searchRecords, safeError,
  previewBulkOutreach, commitBulkOutreach, getBulkResult } from '../lib/crm/service'
// The Journal's own write path, used here exactly as the composer uses it, so
// a person-written entry in a fixture is the real thing rather than four rows
// inserted by hand.
import { createEntry, writeEntry, type JournalActor } from '../lib/journal/service'
import { createCrmMcpServer } from '../lib/mcp/server'
import type { CodeIdentity, Principal } from '../lib/mcp/oauth'
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
import { addMember, assertCanAddMember, claimAccount, hasActiveMembershipElsewhere, resetCredentials,
  revokeConnectionsForUser, revokeMember, revokeSessionsForUser, updateMember } from '../lib/org/members'
// The member flows themselves, with the one call SQL cannot undo behind an
// injected provider — which is what lets the suite fail it on command. The
// Server Action around them (app/actions/members.ts) is the gate, and reads a
// session; scopeMatches is the half of that gate which is pure.
import { addMemberFlow, resetPasswordFlow, scopeMatches,
  type AddMemberRequest, type Administrator, type IdentityProvider, type MemberResult } from '../lib/org/administration'
import { IdentityError } from '../lib/auth/identity'
import { applyMigrations, finishRollout } from './support/migrations'
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
//
// REAL PRINCIPALS, NOT SHAPES. commitAction re-verifies the connection inside
// its transaction — the row must exist, be unrevoked, and join to an active
// membership on the same credential generation (lib/crm/service.ts) — so a
// hand-built { connectionId, userId, organizationId } is refused as
// 'unauthorized' before it writes anything. Every actor below is therefore
// minted through the real consent path: membership → code → token → bearer.
// They are assigned in before(), which is why they are `let`.
let actor: Principal
let otherActor: Principal
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

/**
 * This person writing in the Journal from the browser: a real session,
 * resolved the way every Server Action resolves it, carried into the Journal
 * actor the way app/actions/journal.ts builds it. A typed Journal write
 * re-checks exactly this session and generation inside its own transaction,
 * so a bare `{ organizationId, userId, source: 'typed' }` is refused.
 */
async function browserActor(userId: string, organizationId: string): Promise<JournalActor> {
  const context = await resolveAuthContext(db, (await login(userId, organizationId)).cookie)
  assert.ok(context, 'a freshly minted session resolves')
  return { organizationId, userId, source: 'typed', sessionId: context.sessionId, credentialGeneration: context.credentialGeneration }
}

/**
 * The membership a credential is minted against, as it stands right now: its
 * id and its current credential generation. Every credential in this codebase
 * — wallpaper link, authorization code, MCP connection — records both, and is
 * refused once the generation has moved on.
 */
async function membership(userId: string, organizationId: string) {
  const [row] = await db.query<{ id: string; credential_generation: string }>(
    'select id, credential_generation from organization_members where user_id = $1 and organization_id = $2',
    [userId, organizationId])
  assert.ok(row, 'no membership to mint a credential against')
  return { memberId: row.id, credentialGeneration: row.credential_generation }
}

/** What the consent route passes to issueCode: the session's person, their
 *  organization, and the membership behind both. */
async function codeIdentity(who: { userId: string; organizationId: string }): Promise<CodeIdentity> {
  return { ...who, ...(await membership(who.userId, who.organizationId)) }
}

/** Approves an MCP connection as this person, the way the consent page does,
 *  and returns the token pair. */
async function approve(who: { userId: string; organizationId: string }, scope?: string) {
  const code = new URL(await issueCode(db, authorization(scope), await codeIdentity(who))).searchParams.get('code')!
  return exchangeToken(db, tokenForm(code))
}

/**
 * A real principal for this person in this organization: an account, a
 * membership, and a connection created through the whole OAuth path rather
 * than assembled by hand. This is what every tool call in the suite acts as —
 * see the note on `actor` for why nothing less will do.
 *
 * `scopes` is the space-separated scope string the connection is approved
 * with, defaulting to what the consent page asks for.
 */
async function connect(userId: string, organizationId: string, scopes?: string): Promise<Principal> {
  await db.query('insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing',
    [userId, `${userId.slice(0, 8)}@example.test`])
  const [existing] = await db.query<{ id: string }>(
    `select id from organization_members where user_id = $1 and organization_id = $2 and status = 'active'`, [userId, organizationId])
  if (!existing) {
    await addMember(db, { organizationId, userId, email: `${userId.slice(0, 8)}@example.test`, displayName: 'Testperson', role: 'member', colleague: null })
  }
  const token = await approve({ userId, organizationId }, scopes)
  return authenticateBearer(db, `Bearer ${token.access_token}`)
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
  await applyMigrations(pg)
  // The organization migration leaves the rollout aids standing: the Khyte id
  // as a default on every organization_id column, and the old single-column
  // week index. Both are only safe while Khyte is the only organization, and
  // organizations_rollout_guard makes that a rule the database keeps rather
  // than a sentence in a document — a second organization is refused until
  // the follow-up has dropped them. finishRollout asserts exactly that and
  // then applies the follow-up from wherever it lives, so every assertion
  // below runs against a database with no defaults left to hide a forgotten
  // organization_id (see tests/support/migrations.ts).
  await finishRollout(pg, OTHER_ORG)
  await db.query(`insert into organizations (id, name, slug) values ($1, 'Other AB', 'other')`, [OTHER_ORG])
  const erik = await member(KHYTE, { role: 'owner', colleague: 'erik', displayName: 'Erik' })
  const theirOwner = await member(OTHER_ORG, { role: 'owner', displayName: 'Other Owner' })
  actor = await connect(erik.userId, KHYTE)
  otherActor = await connect(theirOwner.userId, OTHER_ORG)
})
after(async () => { await pg.close() })

test('export matches the CSV builder, filters contacted stages, and preserves provenance', async () => {
  const saved = await commitAction(db, 'log_outreach', { ...outreach(), stage: 'Lost' }, actor)
  const id = (saved.record as Row).id as string
  // Decision 13. The outreach this prospect was born from is a Journal entry
  // now, but a system one: Donna restating what crm_interactions already
  // holds. The note columns count what a person wrote, so the fixture says one
  // thing in somebody's own words and the assertions below prove the system
  // entry standing beside it is not counted as a second.
  const written = await createEntry(db, await browserActor(actor.userId, KHYTE),
    { requestKey: randomUUID(), text: 'Anna asked for a written quote before the summer.', links: [{ type: 'opportunity', id }] })
  assert.equal(written.ok, true)
  const linked = await db.query<{ origin: string }>(
    `select e.origin from journal_entries e
       join journal_entry_links l on l.entry_id = e.id and l.organization_id = e.organization_id
      where e.organization_id = $1 and l.opportunity_id = $2 order by e.origin`, [KHYTE, id])
  assert.deepEqual(linked.map(row => row.origin), ['person', 'system'], 'both entries are linked to this prospect')
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
  // Two entries are linked to this prospect; one of them is a note.
  assert.equal(row.noteCount, '1')
  assert.ok(String(row.noteHistory).includes('Anna asked for a written quote before the summer.'))
  assert.ok(!String(row.noteHistory).includes('Sent an introduction.'), 'a system entry is not note_history')
  const defaults = await exportProspects(db, { stages: ['Lost'] }, actor)
  assert.equal(defaults.rows.find(row => row.prospectId === id)?.noteHistory, undefined)
  assert.equal((await exportProspects(db, { stages: ['New'] }, actor)).rows.length, 0)
  assert.equal((await exportProspects(db, { stages: ['Lost'], contactedSince: '2026-09-01', countOnly: true }, actor)).total, 0)

  const { buildExportRows } = await import('../lib/export-prospects')
  const { fromOpportunityRow, fromCompanyRow, fromContactRow } = await import('../lib/db/mappers')
  const [opp] = await db.query('select *, last_interaction::text as last_interaction, follow_up_date::text as follow_up_date from opportunities where id=$1', [id])
  const [company] = await db.query('select * from companies where id=$1', [opp.company_id])
  const [contact] = await db.query('select * from contacts where id=$1', [opp.contact_id])
  const [csv] = buildExportRows([{ opportunity: fromOpportunityRow(opp as never), company: fromCompanyRow(company as never), contact: fromContactRow(contact as never) }], { journal: {}, colleagueName: () => 'Erik', today: new Date(2026, 8, 10) })
  assert.equal(row.company, csv.company)
  assert.equal(row.lastContacted, csv.lastContacted)
  assert.equal(row.daysSinceContact, csv.daysSinceContact)
})

test('an unreadable Journal blanks the note columns and says so, rather than reporting zero', async () => {
  const saved = await commitAction(db, 'log_outreach', outreach(), actor)
  const id = (saved.record as Row).id as string
  const { buildExportRows, toCSV } = await import('../lib/export-prospects')
  const { fromOpportunityRow, fromCompanyRow, fromContactRow } = await import('../lib/db/mappers')
  const [opp] = await db.query('select *, last_interaction::text as last_interaction, follow_up_date::text as follow_up_date from opportunities where id=$1', [id])
  const [company] = await db.query('select * from companies where id=$1', [opp.company_id])
  const [contact] = await db.query('select * from contacts where id=$1', [opp.contact_id])
  const source = [{ opportunity: fromOpportunityRow(opp as never), company: fromCompanyRow(company as never), contact: fromContactRow(contact as never) }]
  const today = new Date(2026, 8, 10)
  const written = {
    [id]: [
      { id: randomUUID(), body: 'Anna asked for a quote.', createdAt: '2026-08-19T09:00:00.000Z', occurredOn: '2026-08-19' },
      { id: randomUUID(), body: 'Anna called back.', createdAt: '2026-08-20T09:00:00.000Z', occurredOn: '2026-08-20' },
    ],
  }

  // What a readable Journal says ...
  const [read] = buildExportRows(source, { journal: written, colleagueName: () => 'Erik', today })
  assert.equal(read.journalQuality, 'ok')
  assert.equal(read.noteCount, '2')
  assert.equal(read.lastNoteDate, '2026-08-20')
  assert.ok(read.noteHistory.includes('Anna called back.'))

  // ... and what a Journal nobody could read says, which is not '0'. A caller
  // whose read failed passes {} - the same argument either way - so the file
  // would otherwise be word for word a prospect nobody has written about.
  const [gap] = buildExportRows(source, { journal: {}, journalQuality: 'unavailable', colleagueName: () => 'Erik', today })
  assert.equal(gap.journalQuality, 'unavailable')
  assert.equal(gap.noteCount, '', 'a 0 here is a claim this row cannot make')
  assert.equal(gap.lastNoteDate, '')
  assert.equal(gap.noteHistory, '')
  assert.equal(Number(gap.engagementDepth), Number(read.engagementDepth) - 1,
    'the person-written-entry point is dropped, not scored as absent')

  // The column travels beside history_quality, the degradation it mirrors.
  const header = toCSV([]).split('\r\n')[0].split(',').map(field => field.slice(1, -1))
  assert.equal(header[header.indexOf('history_quality') + 1], 'journal_quality')
  assert.ok((EXPORT_GROUPS.provenance as readonly string[]).includes('journalQuality'))

  // The MCP export has no degraded state to report: its Journal read is not
  // wrapped the way the event read is, so it either succeeds or the whole call
  // fails before a row is built.
  const page = await exportProspects(db, { fields: ['written'], asOf: '2026-09-10' }, actor)
  assert.ok(page.rows.length)
  assert.ok(page.rows.every(row => row.journalQuality === 'ok'))
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
  // connection that used it, not to the organization. A second *real*
  // connection, because an invented connection id is now refused as
  // unauthorized before the receipt is ever read — which would prove
  // something else entirely.
  await assert.rejects(commitAction(db, 'create_lead', a, await connect(actor.userId, KHYTE)), /request ID/)
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
  // The timeline line is a Journal entry now (decision 4), written through the
  // shared service inside the same transaction: Donna's own words about work a
  // colleague did, so `origin: system` and `performer: erik`.
  const entry = (saved.journal as { entries: Row[] }).entries
  assert.equal(entry.length, 1)
  assert.equal(entry[0].origin, 'system')
  assert.equal(entry[0].performer, 'erik')
  assert.equal(entry[0].body, a.summary)
  assert.equal(entry[0].occurredOn, a.occurredOn)
  assert.equal(entry[0].occurredPrecision, 'day')
  assert.equal(entry[0].id, generatedId(a.requestId, 'note'))
  assert.equal(saved.notes, undefined, 'the notes table is no longer read')
  // The rows behind it, under the ids the requestId derives so a retry rebuilds
  // exactly these and not a second set.
  const [capture] = await db.query<{ id: string; source: string; request_key: string; author_id: string }>(
    'select id, source, request_key, author_id from captures where organization_id = $1 and request_key = $2', [KHYTE, a.requestId])
  assert.equal(capture.id, generatedId(a.requestId, 'capture'))
  assert.equal(capture.source, 'mcp')
  assert.equal(capture.request_key, a.requestId)
  assert.equal(capture.author_id, actor.userId, 'the author is the account behind the connection')
  const entries = () => db.query('select id from journal_entries where organization_id = $1 and capture_id = $2', [KHYTE, capture.id])
  assert.deepEqual((await entries()).map(row => row.id), [generatedId(a.requestId, 'note')])
  assert.deepEqual((await db.query<{ target_type: string }>(
    'select target_type from journal_entry_links where organization_id = $1 and entry_id = $2 order by target_type',
    [KHYTE, generatedId(a.requestId, 'note')])).map(row => row.target_type), ['company', 'interaction', 'opportunity'])
  assert.equal((await commitAction(db, 'log_outreach', a, actor)).status, 'already_saved')
  assert.equal((await entries()).length, 1, 'a replayed requestId writes no second entry')
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

test('R6: a log_outreach retry is answered from its receipt, and the same Journal write made again replays by fingerprint', async () => {
  const a = outreach()
  const saved = await commitAction(db, 'log_outreach', a, actor)
  assert.equal(saved.status, 'saved')
  const record = saved.record as Row
  // The receipt short-circuits a replayed tool call before any Journal write.
  assert.equal((await commitAction(db, 'log_outreach', a, actor)).status, 'already_saved')

  // The write plan.after makes, made again directly with identical inputs:
  // the stored fingerprint matches, so it replays the original entry.
  const entryId = generatedId(a.requestId, 'note')
  const mcpActor: JournalActor = { organizationId: KHYTE, userId: actor.userId, source: 'mcp' }
  const inputs = {
    requestKey: a.requestId, text: a.summary, kind: 'update', occurredPrecision: 'day', occurredOn: a.occurredOn, performer: a.followedUpBy,
    links: [
      { type: 'opportunity', id: record.id as string },
      { type: 'company', id: record.companyId as string },
      { type: 'interaction', id: generatedId(a.requestId, 'interaction') },
    ],
  }
  const options = { origin: 'system' as const, captureId: generatedId(a.requestId, 'capture'), entryId }
  const replay = await db.transaction(tx => writeEntry(tx, mcpActor, inputs, options))
  assert.ok(replay.ok)
  assert.equal(replay.replayed, true)
  assert.equal(replay.entry.id, entryId)

  // The same key with a different day is a different request.
  const moved = await db.transaction(tx => writeEntry(tx, mcpActor, { ...inputs, occurredOn: '2026-08-19' }, options))
  assert.ok(!moved.ok)
  assert.equal(moved.error, 'request_key_conflict')
  assert.equal(moved.existing?.id, entryId)
  assert.equal((await db.query('select id from captures where organization_id = $1 and request_key = $2', [KHYTE, a.requestId])).length, 1)
})

test('transaction failure rolls back company, contact, prospect, journal entry, event and receipt', async () => {
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
  assert.equal((await db.query('select id from captures where organization_id = $1 and request_key = $2', [KHYTE, a.requestId])).length, 0,
    'the capture rolls back with everything else, which is what frees the key for the retry below')
  assert.equal((await commitAction(db, 'log_outreach', a, actor)).status, 'saved')
})

test('a previewed outreach lists the Journal entry it would write and writes nothing', async () => {
  const a = outreach()
  const preview = await previewAction(db, 'log_outreach', a, actor)
  const change = preview.changes.find(item => item.entity === 'journal_entry')
  assert.ok(change, 'the preview must name the entry, or the receipt would describe a write the caller never saw')
  assert.equal(change.operation, 'create')
  assert.equal(change.id, generatedId(a.requestId, 'note'))
  assert.equal(change.fields.body, a.summary)
  assert.equal(change.fields.origin, 'system')
  assert.equal(change.fields.kind, 'update')
  assert.equal(change.fields.occurredOn, a.occurredOn)
  assert.equal(change.fields.performer, 'erik')
  // A preview is a read. plan.after is built but never awaited.
  assert.equal((await db.query('select id from captures where organization_id = $1 and request_key = $2', [KHYTE, a.requestId])).length, 0)
  assert.equal((await db.query('select id from journal_entries where organization_id = $1 and id = $2', [KHYTE, generatedId(a.requestId, 'note')])).length, 0)
  // And what the commit receipts is the same change, field for field.
  const saved = await commitAction(db, 'log_outreach', a, actor)
  assert.deepEqual((saved.changes as Row[]).find(item => item.entity === 'journal_entry'), change as unknown as Row)
})

test('an outreach whose request key already belongs to a typed entry saves nothing at all', async () => {
  const prospect = await commitAction(db, 'log_outreach', outreach(), actor)
  const record = prospect.record as Row
  const requestId = randomUUID()
  // Somebody typed something else under this key first. The MCP path derives
  // its capture id from the same requestId, so the collision is real rather
  // than contrived — and the entry that holds the key is not the one the tool
  // is about to claim it wrote.
  const held = 'A typed entry that took this key first.'
  const taken = await createEntry(db, await browserActor(actor.userId, KHYTE),
    { requestKey: requestId, text: held })
  assert.equal(taken.ok, true)

  const summary = 'Outreach that must not survive its refused entry.'
  await assert.rejects(commitAction(db, 'log_outreach', {
    requestId, target: { kind: 'existing', opportunityId: record.id, expectedVersion: prospect.version },
    occurredOn: '2026-08-19', channel: 'phone', summary, followedUpBy: 'hai', tags: [],
  }, actor), failsWith('journal_write_failed'))

  // No interaction, no prospect change, no receipt: the refusal took the whole
  // transaction with it rather than leaving outreach the Journal never saw.
  assert.equal((await db.query('select id from crm_interactions where organization_id = $1 and summary = $2', [KHYTE, summary])).length, 0)
  assert.equal((await db.query('select request_id from crm_tool_receipts where request_id = $1', [requestId])).length, 0)
  const after = await getRecord(db, { entity: 'prospect', id: record.id }, actor)
  assert.equal(after.version, prospect.version, 'the prospect was never written')
  assert.equal((after.interactions as Row[]).length, (prospect.interactions as Row[]).length)
  // The entry that held the key is untouched by the attempt.
  const [existing] = await db.query<{ body: string; origin: string }>(
    `select e.body, e.origin from journal_entries e
       join captures c on c.id = e.capture_id and c.organization_id = e.organization_id
      where e.organization_id = $1 and c.request_key = $2`, [KHYTE, requestId])
  assert.equal(existing.body, held)
  assert.equal(existing.origin, 'person')
})

test('an outreach whose request key is held by a byte-identical typed entry saves nothing at all', async () => {
  const prospect = await commitAction(db, 'log_outreach', outreach(), actor)
  const record = prospect.record as Row
  const requestId = randomUUID()
  // The near miss the refusal above does not catch by text alone. Same
  // account, same key, same text. Before the request fingerprint (R6)
  // writeEntry read that as this caller's own retry and answered
  // { ok: true, replayed: true } with the TYPED entry, which the id guard in
  // plan.after then refused. Now the fingerprint differs as well — origin,
  // precision, date, performer and links are all part of the request — so
  // writeEntry answers request_key_conflict first; the id guard stays as the
  // second line. Either way nothing is written under generatedId(requestId,
  // 'note'), which is the id the preview and the receipt both name.
  const summary = 'Rang Anna about the renewal.'
  const taken = await createEntry(db, await browserActor(actor.userId, KHYTE),
    { requestKey: requestId, text: summary })
  assert.equal(taken.ok, true)

  await assert.rejects(commitAction(db, 'log_outreach', {
    requestId, target: { kind: 'existing', opportunityId: record.id, expectedVersion: prospect.version },
    occurredOn: '2026-08-19', channel: 'phone', summary, followedUpBy: 'hai', tags: [],
  }, actor), failsWith('journal_write_failed'))

  // No interaction, no prospect change, no receipt - and above all no receipt
  // claiming a journal_entry create for an id that holds nothing.
  assert.equal((await db.query('select id from crm_interactions where organization_id = $1 and summary = $2', [KHYTE, summary])).length, 0)
  assert.equal((await db.query('select request_id from crm_tool_receipts where request_id = $1', [requestId])).length, 0)
  assert.equal((await db.query('select id from journal_entries where organization_id = $1 and id = $2', [KHYTE, generatedId(requestId, 'note')])).length, 0,
    'the derived entry id the receipt would have named was never written')
  const after = await getRecord(db, { entity: 'prospect', id: record.id }, actor)
  assert.equal(after.version, prospect.version, 'the prospect was never written')
  assert.equal((after.interactions as Row[]).length, (prospect.interactions as Row[]).length)
  // The typed entry keeps the key, its text and its own id.
  const [existing] = await db.query<{ id: string; body: string; origin: string }>(
    `select e.id, e.body, e.origin from journal_entries e
       join captures c on c.id = e.capture_id and c.organization_id = e.organization_id
      where e.organization_id = $1 and c.request_key = $2`, [KHYTE, requestId])
  assert.equal(existing.body, summary)
  assert.equal(existing.origin, 'person')
  assert.notEqual(existing.id, generatedId(requestId, 'note'))
})

test('a receipt carries the record, never the Journal text filed against it', async () => {
  const first = await commitAction(db, 'log_outreach', outreach(), actor)
  const id = (first.record as Row).id as string
  const secret = `Private context nobody receipted: ${randomUUID()}`
  const written = await createEntry(db, await browserActor(actor.userId, KHYTE),
    { requestKey: randomUUID(), text: secret, links: [{ type: 'opportunity', id }] })
  assert.equal(written.ok, true)

  const second = await commitAction(db, 'log_outreach', { requestId: randomUUID(),
    target: { kind: 'existing', opportunityId: id, expectedVersion: first.version },
    occurredOn: '2026-08-19', channel: 'email', summary: 'A second touch.', followedUpBy: 'erik', tags: [] }, actor)
  // The tool response carries the Journal …
  assert.ok((second.journal as { entries: Row[] }).entries.some(item => item.body === secret))
  // … and the row that outlives it does not. A receipt is never rewritten, so
  // a copy of an entry here would survive that entry's deletion untouched.
  const [stored] = await db.query<{ result: string }>(
    'select result::text as result from crm_tool_receipts where request_id = $1 and organization_id = $2', [second.requestId, KHYTE])
  assert.ok(!stored.result.includes(secret), 'no receipt may hold Journal text')
  const replayed = JSON.parse(stored.result) as Row
  assert.equal(replayed.journal, undefined)
  assert.equal(replayed.notes, undefined, "Stage 1's receipted notes are retired by the same change")
  assert.ok(replayed.record && replayed.interactions, 'the record itself is still receipted in full')
})

test('list_journal pages a prospect Journal with its cursor, and get_crm_record carries the first page', async () => {
  const saved = await commitAction(db, 'log_outreach', outreach(), actor)
  const id = (saved.record as Row).id as string
  const bodies: string[] = []
  for (let index = 0; index < 3; index += 1) {
    const text = `Journal page entry ${index} ${randomUUID()}`
    bodies.push(text)
    const written = await createEntry(db, await browserActor(actor.userId, KHYTE),
      { requestKey: randomUUID(), text, links: [{ type: 'opportunity', id }] })
    assert.equal(written.ok, true)
  }

  // Three typed entries and the system outreach line: two pages of two.
  const first = await listJournal(db, { target: { entity: 'prospect', id }, limit: 2 }, actor)
  assert.equal((first.entries as Row[]).length, 2)
  assert.ok(first.nextCursor)
  assert.equal((first.coverage as Row).hasMore, true)
  const second = await listJournal(db, { target: { entity: 'prospect', id }, limit: 2, cursor: first.nextCursor }, actor)
  assert.equal((second.entries as Row[]).length, 2)
  assert.equal(second.nextCursor, null)
  assert.equal((second.coverage as Row).hasMore, false)
  const walked = [...(first.entries as Row[]), ...(second.entries as Row[])].map(item => item.id)
  assert.equal(new Set(walked).size, 4, 'the cursor walks without repeating or skipping a row')
  assert.equal((await listJournal(db, { target: { entity: 'prospect', id }, cursor: 'not-a-cursor' }, actor).catch(safeError)).code, 'journal_invalid')

  const record = await getRecord(db, { entity: 'prospect', id }, actor)
  const journal = record.journal as { entries: Row[]; nextCursor: string | null; coverage: Row }
  assert.equal(journal.entries.length, 4)
  assert.equal(journal.nextCursor, null)
  assert.equal(journal.coverage.returned, 4)
  for (const body of bodies) assert.ok(journal.entries.some(item => item.body === body), body)
  // Exactly the fields the tool contract names — no organizationId, captureId
  // or migration bookkeeping leaking out of the view.
  // Thirteen since R8: `systemEvent` joined the twelve, because a
  // next-step-change entry's body is the previous step alone and reads as a
  // bare sentence without it.
  assert.deepEqual(Object.keys(journal.entries[0]).sort(),
    ['authorId', 'body', 'createdAt', 'id', 'kind', 'occurredAt', 'occurredOn', 'occurredPrecision', 'origin', 'performer', 'revision', 'systemEvent', 'title'])
  assert.ok(journal.entries.every(item => item.systemEvent === null), 'typed entries and the outreach line carry no system event')
  // journalCursor pages the prospect read the same way.
  const oneDeep = await listJournal(db, { target: { entity: 'prospect', id }, limit: 1 }, actor)
  const paged = await getRecord(db, { entity: 'prospect', id, journalCursor: oneDeep.nextCursor }, actor)
  assert.equal((paged.journal as { entries: Row[] }).entries.length, 3)
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

  // No Journal page per row. A batch keeps a status and an id and throws the
  // rest away, so reading one per row - inside the transaction, under the tools
  // lock - was work nobody could ever see.
  for (const row of first.saved) assert.equal((row as Row).journal, undefined)
  const quiet = await commitAction(db, 'log_outreach', outreach(), actor, { includeJournal: false })
  assert.equal(quiet.journal, undefined, 'includeJournal: false is what the batch passes')
  assert.ok(quiet.record, 'and it changes nothing else about the answer')
  assert.equal(quiet.status, 'saved')

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
function authorization(scope = 'crm:read crm:tasks:write') {
  return validateAuthorization({ response_type: 'code', client_id: config().clientId, redirect_uri: config().redirects[0],
    state: 'state-value', resource: config().resource, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256', scope })
}
function tokenForm(code: string) {
  return new URLSearchParams({ grant_type: 'authorization_code', client_id: config().clientId, client_secret: config().clientSecret,
    redirect_uri: config().redirects[0], code, code_verifier: verifier, resource: config().resource })
}
/** An RFC 7009 revocation request: the client, and the token to end. */
function revocationForm(token: string) {
  return new URLSearchParams({ client_id: config().clientId, client_secret: config().clientSecret, token })
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
  const code = new URL(await issueCode(db, validateAuthorization(base), await codeIdentity(actor))).searchParams.get('code')!
  const form = tokenForm(code); form.delete('resource')
  assert.equal((await exchangeToken(db, form)).token_type, 'Bearer')
})

test('OAuth binds callback/resource/client/PKCE, consumes codes once, rotates tokens and revokes', async () => {
  assert.equal(authorizationMetadata().code_challenge_methods_supported[0], 'S256')
  assert.throws(() => validateAuthorization({ ...authorization(), redirect_uri: 'https://evil.example/' }), /Unrecognized/)
  assert.throws(() => validateAuthorization({ ...authorization(), resource: 'https://evil.example/mcp' }), /Unrecognized/)
  assert.throws(() => validateAuthorization({ ...authorization(), scope: 'crm:read admin' }), /supported/)
  const callback = new URL(await issueCode(db, authorization(), await codeIdentity(actor))), code = callback.searchParams.get('code')!
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
    assert.equal(list.tools.length, 14)
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
    if (call.method === 'tools/list') assert.equal(data.result.tools.length, 14)
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

  // The Journal answers the same way. A prospect id that is not theirs is not
  // found, and the whole-workspace feed — which takes no target at all — is
  // still only ever their own organization's entries.
  const ours = ((await getRecord(db, { entity: 'prospect', id: record.id }, actor)).journal as { entries: Row[] }).entries.map(item => item.id)
  assert.ok(ours.length, 'the logged outreach left an entry there to hide')
  await assert.rejects(listJournal(db, { target: { entity: 'prospect', id: record.id } }, otherActor), failsWith('not_found'))
  await assert.rejects(listJournal(db, { target: { entity: 'company', id: record.companyId } }, otherActor), failsWith('not_found'))
  assert.ok(!((await listJournal(db, {}, otherActor)).entries as Row[]).some(item => ours.includes(item.id)))

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
    assert.equal((await client.callTool({ name: 'list_journal', arguments: { target: { entity: 'prospect', id: record.id } } })).isError, true)
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
  const token = await approve({ userId: leaving.userId, organizationId: KHYTE })
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

test('an MCP connection carries the person who approved it, their organization and their membership, and nothing less', async () => {
  const minted = await codeIdentity(actor)
  const callback = new URL(await issueCode(db, authorization(), minted)), code = callback.searchParams.get('code')!
  const [stored] = await db.query<{ user_id: string; organization_id: string; member_id: string; member_generation: string }>(
    'select user_id, organization_id, member_id, member_generation from crm_oauth_codes where code_hash = $1', [hashToken(code)])
  assert.deepEqual(stored, { user_id: actor.userId, organization_id: KHYTE, member_id: minted.memberId, member_generation: minted.credentialGeneration })
  const token = await exchangeToken(db, tokenForm(code))
  const principal = await authenticateBearer(db, `Bearer ${token.access_token}`)
  assert.equal(principal.userId, actor.userId)
  assert.equal(principal.organizationId, KHYTE)
  // The connection carries the membership and the generation forward, which
  // is what every later credential check joins on.
  const [connection] = await db.query<{ user_id: string; organization_id: string; member_id: string; member_generation: string }>(
    'select user_id, organization_id, member_id, member_generation from crm_oauth_connections where id = $1', [principal.connectionId])
  assert.deepEqual(connection, { user_id: actor.userId, organization_id: KHYTE, member_id: minted.memberId, member_generation: minted.credentialGeneration })

  // A code with no person behind it — the legacy shape — is refused however
  // well-formed the rest of it is.
  const orphan = randomUUID(), a = authorization()
  await db.query(`insert into crm_oauth_codes (code_hash, client_id, redirect_uri, challenge, scopes, resource, expires_at, user_id, organization_id)
    values ($1, $2, $3, $4, $5::text[], $6, now() + interval '5 minutes', null, $7)`,
    [hashToken(orphan), a.client_id, a.redirect_uri, a.code_challenge, a.scope.split(' '), a.resource, KHYTE])
  await assert.rejects(exchangeToken(db, tokenForm(orphan)), failsWith('invalid_grant'))

  // And a code whose membership is not this organization's cannot finish
  // connecting either. The exchange joins the membership id, the account, the
  // organization and the generation together, so a real membership borrowed
  // from somewhere else is worth no more than an invented one — which is also
  // why the id here is a real row: member_id is a foreign key.
  const theirs = await membership(otherActor.userId, OTHER_ORG)
  const stranded = new URL(await issueCode(db, authorization(), { userId: otherActor.userId, organizationId: KHYTE, ...theirs })).searchParams.get('code')!
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
  const minted = await membership(minter.userId, KHYTE)
  const token = displayToken({ organizationId: KHYTE, ...minted }, 'erik')!
  assert.ok(token)
  assert.deepEqual(verifyDisplayToken('erik', token), { organizationId: KHYTE, memberId: minted.memberId, credentialGeneration: minted.credentialGeneration })
  assert.equal(await resolveDisplayGrant(db, 'erik', token), KHYTE)

  // The colleague is inside the HMAC, so one link is one board — a wallpaper
  // pointed at a teammate's numbers is a different link, deliberately minted.
  assert.equal(verifyDisplayToken('abdi', token), null)
  assert.equal(await resolveDisplayGrant(db, 'abdi', token), null)

  // So are the member id and the generation. Swapping either for another real
  // value does not borrow that link; it produces a signature that does not
  // verify.
  const [, , , sig] = token.split('.')
  const other = await membership(bystander.userId, KHYTE)
  const tampered = `${KHYTE}.${other.memberId}.${minted.credentialGeneration}.${sig}`
  assert.equal(verifyDisplayToken('erik', tampered), null)
  assert.equal(await resolveDisplayGrant(db, 'erik', tampered), null)
  assert.equal(verifyDisplayToken('erik', `${KHYTE}.${minted.memberId}.${other.credentialGeneration}.${sig}`), null)
  assert.equal(await resolveDisplayGrant(db, 'erik', `${KHYTE}.${minted.memberId}.${minted.credentialGeneration}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`), null)
  assert.equal(await resolveDisplayGrant(db, 'erik', undefined), null)
  assert.equal(await resolveDisplayGrant(db, undefined, token), null)
  // Three parts is the old shape; it verifies as nothing at all.
  assert.equal(verifyDisplayToken('erik', `${KHYTE}.${minted.memberId}.${sig}`), null)

  // A link minted in the other organization opens that organization's board
  // and only ever that one …
  const theirs = await membership(otherActor.userId, OTHER_ORG)
  assert.equal(await resolveDisplayGrant(db, 'erik', displayToken({ organizationId: OTHER_ORG, ...theirs }, 'erik')), OTHER_ORG)
  // … and naming Khyte in the clear half of the token does not move it there:
  // the membership is looked up inside the organization the token claims, so
  // a member of somewhere else is simply not found.
  assert.equal(await resolveDisplayGrant(db, 'erik', displayToken({ organizationId: KHYTE, ...theirs }, 'erik')), null)

  // Revocation is what ends a link, and it ends exactly the revoked person's.
  const survivor = displayToken({ organizationId: KHYTE, ...other }, 'abdi')!
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
  const mine = await approve({ userId: person.userId, organizationId: KHYTE })
  const theirs = await approve({ userId: person.userId, organizationId: OTHER_ORG })
  assert.equal(await revokeConnectionsForUser(db, person.userId, KHYTE), 1)
  await assert.rejects(authenticateBearer(db, `Bearer ${mine.access_token}`), failsWith('unauthorized'))
  assert.equal((await authenticateBearer(db, `Bearer ${theirs.access_token}`)).organizationId, OTHER_ORG)
})

/* ———— Stage 1 acceptance criteria ————
 *
 * One test per criterion from the audit, named after it. Everything above
 * proves the shapes these rely on; these are the withdrawal-of-access rules
 * themselves — what stops working, when, and what must keep working beside it.
 */

test('acceptance 1 — a wallpaper link dies with the membership that minted it, and does not come back', async () => {
  const person = await member(KHYTE, { displayName: 'Wallpaper Lifecycle' })
  const first = await membership(person.userId, KHYTE)
  const link = displayToken({ organizationId: KHYTE, ...first }, 'erik')!
  assert.equal(await resolveDisplayGrant(db, 'erik', link), KHYTE)

  // Revoked: the link is refused, though the signature is as good as it ever was.
  await revokeMember(db, KHYTE, person.memberId)
  assert.equal(await resolveDisplayGrant(db, 'erik', link), null)
  assert.ok(verifyDisplayToken('erik', link), 'refused by the membership lookup, not by the HMAC')

  // Re-added: the same membership row is active again — and this is the case
  // the generation exists for. Without it the old link would open the board
  // again the moment the person came back.
  const again = await addMember(db, { organizationId: KHYTE, userId: person.userId, email: person.email, displayName: 'Wallpaper Lifecycle', role: 'member', colleague: null })
  assert.equal(again.id, person.memberId, 'reactivated, not a second membership')
  assert.equal(again.status, 'active')
  const second = await membership(person.userId, KHYTE)
  assert.notEqual(second.credentialGeneration, first.credentialGeneration, 'reactivation rotates the generation')
  assert.equal(await resolveDisplayGrant(db, 'erik', link), null, 'the link minted before the revoke stays dead')
  assert.ok(verifyDisplayToken('erik', link))
  // A link minted now works, so what died is the credential and not the board.
  const fresh = displayToken({ organizationId: KHYTE, ...second }, 'erik')!
  assert.equal(await resolveDisplayGrant(db, 'erik', fresh), KHYTE)

  // A password reset ends links the same way: whoever copied one had it while
  // the old password still opened the app.
  let replaced = 0
  const reset = await resetCredentials(db, { organizationId: KHYTE, memberId: person.memberId }, {}, async (target) => {
    assert.equal(target.userId, person.userId)
    replaced += 1
  })
  assert.equal(replaced, 1, 'the password callback runs inside the transaction')
  assert.equal(reset.id, person.memberId)
  assert.equal(await resolveDisplayGrant(db, 'erik', fresh), null)
  assert.ok(verifyDisplayToken('erik', fresh))
  const third = await membership(person.userId, KHYTE)
  assert.notEqual(third.credentialGeneration, second.credentialGeneration)
  assert.equal(await resolveDisplayGrant(db, 'erik', displayToken({ organizationId: KHYTE, ...third }, 'erik')), KHYTE)
})

test('acceptance 2 — an authorization code and the connection it becomes die with the membership behind them', async () => {
  const person = await member(KHYTE, { displayName: 'Code Holder' })
  const who = { userId: person.userId, organizationId: KHYTE }
  const codeFor = async () => new URL(await issueCode(db, authorization(), await codeIdentity(who))).searchParams.get('code')!
  const codeExists = async (code: string) => (await db.query('select code_hash from crm_oauth_codes where code_hash = $1', [hashToken(code)])).length

  // The ordinary path, so the refusals below mean something: a code exchanges
  // once and the connection it creates authenticates.
  const plain = await codeFor()
  const token = await exchangeToken(db, tokenForm(plain))
  assert.equal((await authenticateBearer(db, `Bearer ${token.access_token}`)).userId, person.userId)

  // Revoked and re-added inside the five minutes a code lives. Two rules
  // refuse it and the first one wins: revokeMember discards this
  // organization's pending codes outright, so the exchange never gets as far
  // as the membership — which is why the assertion here is the error code and
  // the missing row rather than the 'active member' message.
  const pending = await codeFor()
  await revokeMember(db, KHYTE, person.memberId)
  assert.equal(await codeExists(pending), 0, 'revoking a membership throws away the codes it has not yet exchanged')
  await addMember(db, { organizationId: KHYTE, userId: person.userId, email: person.email, displayName: 'Code Holder', role: 'member', colleague: null })
  await assert.rejects(exchangeToken(db, tokenForm(pending)), failsWith('invalid_grant'))

  // The generation check underneath it, reached by moving the generation
  // without touching the codes — what the members script or a manual update
  // does. The code row is still there, and is still refused.
  const stale = await codeFor()
  await db.query('update organization_members set credential_generation = gen_random_uuid() where id = $1', [person.memberId])
  assert.equal(await codeExists(stale), 1)
  await assert.rejects(exchangeToken(db, tokenForm(stale)), /active member/)
  // The failed exchange rolled back, its deletion of the code included, so a
  // second attempt finds the same answer rather than a spent code.
  assert.equal(await codeExists(stale), 1)
  await assert.rejects(exchangeToken(db, tokenForm(stale)), /active member/)

  // A password reset discards pending codes everywhere, for the same reason a
  // revoke discards this organization's.
  const duringReset = await codeFor()
  await resetCredentials(db, { organizationId: KHYTE, memberId: person.memberId }, {}, async () => {})
  assert.equal(await codeExists(duringReset), 0)
  await assert.rejects(exchangeToken(db, tokenForm(duringReset)), failsWith('invalid_grant'))

  // And a connection approved before a reset no longer authenticates after
  // it. Not merely because the row was revoked: clearing revoked_at by hand —
  // the "some other path" the membership join exists for — leaves it refused
  // all the same, because its generation is no longer the membership's.
  const fresh = await approve(who)
  const live = await authenticateBearer(db, `Bearer ${fresh.access_token}`)
  await resetCredentials(db, { organizationId: KHYTE, memberId: person.memberId }, {}, async () => {})
  await assert.rejects(authenticateBearer(db, `Bearer ${fresh.access_token}`), failsWith('unauthorized'))
  await db.query('update crm_oauth_connections set revoked_at = null where id = $1', [live.connectionId])
  await assert.rejects(authenticateBearer(db, `Bearer ${fresh.access_token}`), failsWith('unauthorized'))
  const [row] = await db.query<{ member_generation: string }>('select member_generation from crm_oauth_connections where id = $1', [live.connectionId])
  assert.notEqual(row.member_generation, (await membership(person.userId, KHYTE)).credentialGeneration)
})

test('acceptance 3 — a tool write stops the moment the membership behind its connection is revoked', async () => {
  const person = await member(KHYTE, { displayName: 'Cut Off Mid-Session' })
  const principal = await connect(person.userId, KHYTE)
  const input = { ...task(), title: `Proposal ${randomUUID()}` }

  // Authenticated, then revoked, then writing: the check the connection passed
  // when the request arrived is not the check that lets it write.
  await revokeMember(db, KHYTE, person.memberId)
  await assert.rejects(commitAction(db, 'create_task', input, principal), /unauthorized|lost its access/)
  assert.equal((await db.query('select request_id from crm_tool_receipts where request_id = $1', [input.requestId])).length, 0,
    'a refused write is not receipted')
  assert.equal((await db.query('select id from tasks where title = $1', [input.title])).length, 0, 'and writes nothing')

  // Mid-batch. A bulk import commits one row at a time, for minutes; access
  // withdrawn while it runs has to stop the very next row, not the next
  // request. The wrapper revokes the membership the moment the first row's
  // transaction has committed.
  const importer = await member(KHYTE, { displayName: 'Bulk Importer' })
  const actingAs = await connect(importer.userId, KHYTE)
  let commits = 0
  const cutting: Database = {
    ...db,
    transaction: async (run) => {
      const result = await db.transaction(run)
      commits += 1
      // Revoked on the underlying database, so this revoke is not itself counted.
      if (commits === 1) await revokeMember(db, KHYTE, importer.memberId)
      return result
    },
  }
  const batch = await commitBulkOutreach(cutting, {
    batchId: randomUUID(),
    defaults: { occurredOn: '2026-08-24', channel: 'email' as const, summary: 'Cut off mid-batch.', followedUpBy: 'erik' as const },
    records: [
      { ref: 'one', companyName: `Mid Batch One ${randomUUID()}`, contactName: 'Ann', email: `${randomUUID()}@example.test` },
      { ref: 'two', companyName: `Mid Batch Two ${randomUUID()}`, contactName: 'Bo', email: `${randomUUID()}@example.test` },
      { ref: 'three', companyName: `Mid Batch Three ${randomUUID()}`, contactName: 'Cyl', email: `${randomUUID()}@example.test` },
    ],
    previewToken: 'unused-by-the-service-layer',
  }, actingAs)

  assert.equal(batch.counts.saved, 1, 'exactly the row that committed before the revoke')
  assert.equal(batch.counts.failed, 2)
  assert.deepEqual(batch.failed.map(row => row.code), ['unauthorized', 'unauthorized'])
  assert.deepEqual(batch.saved.map(row => row.ref), ['one'])
  assert.equal((await db.query<{ n: number }>('select count(*)::int as n from crm_tool_receipts where connection_id = $1', [actingAs.connectionId]))[0].n, 1,
    'one receipt, matching the one row that landed')
})

/* Acceptance 4 — the client store refusing a snapshot belonging to another
 * identity — lives in tests/store.test.ts. The store is a client module and
 * cannot be imported under --conditions=react-server, which this suite needs;
 * it now runs for real in its own suite rather than skipping here. */

test('acceptance 5 — two organizations cannot claim one account, and a claim is all-or-nothing', async () => {
  const claimant = (organizationId: string, userId: string, email: string) => ({
    organizationId, userId, email, displayName: 'Claimed Person', role: 'member' as const, colleague: null,
  })
  const account = async () => {
    const userId = randomUUID(), email = `${userId.slice(0, 8)}@example.test`
    await db.query('insert into auth.users (id, email) values ($1, $2)', [userId, email])
    return { userId, email }
  }
  const memberships = async (userId: string) =>
    db.query<{ organization_id: string; status: string }>('select organization_id, status from organization_members where user_id = $1', [userId])

  // Khyte claims a fresh account: the membership is written and the password
  // callback runs inside the transaction that wrote it.
  const first = await account()
  let khyteCalls = 0
  const claimed = await claimAccount(db, claimant(KHYTE, first.userId, first.email), {}, async (m) => {
    assert.equal(m.userId, first.userId)
    khyteCalls += 1
  })
  assert.equal(claimed.status, 'active')
  assert.equal(khyteCalls, 1)

  // The other organization cannot take it over — and, crucially, never
  // touches the password: the refusal happens under the account lock, before
  // the callback.
  let otherCalls = 0
  await assert.rejects(
    claimAccount(db, claimant(OTHER_ORG, first.userId, first.email), {}, async () => { otherCalls += 1 }),
    failsWith('belongs_elsewhere'))
  assert.equal(otherCalls, 0, 'the loser must not replace a password it was refused the right to')
  assert.deepEqual(await memberships(first.userId), [{ organization_id: KHYTE, status: 'active' }])

  // A callback that throws — Supabase Auth refusing the password — rolls the
  // membership back. The account is left exactly as it was.
  const refused = await account()
  await assert.rejects(
    claimAccount(db, claimant(KHYTE, refused.userId, refused.email), {}, async () => { throw new Error('auth service unavailable') }),
    /auth service unavailable/)
  assert.deepEqual(await memberships(refused.userId), [], 'nothing was saved')

  // The one failure a transaction cannot undo: the password was replaced and
  // a later step failed. The membership rolls back, the password does not —
  // and the callback's own bookkeeping is what lets app/actions/members.ts
  // answer 'membership_unsaved' instead of a generic failure.
  const stranded = await account()
  let passwordReplaced = false
  const failing: Database = { ...db, transaction: run => db.transaction(tx => run({
    async query<T extends Row>(sql: string, values: unknown[] = []) {
      if (sql.includes('delete from crm_oauth_codes')) throw new Error('simulated failure after the password call')
      return tx.query<T>(sql, values)
    },
  })) }
  await assert.rejects(
    claimAccount(failing, claimant(KHYTE, stranded.userId, stranded.email), {}, async () => { passwordReplaced = true }),
    /simulated failure/)
  assert.equal(passwordReplaced, true, 'the password call did happen')
  assert.deepEqual(await memberships(stranded.userId), [], 'and the membership did not')

  // A reset is refused for a shared account for the same reason a claim is,
  // and likewise before the password is touched: that password is the
  // person's, not one organization's.
  const shared = await account()
  const here = await claimAccount(db, claimant(KHYTE, shared.userId, shared.email), {}, async () => {})
  await addMember(db, claimant(OTHER_ORG, shared.userId, shared.email))
  let resetCalls = 0
  await assert.rejects(
    resetCredentials(db, { organizationId: KHYTE, memberId: here.id }, {}, async () => { resetCalls += 1 }),
    failsWith('shared_account'))
  assert.equal(resetCalls, 0)
})

test('acceptance 6 — an administration is re-checked against its acting owner inside the lock', async () => {
  const owner = await member(KHYTE, { role: 'owner', displayName: 'Acting Owner' })
  const plain = await member(KHYTE, { displayName: 'Plain Member' })
  const target = await member(KHYTE, { displayName: 'The Target' })

  // An owner may. A member of the same organization may not, however true the
  // rest of the request is.
  await assert.rejects(revokeMember(db, KHYTE, target.memberId, { actingUserId: plain.userId }), failsWith('forbidden'))
  await assert.rejects(updateMember(db, KHYTE, target.memberId, { displayName: 'Renamed' }, { actingUserId: plain.userId }), failsWith('forbidden'))
  // Nor may somebody who is no member of this organization at all — an owner
  // of the other one included.
  await assert.rejects(updateMember(db, KHYTE, target.memberId, { displayName: 'Renamed' }, { actingUserId: otherActor.userId }), failsWith('forbidden'))
  assert.equal((await updateMember(db, KHYTE, target.memberId, { displayName: 'Renamed' }, { actingUserId: owner.userId })).displayName, 'Renamed')

  // An owner revoked a moment ago must not finish an administration they
  // began: the check is made inside the lock, against the database, not
  // against whatever the request arrived with.
  await revokeMember(db, KHYTE, owner.memberId, { actingUserId: actor.userId })
  await assert.rejects(revokeMember(db, KHYTE, target.memberId, { actingUserId: owner.userId }), failsWith('forbidden'))
  await assert.rejects(updateMember(db, KHYTE, target.memberId, { role: 'owner' }, { actingUserId: owner.userId }), failsWith('forbidden'))
  assert.equal((await db.query<{ status: string }>('select status from organization_members where id = $1', [target.memberId]))[0].status, 'active')

  // The last-owner rules are unchanged by any of this: an acting owner cannot
  // revoke or demote the organization's last owner, themselves included.
  const [sole] = await db.query<{ id: string }>(
    'select id from organization_members where organization_id = $1 and user_id = $2', [OTHER_ORG, otherActor.userId])
  await assert.rejects(revokeMember(db, OTHER_ORG, sole.id, { actingUserId: otherActor.userId }), failsWith('last_owner'))
  await assert.rejects(updateMember(db, OTHER_ORG, sole.id, { role: 'member' }, { actingUserId: otherActor.userId }), failsWith('last_owner'))
  assert.ok((await db.query<{ n: number }>(
    `select count(*)::int as n from organization_members where organization_id = $1 and role = 'owner' and status = 'active'`, [KHYTE]))[0].n >= 1)
})

/* ———— Second review ————
 *
 * The four findings of the second Stage 1 review, each exercised against the
 * real code rather than a description of it.
 *
 *   R1  the scope a browser sends is an expectation, checked before anything
 *       is looked up (scopeMatches; the Server Action around it is the gate).
 *   R2  organization advisory lock, then account advisory lock, then rows —
 *       everywhere. The orderings themselves need two connections and live in
 *       tests/mcp-postgres.test.ts; what is here is the sequential outcome.
 *   R3  a revoked token stops the next tool write.
 *   R4  after a failure that follows an external side effect, the flow reads
 *       the database and answers from what it finds — and it looks for ITS
 *       OWN commit, by the generation its claim chose, which is the third
 *       review's finding and the race below.
 */

/**
 * The account service the flows are given, as a fake that records what it was
 * asked and writes to the stubbed auth.users instead of GoTrue.
 *
 * A fake provider rather than a fake flow: lib/org/administration.ts,
 * lib/org/members.ts and every lock and constraint under them are the real
 * ones. Only the one thing SQL cannot undo — a call to Supabase Auth — is
 * replaced, which is precisely the thing these tests need to be able to fail
 * on command.
 */
function fakeIdentity(onSetPassword?: (userId: string) => Promise<void>) {
  const calls = { findAccountByEmail: 0, createAccount: 0, setPassword: 0 }
  const passwords = new Map<string, string>()
  const provider: IdentityProvider = {
    async findAccountByEmail(queryable, email) {
      calls.findAccountByEmail += 1
      const [row] = await queryable.query<{ id: string; email: string }>('select id, email from auth.users where email = $1', [email])
      return row ? { userId: row.id, email: row.email } : null
    },
    async createAccount({ email, password }) {
      calls.createAccount += 1
      const userId = randomUUID()
      await db.query('insert into auth.users (id, email) values ($1, $2)', [userId, email])
      passwords.set(userId, password)
      return { userId }
    },
    async setPassword(userId, password) {
      calls.setPassword += 1
      if (onSetPassword) await onSetPassword(userId)
      passwords.set(userId, password)
    },
  }
  return { provider, calls, passwords }
}

/** A fresh address with no account behind it. */
const freshEmail = () => `${randomUUID().slice(0, 8)}@example.test`

/** An account with no membership anywhere — the "existing account" the add
 *  flow takes over rather than creates. */
async function unattachedAccount() {
  const userId = randomUUID(), email = freshEmail()
  await db.query('insert into auth.users (id, email) values ($1, $2)', [userId, email])
  return { userId, email }
}

const addRequest = (email: string): AddMemberRequest => ({ email, displayName: 'Flow Person', role: 'member', colleague: null })

const activeMemberships = async (userId: string) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from organization_members where user_id = $1 and status = 'active'`, [userId]))[0].n

/** The database call fails before it starts: nothing was written, and the
 *  caller cannot know that from the exception alone. */
const neverCommits: Database = { ...db, transaction: async () => { throw new Error('the connection dropped before the transaction began') } }

/** The transaction commits and the acknowledgement is lost on the way back —
 *  the failure that looks identical to the one above and is its opposite. */
const lostAcknowledgement: Database = {
  ...db,
  transaction: async (run) => { await db.transaction(run); throw new Error('the commit was acknowledged to nobody') },
}

test('R1 — the scope a browser sends matches only the session that arrived', () => {
  const context = { organizationId: KHYTE, userId: actor.userId }
  assert.equal(scopeMatches(context, { organizationId: KHYTE, userId: actor.userId }), true)
  // A Settings dialog opened in one workspace and submitted after another tab
  // logged in: the session is perfectly valid and belongs somewhere else.
  assert.equal(scopeMatches(context, { organizationId: OTHER_ORG, userId: actor.userId }), false)
  // The same workspace, a different person — the cookie changed under the tab.
  assert.equal(scopeMatches(context, { organizationId: KHYTE, userId: otherActor.userId }), false)
  assert.equal(scopeMatches(context, { organizationId: OTHER_ORG, userId: otherActor.userId }), false)
})

test('R4 — an account created and then not saved is reported as unsaved, and the retry repairs it', async () => {
  const owner = await member(KHYTE, { role: 'owner', displayName: 'Unsaved Owner' })
  const admin: Administrator = { organizationId: KHYTE, userId: owner.userId }
  const { provider, calls } = fakeIdentity()
  const email = freshEmail()

  // The account is created, and then the membership never reaches the
  // database at all. The flow re-reads rather than guessing: no membership,
  // so it says which half is unfinished. (It logs the cause as it does so.)
  const stranded = await addMemberFlow(neverCommits, provider, admin, addRequest(email), 'stranded-password')
  assert.deepEqual(stranded, { ok: false, error: 'membership_unsaved' })
  assert.equal(calls.createAccount, 1)
  const [account] = await db.query<{ id: string }>('select id from auth.users where email = $1', [email])
  assert.ok(account, 'the account the owner was never told about exists')
  assert.equal(await activeMemberships(account.id), 0, 'and nothing on the roster')

  // The retry is the repair: the same address now has an account, so the flow
  // takes it over and replaces the password rather than creating a second.
  const retried = await addMemberFlow(db, provider, admin, addRequest(email), 'retried-password')
  assert.equal(retried.ok, true)
  assert.equal(retried.ok && retried.temporaryPassword, 'retried-password')
  assert.equal(retried.ok && retried.member.userId, account.id)
  assert.equal(calls.createAccount, 1, 'no second account for the same address')
  assert.equal(calls.setPassword, 1, 'the existing account had its password replaced instead')
  assert.equal(await activeMemberships(account.id), 1)
})

test('R4 — a commit whose acknowledgement was lost still hands the owner the password', async () => {
  const owner = await member(KHYTE, { role: 'owner', displayName: 'Lost Ack Owner' })
  const admin: Administrator = { organizationId: KHYTE, userId: owner.userId }

  // An existing account: the password was replaced inside the transaction
  // that committed, so the owner must be given it — reporting a failure here
  // would leave a person locked out of an account nobody can name.
  const taken = await unattachedAccount()
  const existing = fakeIdentity()
  const first = await addMemberFlow(lostAcknowledgement, existing.provider, admin, addRequest(taken.email), 'reconciled-password')
  assert.equal(first.ok, true)
  assert.equal(first.ok && first.temporaryPassword, 'reconciled-password')
  assert.equal(first.ok && first.member.userId, taken.userId)
  assert.equal(existing.calls.setPassword, 1)
  assert.equal(existing.calls.createAccount, 0)
  assert.equal(await activeMemberships(taken.userId), 1, 'exactly the membership that committed')

  // A brand-new account reaches the same answer by the other route: the
  // account was created before the transaction, so the side effect stands
  // whichever way the commit went.
  const created = fakeIdentity()
  const email = freshEmail()
  const second = await addMemberFlow(lostAcknowledgement, created.provider, admin, addRequest(email), 'new-account-password')
  assert.equal(second.ok, true)
  assert.equal(second.ok && second.temporaryPassword, 'new-account-password')
  assert.equal(created.calls.createAccount, 1)
  assert.equal(created.calls.setPassword, 0, 'a new account is created with the password already set')
  const [account] = await db.query<{ id: string }>('select id from auth.users where email = $1', [email])
  assert.equal(await activeMemberships(account.id), 1)
})

/**
 * The third review's finding, as the interleaving that produced it.
 *
 * Two owners add the same new address in the same moment. Owner A is first
 * into the account service and is still waiting for its reply when owner B
 * finds the account A has just created, claims it, and replaces its password
 * with one of B's own. A then meets `already_member` — with an account
 * creation behind it that SQL cannot undo — and has to decide what to tell
 * its owner. "There is an active membership, so mine committed" was the
 * answer that was wrong: the password it hands over is A's, and the one the
 * account has is B's. The generation A's claim stamped is what tells the two
 * memberships apart.
 */
test('R4 — a claim overtaken by another owner reports it rather than handing over the stale password', async () => {
  const ownerA = await member(KHYTE, { role: 'owner', displayName: 'Racing Owner A' })
  const ownerB = await member(KHYTE, { role: 'owner', displayName: 'Racing Owner B' })
  const adminA: Administrator = { organizationId: KHYTE, userId: ownerA.userId }
  const adminB: Administrator = { organizationId: KHYTE, userId: ownerB.userId }
  const email = freshEmail()

  // One account service for both owners, so `passwords` holds what the
  // account actually has rather than what either owner believes it has.
  const service = fakeIdentity()
  // What owner B's run produced, in an array because it is assigned from
  // inside the provider callback.
  const byB: Array<{ result: MemberResult; generation: string }> = []

  // The interleaving itself, made deterministic rather than hoped for: B's
  // whole flow runs inside A's account creation — after the account exists
  // and before A's claim has begun.
  const racing: IdentityProvider = {
    ...service.provider,
    async createAccount(input) {
      const created = await service.provider.createAccount(input)
      const result = await addMemberFlow(db, service.provider, adminB, addRequest(email), 'password-b')
      byB.push({ result, generation: (await membership(created.userId, KHYTE)).credentialGeneration })
      return created
    },
  }

  const a = await addMemberFlow(db, racing, adminA, addRequest(email), 'password-a')

  // B won, and B's owner is told so: the claim committed and the password B
  // was given is the one the person will use.
  const [b] = byB
  assert.ok(b, "owner B's add ran inside the account service's reply")
  assert.equal(b.result.ok, true)
  assert.equal(b.result.ok && b.result.temporaryPassword, 'password-b')

  // A lost, and says which way it lost. Not a plain refusal — the account it
  // created is still there — and above all not success.
  assert.deepEqual(a, { ok: false, error: 'claim_superseded' })

  const [account] = await db.query<{ id: string }>('select id from auth.users where email = $1', [email])
  assert.ok(account, 'the address has the one account A created')
  assert.equal(service.calls.createAccount, 1, 'one account for the address, not one per owner')
  assert.equal(await activeMemberships(account.id), 1, 'and one membership')
  const now = await membership(account.id, KHYTE)
  assert.equal(now.memberId, b.result.ok && b.result.member.id, "the membership on the roster is B's")
  assert.equal(now.credentialGeneration, b.generation, "carrying the generation B's claim wrote, not A's")

  // What the finding comes down to: A's password was never the account's, and
  // A was never handed it to pass on.
  assert.equal(service.calls.setPassword, 1, "only B's claim replaced a password")
  assert.equal(service.passwords.get(account.id), 'password-b')
})

test('R4 — an account that is already a member is refused before the account service is touched', async () => {
  const owner = await member(KHYTE, { role: 'owner', displayName: 'Already Member Owner' })
  const admin: Administrator = { organizationId: KHYTE, userId: owner.userId }
  const person = await member(KHYTE, { displayName: 'Already On The Roster' })
  const before = await membership(person.userId, KHYTE)
  const session = await login(person.userId, KHYTE)

  // The other way a flow meets `already_member`, and the one with nothing
  // behind it: the pre-check refuses the add before an account is created or
  // a password replaced. No external side effect, so nothing is reconciled —
  // the flow answers from the exception, and the reconciliation above never
  // runs to mistake somebody else's membership for its own.
  const { provider, calls, passwords } = fakeIdentity()
  const result = await addMemberFlow(db, provider, admin, addRequest(person.email), 'never-handed-over')
  assert.deepEqual(result, { ok: false, error: 'already_member' })
  assert.equal(calls.findAccountByEmail, 1)
  assert.equal(calls.createAccount, 0, 'the address already has an account')
  assert.equal(calls.setPassword, 0, 'which keeps the password it had')
  assert.equal(passwords.size, 0)

  // And nothing moved: the same membership, on the generation it already
  // carried, with the person still logged in behind it.
  assert.equal(await activeMemberships(person.userId), 1)
  assert.deepEqual(await membership(person.userId, KHYTE), before)
  assert.equal((await resolveAuthContext(db, session.cookie))?.viewer.memberId, person.memberId)
})

test('R4 — a reset answers from the generation it chose, not from the exception', async () => {
  const owner = await member(KHYTE, { role: 'owner', displayName: 'Reset Owner' })
  const admin: Administrator = { organizationId: KHYTE, userId: owner.userId }
  const person = await member(KHYTE, { displayName: 'Reset Target' })
  const before = await membership(person.userId, KHYTE)
  const session = await login(person.userId, KHYTE)

  // Committed, and then the acknowledgement was lost. The generation the
  // reset chose is on the row, so the reset did happen and the owner gets the
  // password they must hand over.
  const { provider, calls } = fakeIdentity()
  const reset = await resetPasswordFlow(lostAcknowledgement, provider, admin, person.memberId, 'reset-password')
  assert.equal(reset.ok, true)
  assert.equal(reset.ok && reset.temporaryPassword, 'reset-password')
  assert.equal(calls.setPassword, 1)
  const after = await membership(person.userId, KHYTE)
  assert.notEqual(after.credentialGeneration, before.credentialGeneration, 'the row carries the generation this reset chose')
  assert.equal(await resolveAuthContext(db, session.cookie), null, 'and everything the old password opened is closed')

  // A failure *before* the provider call landed is an ordinary refusal: the
  // transaction rolled back, nothing outside the database changed, and
  // memberErrorCode names the provider's own reason rather than 'failed'.
  const restored = await login(person.userId, KHYTE)
  const refusing = fakeIdentity(async () => { throw new IdentityError('unavailable', 'the identity provider is unavailable') })
  const failed = await resetPasswordFlow(db, refusing.provider, admin, person.memberId, 'never-handed-over')
  assert.deepEqual(failed, { ok: false, error: 'unavailable' })
  assert.equal(refusing.calls.setPassword, 1, 'the provider was asked and refused')
  assert.equal((await membership(person.userId, KHYTE)).credentialGeneration, after.credentialGeneration, 'the generation did not move')
  assert.equal((await resolveAuthContext(db, restored.cookie))?.viewer.memberId, person.memberId, 'and the session survived the refusal')
})

test('R3 — a revoked token stops the next tool write, and only that connection', async () => {
  const person = await member(KHYTE, { displayName: 'Token Revoked' })
  const who = { userId: person.userId, organizationId: KHYTE }
  const token = await approve(who)
  const principal = await authenticateBearer(db, `Bearer ${token.access_token}`)
  const input = { ...task(), title: `After Revocation ${randomUUID()}` }

  // By access token. The commit re-checks the connection under the account
  // lock this revocation takes, so a write already in flight is refused
  // rather than slipping past a check it passed before the revocation.
  await revokeToken(db, revocationForm(token.access_token))
  await assert.rejects(commitAction(db, 'create_task', input, principal), /unauthorized|lost its access/)
  assert.equal((await db.query('select request_id from crm_tool_receipts where request_id = $1', [input.requestId])).length, 0,
    'a refused write is not receipted')
  assert.equal((await db.query('select id from tasks where title = $1', [input.title])).length, 0)
  await assert.rejects(authenticateBearer(db, `Bearer ${token.access_token}`), failsWith('unauthorized'))

  // One connection ended, not a person: the same member connecting again works.
  const fresh = await connect(person.userId, KHYTE)
  assert.equal((await commitAction(db, 'create_task', { ...task(), title: `Reconnected ${randomUUID()}` }, fresh)).status, 'saved')

  // By refresh token, the other half of RFC 7009 — the same connection either way.
  const second = await approve(who)
  const secondPrincipal = await authenticateBearer(db, `Bearer ${second.access_token}`)
  await revokeToken(db, revocationForm(second.refresh_token))
  await assert.rejects(commitAction(db, 'create_task', task(), secondPrincipal), /unauthorized|lost its access/)
  await assert.rejects(authenticateBearer(db, `Bearer ${second.access_token}`), failsWith('unauthorized'))

  // An unknown token is a successful no-op: nothing to lock, nothing to say.
  await revokeToken(db, revocationForm(randomUUID()))
  await revokeToken(db, revocationForm(''))
})

test('R2 — a revoke leaves nothing for a pending code or a refresh to find', async () => {
  const person = await member(KHYTE, { displayName: 'Lock Order Sequential' })
  const who = { userId: person.userId, organizationId: KHYTE }
  const live = await approve(who)
  const pending = new URL(await issueCode(db, authorization(), await codeIdentity(who))).searchParams.get('code')!

  // The revoke takes the organization lock, then the account lock, then the
  // rows — and inside it discards this person's pending codes and revokes
  // their connections. Sequentially that is simply: there is nothing left.
  await revokeMember(db, KHYTE, person.memberId)
  assert.equal((await db.query('select code_hash from crm_oauth_codes where code_hash = $1', [hashToken(pending)])).length, 0,
    'the code was discarded, so the exchange never reaches the membership check')
  await assert.rejects(exchangeToken(db, tokenForm(pending)), failsWith('invalid_grant'))
  const refresh = new URLSearchParams({ grant_type: 'refresh_token', client_id: config().clientId,
    client_secret: config().clientSecret, resource: config().resource, refresh_token: live.refresh_token })
  await assert.rejects(exchangeToken(db, refresh), failsWith('invalid_grant'))
  await assert.rejects(authenticateBearer(db, `Bearer ${live.access_token}`), failsWith('unauthorized'))
})
