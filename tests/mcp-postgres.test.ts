import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import type { Database, Queryable, Row } from '../lib/crm/database'

/**
 * The two things PGlite cannot answer, against a real Postgres.
 *
 *   1. The driver. postgres.js has its own opinions about JSON, arrays and
 *      prepared statements; the first test below is the regression that
 *      catches them. It runs entirely inside one transaction which always
 *      rolls back, so it leaves nothing behind.
 *   2. Concurrency. PGlite is a single connection — two "simultaneous" callers
 *      are two sequential ones, and an advisory lock nobody contends for
 *      proves nothing. Every test after the first opens real connections and
 *      makes them race: two callers reaching the same invariant at once, and
 *      then — in the last three — one caller held at an exact statement while
 *      the other runs, which is the only way to pin down a lock *order*. They
 *      CANNOT roll back (each side has to see the other's committed work), so
 *      they create their own organizations and accounts and delete them again
 *      in a finally.
 *
 * Opt in with a migrated Postgres database. Never load .env.local
 * automatically. Run with:
 *
 *   MCP_TEST_DATABASE_URL=… node --conditions=react-server --import tsx --test tests/mcp-postgres.test.ts
 */

const KHYTE = '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10'

test('postgres.js preserves JSON objects through writes, updates, events and receipt replay', {
  skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
  process.env.SUPABASE_DB_URL = process.env.MCP_TEST_DATABASE_URL
  const { crmDatabase } = await import('../lib/crm/database')
  const { commitAction } = await import('../lib/crm/service')
  const { getDb } = await import('../lib/db/pg')
  const db = crmDatabase()
  const rollback = new Error('Intentional regression-test rollback')
  // Every write is attributed to an account, an organization and a live
  // connection now: commitAction re-reads the connection inside its own
  // transaction and refuses one that does not join to an active membership on
  // the same credential generation. So the account, the membership and the
  // connection row are all created here — inside the rolled-back transaction,
  // so nothing is left in auth.users or on the roster afterwards. The
  // organization is Khyte, which the organizations migration guarantees exists.
  const actor = { connectionId: randomUUID(), userId: randomUUID(), organizationId: KHYTE }
  const requestId = randomUUID()
  try {
    await assert.rejects(db.transaction(async tx => {
      const scoped: Database = { ...tx, transaction: run => run(tx) }
      const email = `${actor.userId}@example.test`
      await tx.query('insert into auth.users (id, email) values ($1, $2)', [actor.userId, email])
      const [member] = await tx.query<{ id: string; credential_generation: string }>(
        `insert into organization_members (organization_id, user_id, email, display_name, role)
         values ($1, $2, $3, 'Regression Tester', 'member')
         returning id, credential_generation::text as credential_generation`,
        [actor.organizationId, actor.userId, email])
      await tx.query(
        `insert into crm_oauth_connections (id, client_id, user_id, organization_id, member_id, member_generation,
           access_hash, refresh_hash, scopes, access_expires_at, refresh_expires_at)
         values ($1, 'regression-test', $2, $3, $4, $5, $6, $7, '{"crm:read","crm:tasks:write"}'::text[],
           now() + interval '1 hour', now() + interval '30 days')`,
        [actor.connectionId, actor.userId, actor.organizationId, member.id, member.credential_generation,
          `access-${actor.connectionId}`, `refresh-${actor.connectionId}`])

      const input = { requestId, target: { kind: 'new', company: { name: `MCP regression ${requestId}` },
        contact: { name: 'Regression contact', email: `${requestId}@example.test` } },
        occurredOn: '2026-09-09', channel: 'email', summary: 'Rollback-only regression test.', followedUpBy: null }
      const saved = await commitAction(scoped, 'log_outreach', input, actor)
      assert.equal(saved.status, 'saved')
      assert.equal((saved.company as { name: string }).name, input.target.company.name)
      const replay = await commitAction(scoped, 'log_outreach', input, actor)
      assert.equal(replay.status, 'already_saved')
      assert.deepEqual(replay.record, saved.record)
      const [event] = await tx.query('select detail from crm_events where subject_id = $1', [(saved.record as { id: string }).id])
      assert.equal((event.detail as { loggedVia: string }).loggedVia, 'crm_tool')

      const task = await commitAction(scoped, 'create_task', { requestId: randomUUID(), title: 'Rollback-only task',
        assignee: null, dueDate: null, tags: ['regression'] }, actor)
      const assigned = await commitAction(scoped, 'assign_task', { requestId: randomUUID(),
        taskId: (task.record as { id: string }).id, expectedVersion: task.version, assignee: 'hai' }, actor)
      assert.equal((assigned.record as { assignee: string }).assignee, 'hai')
      assert.deepEqual((assigned.record as { tags: string[] }).tags, ['regression'])
      throw rollback
    }), error => error === rollback)
    const receipts = await db.query('select request_id from crm_tool_receipts where request_id = $1', [requestId])
    assert.equal(receipts.length, 0)
    const members = await db.query('select id from organization_members where user_id = $1', [actor.userId])
    assert.equal(members.length, 0, 'the rehearsal membership rolled back with everything else')
  } finally {
    await getDb().end({ timeout: 2 })
  }
})

