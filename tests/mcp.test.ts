import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { Database, Queryable, Row } from '../lib/crm/database'
import { actionSchemas, calendarDate } from '../lib/crm/contracts'
import { commitAction, previewAction, getRecord, searchRecords, safeError,
  previewBulkOutreach, commitBulkOutreach, getBulkResult } from '../lib/crm/service'
import { createCrmMcpServer } from '../lib/mcp/server'
import { authenticateBearer, exchangeToken, issueCode, revokeToken, validateAuthorization, authorizationMetadata } from '../lib/mcp/oauth'
import { config, hashToken, pkceChallenge, previewToken, readEnvelope, signEnvelope, verifyPreview } from '../lib/mcp/security'
import { checkOrigin, readBody } from '../lib/mcp/http'
import { loginReturnTo } from '../lib/auth/return-to'
import { register } from '../instrumentation'

// No .env files, remote database, production credentials, or network access.
process.env.MCP_PUBLIC_URL = 'https://crm.example.test'
process.env.MCP_SECRET = 'test-only-signing-secret-with-at-least-32-characters'
process.env.MCP_CLIENT_ID = 'test-chatgpt'
process.env.MCP_CLIENT_SECRET = 'test-only-client-secret-with-at-least-32-characters'
process.env.MCP_REDIRECT_URIS = 'https://chatgpt.com/connector_platform_oauth_redirect'
process.env.NEXT_RUNTIME = 'nodejs'
register()
const pg = new PGlite()
const wrap = (client: Pick<PGlite, 'query'>): Queryable => ({ async query<T extends Row>(sql: string, values: unknown[] = []) { return (await client.query<T>(sql, values)).rows } })
const db: Database = { ...wrap(pg), transaction: run => pg.transaction(tx => run(wrap(tx))) }
const actor = { connectionId: randomUUID() }
const lead = () => ({ requestId: randomUUID(), companyName: `Lead ${randomUUID()}`, followedUpBy: 'abdi' as const, tags: ['referral', 'referral'] })
const task = () => ({ requestId: randomUUID(), title: 'Send the agreed proposal', assignee: 'hai' as const, dueDate: null, tags: ['proposal'] })
const outreach = () => ({ requestId: randomUUID(), target: { kind: 'new' as const, company: { name: `Company ${randomUUID()}` }, contact: { name: 'Anna', email: `${randomUUID()}@example.test` } },
  occurredOn: '2026-08-18', channel: 'email' as const, summary: 'Sent an introduction.', followedUpBy: 'erik' as const, tags: ['outbound'] })

test('server initialization uses Stockholm day boundaries in winter, summer and DST transitions', () => {
  assert.equal(new Date(2026, 0, 15).toISOString(), '2026-01-14T23:00:00.000Z')
  assert.equal(new Date(2026, 6, 15).toISOString(), '2026-07-14T22:00:00.000Z')
  assert.equal(new Date(2026, 2, 30).toISOString(), '2026-03-29T22:00:00.000Z')
  assert.equal(new Date(2026, 9, 26).toISOString(), '2026-10-25T23:00:00.000Z')
})

before(async () => {
  await pg.exec(`create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`)
  const files = (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()
  for (const file of files) {
    // gen_random_uuid is built into modern Postgres; PGlite does not bundle pgcrypto.
    const sql = (await readFile(`supabase/migrations/${file}`, 'utf8')).replace('create extension if not exists pgcrypto;', '')
    await pg.exec(sql)
  }
})
after(async () => { await pg.close() })

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
  await assert.rejects(commitAction(db, 'create_lead', a, { connectionId: randomUUID() }), /request ID/)
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
  const found = await searchRecords(db, { query: (first.company as Row).name, entity: 'prospect' })
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
  })

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
  const code = new URL(await issueCode(db, validateAuthorization(base))).searchParams.get('code')!
  const form = tokenForm(code); form.delete('resource')
  assert.equal((await exchangeToken(db, form)).token_type, 'Bearer')
})

test('OAuth binds callback/resource/client/PKCE, consumes codes once, rotates tokens and revokes', async () => {
  assert.equal(authorizationMetadata().code_challenge_methods_supported[0], 'S256')
  assert.throws(() => validateAuthorization({ ...authorization(), redirect_uri: 'https://evil.example/' }), /Unrecognized/)
  assert.throws(() => validateAuthorization({ ...authorization(), resource: 'https://evil.example/mcp' }), /Unrecognized/)
  assert.throws(() => validateAuthorization({ ...authorization(), scope: 'crm:read admin' }), /supported/)
  const callback = new URL(await issueCode(db, authorization())), code = callback.searchParams.get('code')!
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
    assert.equal(list.tools.length, 12)
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
    if (call.method === 'tools/list') assert.equal(data.result.tools.length, 12)
    if (call.method === 'tools/call') assert.equal(data.result.structuredContent.timezone, 'Europe/Stockholm')
  }
})
