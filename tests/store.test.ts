import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import type { CRMSnapshot, OrganizationMember, Workspace } from '../lib/types'
import { createCRMStore } from '../lib/store/store'

/**
 * The client store, run as a client module.
 *
 * Why its own file. Every other suite runs with --conditions=react-server, so
 * that `server-only` resolves to an empty module — and under that condition
 * next/navigation resolves to the client router context, which calls
 * React.createContext, absent from React's react-server build. The store
 * imports the Server Actions it calls, which reach lib/auth/guard.ts and
 * therefore next/navigation, so it cannot be imported under that condition at
 * all; without it, `server-only` throws instead. Next's bundler aliases both
 * per runtime and plain Node cannot, so this file runs without the condition
 * and with tests/support/client-preload.cjs blanking the marker package —
 * the one import-time obstacle, removed, with nothing mocked. Everything
 * below is the real store.
 *
 * Run with: npm run test:store.
 */

const workspaceFor = (organizationId: string, userId: string): Workspace => ({
  organization: { id: organizationId, name: 'Workspace', slug: 'workspace', timezone: 'Europe/Stockholm' },
  viewer: { userId, memberId: randomUUID(), role: 'owner', displayName: 'Viewer', email: 'viewer@example.test' },
  members: [],
})

const snapshotFor = (workspace: Workspace): CRMSnapshot => ({
  workspace, companies: [], contacts: [], opportunities: [], leads: [], notes: [],
  strategyBoards: [], strategyBoardOpportunities: [], strategyColumns: [], strategyCards: [], tasks: [],
})

test('acceptance 4 — the client store refuses a snapshot belonging to another identity', () => {
  const orgA = randomUUID(), orgB = randomUUID(), userA = randomUUID()
  const newcomer: OrganizationMember = { id: randomUUID(), userId: randomUUID(), role: 'member', status: 'active',
    email: 'newcomer@example.test', displayName: 'Newcomer', createdAt: new Date().toISOString() }

  // Another organization's snapshot.
  const foreign = createCRMStore(snapshotFor(workspaceFor(orgA, userA)))
  foreign.getState().upsertWorkspaceMember(newcomer)
  assert.equal(foreign.getState().applyRemoteSnapshot(snapshotFor(workspaceFor(orgB, userA))), false)
  assert.equal(foreign.getState().identityChanged, true)
  assert.equal(foreign.getState().workspace.organization.id, orgA, 'the workspace is not merged with the other one')
  assert.ok(foreign.getState().workspace.members.some(m => m.id === newcomer.id), 'and the member just added is still there')

  // The same organization, a different person: the cookie changed under this tab.
  const swapped = createCRMStore(snapshotFor(workspaceFor(orgA, userA)))
  swapped.getState().upsertWorkspaceMember(newcomer)
  assert.equal(swapped.getState().applyRemoteSnapshot(snapshotFor(workspaceFor(orgA, randomUUID()))), false)
  assert.equal(swapped.getState().identityChanged, true)
  assert.equal(swapped.getState().workspace.organization.id, orgA)
  assert.equal(swapped.getState().workspace.viewer.userId, userA, 'the viewer is not replaced either')
  assert.ok(swapped.getState().workspace.members.some(m => m.id === newcomer.id))

  // The same organization and the same person: an ordinary merge.
  const ours = createCRMStore(snapshotFor(workspaceFor(orgA, userA)))
  assert.equal(ours.getState().applyRemoteSnapshot(snapshotFor(workspaceFor(orgA, userA))), true)
  assert.equal(ours.getState().identityChanged, false)
})

test('markIdentityChanged is the same conclusion reached from a refused write', () => {
  // The Server Actions answer 'context_mismatch' when the scope a tab sent
  // disagrees with the session that arrived — the write never touched
  // anything. OrganizationSection calls this instead of filing the result,
  // and SnapshotSync turns the flag into a reload. Reachable only as a store
  // action: the store calls the actions through a static `import * as api`
  // with no seam to intercept, and a real call needs a session and a database.
  const store = createCRMStore(snapshotFor(workspaceFor(randomUUID(), randomUUID())))
  assert.equal(store.getState().identityChanged, false)
  store.getState().markIdentityChanged()
  assert.equal(store.getState().identityChanged, true)
})