test('two owners revoking each other, and two organizations claiming one account, are serialized by the locks', {
  skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
  const url = process.env.MCP_TEST_DATABASE_URL!
  const { default: postgres } = await import('postgres')
  const { claimAccount, revokeMember } = await import('../lib/org/members')

  // Two connections, one statement at a time each, so the two callers really
  // are two backends contending for the same advisory lock.
  const left = postgres(url, { max: 1 })
  const right = postgres(url, { max: 1 })
  const wrap = (connection: Pick<typeof left, 'unsafe'>): Queryable => ({
    async query<T extends Row>(statement: string, parameters: unknown[] = []) {
      return await connection.unsafe(statement, parameters as never[]) as unknown as T[]
    },
  })
  const database = (sql: typeof left): Database => ({
    ...wrap(sql),
    async transaction<T>(run: (tx: Queryable) => Promise<T>) { return await sql.begin(tx => run(wrap(tx))) as T },
  })

  const suffix = randomUUID().slice(0, 8)
  const organizations = [randomUUID(), randomUUID()]
  const accounts: string[] = []
  try {
    const guard = await left`select 1 as present from pg_trigger where tgname = 'organizations_rollout_guard'`
    if (guard.length) {
      t.skip('organizations_rollout_guard is still on this database, so a second organization cannot be created. ' +
        'Apply the rollout follow-up (supabase/followups/…drop_organization_rollout.sql) before running this test.')
      return
    }

    const account = async (label: string) => {
      const id = randomUUID()
      await left`insert into auth.users (id, email) values (${id}, ${`${label}-${suffix}@example.test`})`
      accounts.push(id)
      return id
    }
    const join = async (organizationId: string, userId: string, role: 'owner' | 'member') => {
      const [row] = await left`insert into organization_members (organization_id, user_id, email, display_name, role)
        values (${organizationId}, ${userId}, ${`${userId}@example.test`}, 'Concurrency', ${role}) returning id`
      return row.id as string
    }

    for (const [index, id] of organizations.entries()) {
      await left`insert into organizations (id, name, slug)
        values (${id}, ${`Concurrency ${index} ${suffix}`}, ${`concurrency-${index}-${suffix}`})`
    }
    const [orgA, orgB] = organizations

    /* Two owners, each revoking the other at the same moment. Without the
     * organization's advisory lock both count two owners, both proceed, and
     * the organization is left with none — a state nobody can administer.
     *
     * Deliberately the members-script path, with no acting owner: with one,
     * whichever call loses the race is refused as 'forbidden' (its own owner
     * has just been revoked) before the owner count is ever reached, which
     * proves the acting-owner check rather than the invariant. */
    const first = await account('owner-one')
    const second = await account('owner-two')
    const memberOne = await join(orgA, first, 'owner')
    const memberTwo = await join(orgA, second, 'owner')
    const revokes = await Promise.allSettled([
      revokeMember(database(left), orgA, memberTwo),
      revokeMember(database(right), orgA, memberOne),
    ])
    const refused = revokes.filter(r => r.status === 'rejected')
    assert.equal(refused.length, 1, 'exactly one revoke must be refused')
    assert.equal(((refused[0] as PromiseRejectedResult).reason as { code?: string }).code, 'last_owner')
    const [owners] = await left`select count(*)::int as n from organization_members
      where organization_id = ${orgA} and role = 'owner' and status = 'active'`
    assert.equal(Number(owners.n), 1, 'the organization still has an owner')

    /* Two organizations claiming the same unassigned account at the same
     * moment. Without the account's advisory lock both see an account that
     * belongs nowhere, both write a membership, and both replace the
     * password — the second one locking the first organization out of an
     * account it had just taken on. */
    const contested = await account('contested')
    const called = new Map<string, number>()
    const claim = (sql: typeof left, organizationId: string) =>
      claimAccount(database(sql), {
        organizationId, userId: contested, email: `contested-${suffix}@example.test`,
        displayName: 'Contested Person', role: 'member', colleague: null,
      }, {}, async () => { called.set(organizationId, (called.get(organizationId) ?? 0) + 1) })
    const claims = await Promise.allSettled([claim(left, orgA), claim(right, orgB)])

    const won = claims.filter(r => r.status === 'fulfilled')
    const lost = claims.filter(r => r.status === 'rejected')
    assert.equal(won.length, 1, 'exactly one organization may take an account on')
    assert.equal((lost[0] as PromiseRejectedResult & { reason: { code?: string } }).reason.code, 'belongs_elsewhere')
    const active = await left`select organization_id from organization_members
      where user_id = ${contested} and status = 'active'`
    assert.equal(active.length, 1)
    const winner = active[0].organization_id as string
    assert.equal(called.get(winner), 1, "the winner's password callback ran")
    assert.equal(called.get(winner === orgA ? orgB : orgA), undefined,
      'the loser never touched a password it was refused the right to replace')
    assert.equal([...called.values()].reduce((a, b) => a + b, 0), 1)
  } finally {
    // Nothing here was inside a transaction, so the cleanup is the rollback.
    // Memberships and sessions go with their account and their organization
    // (`on delete cascade`), so deleting those two is enough.
    try {
      if (accounts.length) await left`delete from auth.users where id = any(${accounts}::uuid[])`
      await left`delete from organizations where id = any(${organizations}::uuid[])`
    } finally {
      await left.end({ timeout: 5 })
      await right.end({ timeout: 5 })
    }
  }
})

