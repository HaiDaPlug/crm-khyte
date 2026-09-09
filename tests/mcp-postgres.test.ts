import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import type { Database } from '../lib/crm/database'

// Opt in with a migrated Postgres database. Never load .env.local automatically.
// Every operation is inside one outer transaction which always rolls back.
test('postgres.js preserves JSON objects through writes, updates, events and receipt replay', {
  skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
  process.env.SUPABASE_DB_URL = process.env.MCP_TEST_DATABASE_URL
  const { crmDatabase } = await import('../lib/crm/database')
  const { commitAction } = await import('../lib/crm/service')
  const { getDb } = await import('../lib/db/pg')
  const db = crmDatabase()
  const rollback = new Error('Intentional regression-test rollback')
  const actor = { connectionId: randomUUID() }
  const requestId = randomUUID()
  try {
    await assert.rejects(db.transaction(async tx => {
      const scoped: Database = { ...tx, transaction: run => run(tx) }
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
  } finally {
    await getDb().end({ timeout: 2 })
  }
})
