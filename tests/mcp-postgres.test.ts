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
 *      proves nothing. The second test opens two real connections and makes
 *      them race. It CANNOT roll back (each side has to see the other's
 *      committed work), so it creates its own organizations and accounts and
 *      deletes them again in a finally.
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