/* ———— Real concurrency: the lock order itself ————
 *
 * The two races the second review asked for evidence of. Both need two
 * backends holding real locks, so PGlite cannot run either of them and only a
 * migrated PostgreSQL can: they are skipped exactly like the tests above.
 *
 * Neither uses a sleep to mean "at the same time". Each wraps the Database one
 * side is given so that its query() stops at a named statement and waits on a
 * barrier; the other side is then started, watched until it is genuinely
 * blocked on an advisory lock (pg_locks, by that connection's own backend pid),
 * and only then is the barrier released. The interleaving is therefore the one
 * the test claims, every run.
 *
 * What they prove is the order lib/org/members.ts states: organization
 * advisory lock, then account advisory lock, then row locks. A writer that
 * held a row for update while waiting for the account lock would deadlock
 * against a token exchange holding that lock and needing the row — so the
 * first test asserts that neither side ever fails with SQLSTATE 40P01, which
 * is the failure the order exists to prevent, and that no connection outlives
 * the membership behind it whichever side wins.
 */

/** postgres.js, as these tests drive it: one statement at a time. */
type Sql = import('postgres').Sql

const wrapConnection = (connection: Pick<Sql, 'unsafe'>): Queryable => ({
  async query<T extends Row>(statement: string, parameters: unknown[] = []) {
    return await connection.unsafe(statement, parameters as never[]) as unknown as T[]
  },
})

const databaseOn = (sql: Sql): Database => ({
  ...wrapConnection(sql),
  async transaction<T>(run: (tx: Queryable) => Promise<T>) { return await sql.begin(tx => run(wrapConnection(tx))) as T },
})

/**
 * One caller, stopped at an exact point inside its transaction.
 *
 * The first statement `pause` recognizes is executed and then held: `reached`
 * resolves when it is, and nothing continues until `release()` is called.
 * `statements` is everything that ran, in order, so a test can assert *what*
 * it paused after rather than trusting a count.
 */
function pauseAfter(sql: Sql, pause: (statement: string, index: number) => boolean) {
  const statements: string[] = []
  let arrive: () => void = () => {}
  let letGo: () => void = () => {}
  const reached = new Promise<void>(resolve => { arrive = resolve })
  const released = new Promise<void>(resolve => { letGo = resolve })
  const base = databaseOn(sql)
  let paused = false
  const database: Database = {
    ...base,
    transaction: (run) => base.transaction(async tx => run({
      async query<T extends Row>(statement: string, parameters: unknown[] = []) {
        const rows = await tx.query<T>(statement, parameters)
        statements.push(statement)
        if (!paused && pause(statement, statements.length - 1)) {
          paused = true
          arrive()
          await released
        }
        return rows
      },
    })),
  }
  return { database, statements, reached, release: () => letGo() }
}

/** Waits for the paused side to arrive. Should the call fail before it gets
 *  there, that failure is raised here rather than left to look like a barrier
 *  nothing ever reached. */
async function reachedOrFailed(held: { reached: Promise<void> }, running: Promise<unknown>): Promise<void> {
  await Promise.race([held.reached, running.then(() => undefined)])
}

const moment = () => new Promise<void>(resolve => { setTimeout(resolve, 25) })

/** Whether `pid`'s backend is waiting for an advisory lock right now. Asked of
 *  a third connection, because the two racing ones are busy being raced. */
async function waitingForAdvisoryLock(observer: Sql, pid: number): Promise<boolean> {
  const [row] = await observer`select count(*)::int as n from pg_locks
    where pid = ${pid} and locktype = 'advisory' and not granted`
  return Number(row.n) > 0
}

/** Blocks until that backend is waiting on an advisory lock, and says so. */
async function untilBlocked(observer: Sql, pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await waitingForAdvisoryLock(observer, pid)) return true
    await moment()
  }
  return false
}

/** Blocks until that backend is waiting on an advisory lock *or* the call it
 *  is running has finished. Not being blocked is a legitimate outcome: it is
 *  what the corrected lock order produces when the other side holds nothing. */
async function untilBlockedOrDone(observer: Sql, pid: number, running: Promise<unknown>): Promise<void> {
  let done = false
  running.then(() => { done = true }, () => { done = true })
  for (let attempt = 0; attempt < 200 && !done; attempt++) {
    if (await waitingForAdvisoryLock(observer, pid)) return
    await moment()
  }
}

/** The one SQLSTATE these two orders exist to make impossible. */
function assertNoDeadlock(outcome: PromiseSettledResult<unknown>, who: string): void {
  if (outcome.status === 'rejected') {
    assert.notEqual((outcome.reason as { code?: string } | null)?.code, '40P01',
      `${who} deadlocked — the lock order is what prevents that, so this is the regression`)
  }
}

/** The MCP configuration the OAuth paths read at call time. Test-only values;
 *  no deployment's keys are read, written or needed. */
function mcpTestEnvironment(): void {
  process.env.MCP_PUBLIC_URL = 'https://crm.example.test'
  process.env.MCP_SECRET = 'test-only-signing-secret-with-at-least-32-characters'
  process.env.MCP_CLIENT_ID = 'test-chatgpt'
  process.env.MCP_CLIENT_SECRET = 'test-only-client-secret-with-at-least-32-characters'
  process.env.MCP_REDIRECT_URIS = 'https://chatgpt.com/connector_platform_oauth_redirect'
}

const VERIFIER = 'a'.repeat(64)

/** The OAuth module plus the three request shapes these tests build. */
async function oauthPath() {
  mcpTestEnvironment()
  const oauth = await import('../lib/mcp/oauth')
  const { config, pkceChallenge } = await import('../lib/mcp/security')
  return {
    ...oauth,
    authorization: () => oauth.validateAuthorization({
      response_type: 'code', client_id: config().clientId, redirect_uri: config().redirects[0], state: 'state-value',
      resource: config().resource, code_challenge: pkceChallenge(VERIFIER), code_challenge_method: 'S256',
      scope: 'crm:read crm:tasks:write',
    }),
    tokenForm: (code: string) => new URLSearchParams({ grant_type: 'authorization_code', client_id: config().clientId,
      client_secret: config().clientSecret, redirect_uri: config().redirects[0], code, code_verifier: VERIFIER,
      resource: config().resource }),
    revocationForm: (token: string) => new URLSearchParams({ client_id: config().clientId,
      client_secret: config().clientSecret, token }),
  }
}

/**
 * Everything these tests create, removed again.
 *
 * Nothing here runs inside a transaction — each side has to see the other's
 * committed work — so the cleanup is the rollback. The organization_id columns
 * retro-fitted to the existing tables are plain references without `on delete
 * cascade` (see the organizations migration), so their rows go first, by
 * organization; memberships and sessions would cascade anyway.
 */
async function removeTestData(sql: Sql, organizations: string[], accounts: string[]): Promise<void> {
  // Nothing was created — the test skipped before its scaffold.
  if (!organizations.length) return
  // The Journal's four tables first: their organization_id is a plain
  // reference too, and a browser-write race leaves captures and entries.
  for (const table of ['journal_entry_links', 'journal_entry_revisions', 'journal_entries', 'captures',
    'crm_tool_receipts', 'tasks', 'crm_events', 'crm_oauth_connections',
    'crm_oauth_codes', 'app_sessions', 'organization_members']) {
    await sql.unsafe(`delete from ${table} where organization_id = any($1::uuid[])`, [organizations] as never[])
  }
  if (accounts.length) await sql`delete from auth.users where id = any(${accounts}::uuid[])`
  await sql`delete from organizations where id = any(${organizations}::uuid[])`
}

/** An organization of its own, an owner so the roster is well formed, and one
 *  ordinary member — the person both races are about. */
async function scaffold(sql: Sql, label: string) {
  const suffix = randomUUID().slice(0, 8)
  const organizationId = randomUUID()
  await sql`insert into organizations (id, name, slug)
    values (${organizationId}, ${`${label} ${suffix}`}, ${`${label}-${suffix}`.toLowerCase()})`
  const accounts: string[] = []
  const join = async (role: 'owner' | 'member') => {
    const userId = randomUUID()
    await sql`insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})`
    accounts.push(userId)
    const [row] = await sql`insert into organization_members (organization_id, user_id, email, display_name, role)
      values (${organizationId}, ${userId}, ${`${userId}@example.test`}, 'Concurrency', ${role})
      returning id, credential_generation::text as credential_generation`
    return { userId, memberId: row.id as string, credentialGeneration: row.credential_generation as string }
  }
  await join('owner')
  return { organizationId, accounts, person: await join('member') }
}

test('an exchange and a revoke of the same account are serialized, never deadlocked', {
  skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
  const url = process.env.MCP_TEST_DATABASE_URL!
  const { default: postgres } = await import('postgres')
  const left = postgres(url, { max: 1 }), right = postgres(url, { max: 1 }), observer = postgres(url, { max: 1 })
  let organizations: string[] = [], accounts: string[] = []
  try {
    const guard = await left`select 1 as present from pg_trigger where tgname = 'organizations_rollout_guard'`
    if (guard.length) {
      t.skip('organizations_rollout_guard is still on this database, so a second organization cannot be created. ' +
        'Apply the rollout follow-up (supabase/followups/…drop_organization_rollout.sql) before running this test.')
      return
    }
    const { issueCode, exchangeToken, authenticateBearer, authorization, tokenForm } = await oauthPath()
    const { revokeMember } = await import('../lib/org/members')

    const world = await scaffold(left, 'Exchange Race')
    organizations = [world.organizationId]
    accounts = world.accounts
    const { userId, memberId, credentialGeneration } = world.person
    const code = new URL(await issueCode(databaseOn(left), authorization(),
      { userId, organizationId: world.organizationId, memberId, credentialGeneration })).searchParams.get('code')!
    const [{ pid: revokerPid }] = await right`select pg_backend_pid()::int as pid`

    // The exchange, held immediately after its first statement — the plain
    // read that learns whose code this is. No lock of any kind is held here:
    // that is the whole of the change, and the reason the revoke below can
    // pass it rather than wait behind a row it has for update.
    const exchange = pauseAfter(left, (_statement, index) => index === 0)
    const exchanging = exchangeToken(exchange.database, tokenForm(code))
    await reachedOrFailed(exchange, exchanging)
    assert.match(exchange.statements[0] ?? '', /select user_id from crm_oauth_codes/,
      'the exchange must learn the account from an unlocked read before it locks anything')

    // The revoke, on the other backend. It takes the organization lock, then
    // the account lock, then its rows — and since the exchange holds neither,
    // it is free to run to completion. If it does block on the account lock
    // instead, that is equally sound; what it must never do is wait on a row
    // the exchange is holding while the exchange waits on the lock it holds.
    const revoking = revokeMember(databaseOn(right), world.organizationId, memberId)
    await untilBlockedOrDone(observer, Number(revokerPid), revoking)
    exchange.release()
    const [exchanged, revoked] = await Promise.allSettled([exchanging, revoking])

    assertNoDeadlock(exchanged, 'the token exchange')
    assertNoDeadlock(revoked, 'the membership revoke')
    assert.equal(revoked.status, 'fulfilled', 'the revoke must finish; withdrawal of access cannot be the side that loses')
    const [membership] = await observer`select status from organization_members where id = ${memberId}`
    assert.equal(membership.status, 'revoked')

    // Whichever order the two landed in, exactly two outcomes are honest: the
    // exchange found nothing left and said so, or it minted a connection that
    // no longer authenticates because the membership behind it is gone.
    if (exchanged.status === 'rejected') {
      assert.equal((exchanged.reason as { code?: string }).code, 'invalid_grant')
    } else {
      await assert.rejects(authenticateBearer(databaseOn(observer), `Bearer ${exchanged.value.access_token}`),
        /expired or was revoked/)
    }
    const [live] = await observer`select count(*)::int as n from crm_oauth_connections c
      join organization_members m on m.id = c.member_id and m.organization_id = c.organization_id
        and m.user_id = c.user_id and m.status = 'active' and m.credential_generation = c.member_generation
      where c.user_id = ${userId} and c.revoked_at is null`
    assert.equal(Number(live.n), 0, 'no connection may outlive the membership behind it')
  } finally {
    try {
      await removeTestData(left, organizations, accounts)
    } finally {
      await left.end({ timeout: 5 })
      await right.end({ timeout: 5 })
      await observer.end({ timeout: 5 })
    }
  }
})

test('a tool commit authorized under the account lock finishes, and the revocation that waited ends the next one', {
  skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
  const url = process.env.MCP_TEST_DATABASE_URL!
  const { default: postgres } = await import('postgres')
  const left = postgres(url, { max: 1 }), right = postgres(url, { max: 1 }), observer = postgres(url, { max: 1 })
  let organizations: string[] = [], accounts: string[] = []
  try {
    const guard = await left`select 1 as present from pg_trigger where tgname = 'organizations_rollout_guard'`
    if (guard.length) {
      t.skip('organizations_rollout_guard is still on this database, so a second organization cannot be created. ' +
        'Apply the rollout follow-up (supabase/followups/…drop_organization_rollout.sql) before running this test.')
      return
    }
    const { issueCode, exchangeToken, authenticateBearer, revokeToken, authorization, tokenForm, revocationForm } = await oauthPath()
    const { commitAction } = await import('../lib/crm/service')

    const world = await scaffold(left, 'Commit Race')
    organizations = [world.organizationId]
    accounts = world.accounts
    const { userId, memberId, credentialGeneration } = world.person
    const code = new URL(await issueCode(databaseOn(left), authorization(),
      { userId, organizationId: world.organizationId, memberId, credentialGeneration })).searchParams.get('code')!
    const token = await exchangeToken(databaseOn(left), tokenForm(code))
    const actor = await authenticateBearer(databaseOn(left), `Bearer ${token.access_token}`)
    const [{ pid: revokerPid }] = await right`select pg_backend_pid()::int as pid`

    // The commit, held immediately after the statement that authorized it.
    // The account advisory lock was taken the statement before, so this is a
    // commit that has passed its check and is holding the lock a revocation
    // needs — the exact moment RFC 7009 revocation must not be able to
    // "succeed" behind.
    const input = { requestId: randomUUID(), title: `Concurrency commit ${randomUUID()}`,
      assignee: null, dueDate: null, tags: ['concurrency'] }
    const commit = pauseAfter(left, statement => statement.includes('from crm_oauth_connections c'))
    const committing = commitAction(commit.database, 'create_task', input, actor)
    await reachedOrFailed(commit, committing)

    const revoking = revokeToken(databaseOn(right), revocationForm(token.access_token))
    assert.equal(await untilBlocked(observer, Number(revokerPid)), true,
      'the revocation must wait for the account lock the commit holds, not slip past it')
    commit.release()
    const [committed, revokedToken] = await Promise.allSettled([committing, revoking])

    assertNoDeadlock(committed, 'the tool commit')
    assertNoDeadlock(revokedToken, 'the token revocation')
    assert.equal(committed.status, 'fulfilled', 'the commit was authorized before the revocation arrived')
    assert.equal(committed.status === 'fulfilled' && (committed.value as Row).status, 'saved')
    assert.equal(revokedToken.status, 'fulfilled', 'and the revocation completed once the commit let the lock go')
    const [saved] = await observer`select id from tasks where title = ${input.title}`
    assert.ok(saved, 'the write that was authorized landed')

    // The next one is refused: the connection is revoked, and commitAction
    // re-reads it inside its own transaction rather than trusting the check
    // this request passed a moment ago.
    await assert.rejects(authenticateBearer(databaseOn(observer), `Bearer ${token.access_token}`), /expired or was revoked/)
    await assert.rejects(
      commitAction(databaseOn(left), 'create_task', { ...input, requestId: randomUUID(), title: `Refused ${randomUUID()}` }, actor),
      /unauthorized|lost its access/)
  } finally {
    try {
      await removeTestData(left, organizations, accounts)
    } finally {
      await left.end({ timeout: 5 })
      await right.end({ timeout: 5 })
      await observer.end({ timeout: 5 })
    }
  }
})

/* ———— The browser's Journal writes against a revoke (R3) ————
 *
 * The browser twin of the commit race above. A Server Action resolved its
 * session when the request arrived; the Journal service re-checks that
 * session and its membership generation inside the write's own transaction,
 * after taking the account advisory lock — the lock revokeMember takes (after
 * the organization lock) before it cuts sessions and rotates the generation.
 * So exactly two interleavings exist, and each is pinned here with a barrier
 * rather than a sleep:
 *
 *   1. The write holds the account lock first. The revoke waits on it; the
 *      write, authorized before the revoke existed, commits; the revoke then
 *      completes; the same session's next write is refused.
 *   2. The revoke holds the account lock first. The write waits on it; the
 *      revoke commits; the write then finds its session revoked and is
 *      refused with nothing written.
 *
 * The write takes the account lock and never the organization lock after it,
 * and no row lock before it, so neither order can deadlock.
 */

/** A browser session for this person, minted and resolved the way every
 *  Server Action resolves one, as the Journal actor app/actions/journal.ts
 *  builds from it. */
async function browserSession(sql: Sql, world: { organizationId: string; person: { userId: string } }) {
  process.env.AUTH_SECRET = 'test-only-session-secret-with-at-least-32-characters'
  const { hashSessionToken, mintSession } = await import('../lib/auth/session')
  const { resolveAuthContext } = await import('../lib/auth/context')
  const minted = mintSession()
  await sql`insert into app_sessions (user_id, organization_id, token_hash, expires_at)
    values (${world.person.userId}, ${world.organizationId}, ${hashSessionToken(minted.token)}, ${minted.expiresAt.toISOString()})`
  const context = await resolveAuthContext(databaseOn(sql), minted.cookie)
  assert.ok(context, 'a freshly minted session resolves')
  return {
    organizationId: context.organizationId, userId: context.userId, source: 'typed' as const,
    sessionId: context.sessionId, credentialGeneration: context.credentialGeneration,
  }
}

test('a browser Journal write and a revoke of its author are serialized by the account lock, in either order, never deadlocked', {
  skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
  const url = process.env.MCP_TEST_DATABASE_URL!
  const { default: postgres } = await import('postgres')
  const left = postgres(url, { max: 1 }), right = postgres(url, { max: 1 }), observer = postgres(url, { max: 1 })
  const organizations: string[] = [], accounts: string[] = []
  try {
    const guard = await left`select 1 as present from pg_trigger where tgname = 'organizations_rollout_guard'`
    if (guard.length) {
      t.skip('organizations_rollout_guard is still on this database, so a second organization cannot be created. ' +
        'Apply the rollout follow-up (supabase/followups/…drop_organization_rollout.sql) before running this test.')
      return
    }
    const { createEntry } = await import('../lib/journal/service')
    const { revokeMember } = await import('../lib/org/members')
    const [{ pid: leftPid }] = await left`select pg_backend_pid()::int as pid`
    const [{ pid: rightPid }] = await right`select pg_backend_pid()::int as pid`

    /* 1. The write first. */
    const first = await scaffold(left, 'Journal Race')
    organizations.push(first.organizationId)
    accounts.push(...first.accounts)
    const writer = await browserSession(left, first)
    const landedText = `Written under the account lock ${randomUUID()}`

    // Held immediately after the statement that took the account lock: the
    // write has the lock and has not yet asked whether its session is live.
    const write = pauseAfter(left, statement => statement.includes('pg_advisory_xact_lock'))
    const writing = createEntry(write.database, writer, { requestKey: randomUUID(), text: landedText })
    await reachedOrFailed(write, writing)
    assert.match(write.statements[0] ?? '', /pg_advisory_xact_lock/,
      'the account lock is the first thing a browser write takes, before any row')

    const revoking = revokeMember(databaseOn(right), first.organizationId, first.person.memberId)
    assert.equal(await untilBlocked(observer, Number(rightPid)), true,
      'the revoke must wait for the account lock the write holds, not slip past it')
    write.release()
    const [written, revoked] = await Promise.allSettled([writing, revoking])

    assertNoDeadlock(written, 'the Journal write')
    assertNoDeadlock(revoked, 'the membership revoke')
    assert.equal(written.status, 'fulfilled')
    assert.deepEqual(written.status === 'fulfilled' && { ok: written.value.ok }, { ok: true },
      'the write was authorized before the revoke arrived, and landed')
    assert.equal(revoked.status, 'fulfilled', 'and the revoke completed once the write let the lock go')
    const [landed] = await observer`select count(*)::int as n from journal_entries
      where organization_id = ${first.organizationId} and body = ${landedText}`
    assert.equal(Number(landed.n), 1)
    const [membership] = await observer`select status from organization_members where id = ${first.person.memberId}`
    assert.equal(membership.status, 'revoked')

    // The same session's next write is refused: it re-checks inside its own
    // transaction rather than trusting the check the request passed earlier.
    const next = await createEntry(databaseOn(left), writer, { requestKey: randomUUID(), text: `Refused ${randomUUID()}` })
    assert.deepEqual(next, { ok: false, error: 'unauthorized' })
    const [captured] = await observer`select count(*)::int as n from captures where organization_id = ${first.organizationId}`
    assert.equal(Number(captured.n), 1, 'only the write that was authorized left a capture')

    /* 2. The revoke first. */
    const second = await scaffold(left, 'Journal Race Reverse')
    organizations.push(second.organizationId)
    accounts.push(...second.accounts)
    const pending = await browserSession(left, second)

    // Held immediately after its SECOND advisory lock — the account lock,
    // taken after the organization lock — with the membership not yet cut.
    let advisory = 0
    const revoke = pauseAfter(right, statement => statement.includes('pg_advisory_xact_lock') && ++advisory === 2)
    const revokingFirst = revokeMember(revoke.database, second.organizationId, second.person.memberId)
    await reachedOrFailed(revoke, revokingFirst)
    assert.equal(revoke.statements.filter(statement => statement.includes('pg_advisory_xact_lock')).length, 2,
      'the revoke holds the organization lock and the account lock')

    const refusedText = `Written after the revoke ${randomUUID()}`
    const waiting = createEntry(databaseOn(left), pending, { requestKey: randomUUID(), text: refusedText })
    assert.equal(await untilBlocked(observer, Number(leftPid)), true,
      'the write must wait for the account lock the revoke holds')
    revoke.release()
    const [revokedFirst, refused] = await Promise.allSettled([revokingFirst, waiting])

    assertNoDeadlock(revokedFirst, 'the membership revoke')
    assertNoDeadlock(refused, 'the Journal write')
    assert.equal(revokedFirst.status, 'fulfilled')
    assert.equal(refused.status, 'fulfilled', 'a refusal is a value, not a thrown error')
    assert.deepEqual(refused.status === 'fulfilled' && refused.value, { ok: false, error: 'unauthorized' },
      'the write that waited found its session revoked and wrote nothing')
    const [nothing] = await observer`select count(*)::int as n from captures where organization_id = ${second.organizationId}`
    assert.equal(Number(nothing.n), 0)
    const [none] = await observer`select count(*)::int as n from journal_entries where organization_id = ${second.organizationId}`
    assert.equal(Number(none.n), 0)
  } finally {
    try {
      await removeTestData(left, organizations, accounts)
    } finally {
      await left.end({ timeout: 5 })
      await right.end({ timeout: 5 })
      await observer.end({ timeout: 5 })
    }
  }
})
