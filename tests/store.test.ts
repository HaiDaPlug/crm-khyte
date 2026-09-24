import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import type {
  Company,
  Contact,
  CRMSnapshot,
  Opportunity,
  OrganizationMember,
  Workspace,
} from '../lib/types'
import { createCRMStore, type JournalApi } from '../lib/store/store'
import type { NextStepActionResult } from '../app/actions/journal'
import type { JournalEntryView } from '../lib/journal/contracts'
import {
  adoptDraft,
  beginEdit,
  editSessionReducer,
  incomingRevision,
  isStale,
  nextPollState,
  pollAction,
  rebase,
  savedAt,
  settleEditSave,
  settleSave,
  settleStoredDraft,
  shouldAdoptStored,
  type ComposerNow,
  type EditDraft,
  type SaveSnapshot,
  type StoredDraft,
} from '../lib/journal/composer-state'
import {
  clearDraft,
  clearDraftsFor,
  draftKey,
  newRequestKey,
  parseDraft,
  readDraft,
  sweepForeignDrafts,
  writeDraft,
  type DraftStorage,
} from '../lib/journal/drafts'
import { formatJournalDate, formatJournalDateTime } from '../lib/journal/format'
import { buildExportRows } from '../lib/export-prospects'

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
  workspace, companies: [], contacts: [], opportunities: [], leads: [],
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

/* ————————————————————————————————————————————————————————————————————————
   The Journal client: the store slice, the drafts, and the date formatting.

   Everything below runs under the same harness as the two tests above —
   plain Node, no `--conditions=react-server`, tests/support/client-preload
   blanking the `server-only` marker — because every module involved is a
   client module by construction (lib/journal/contracts, drafts and format
   carry no `server-only`, deliberately).

   The Server Actions are faked through `createCRMStore`'s second argument.
   That seam exists for exactly this: a real `createJournalEntry` needs a
   session and a database, and the behaviour worth proving here is what the
   STORE does with each answer — whether the draft survives a refusal, which
   views a new entry reaches, whether two views holding one entry agree.
   ———————————————————————————————————————————————————————————————————————— */

/** A localStorage stand-in. Plain object, no DOM, inspectable. */
class FakeStorage implements DraftStorage {
  private map = new Map<string, string>()
  get length(): number { return this.map.size }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null }
  getItem(key: string): string | null { return this.map.get(key) ?? null }
  setItem(key: string, value: string): void { this.map.set(key, value) }
  removeItem(key: string): void { this.map.delete(key) }
}

/** Storage that is present but refuses everything — a private window. */
const hostileStorage: DraftStorage = {
  get length(): number { throw new Error('denied') },
  key() { throw new Error('denied') },
  getItem() { throw new Error('denied') },
  setItem() { throw new Error('denied') },
  removeItem() { throw new Error('denied') },
}

/** A minimal entry view — only the fields the store and the tests read. */
const entryFor = (id: string, body: string, links: JournalEntryView['links'] = []): JournalEntryView => ({
  id,
  organizationId: 'org',
  captureId: randomUUID(),
  authorId: null,
  authorName: 'Viewer',
  performer: null,
  origin: 'person',
  systemEvent: null,
  kind: 'update',
  title: null,
  body,
  occurredPrecision: 'exact',
  occurredOn: '2026-09-22',
  occurredAt: '2026-09-22T08:00:00.000Z',
  revision: 1,
  source: 'typed',
  processingState: 'not_requested',
  legacyKind: null,
  legacyDismissed: false,
  legacyApplied: false,
  deletedAt: null,
  createdAt: '2026-09-22T08:00:00.000Z',
  updatedAt: '2026-09-22T08:00:00.000Z',
  links,
})

/** Every action refuses unless the case overrides it. */
const journalApiWith = (overrides: Partial<JournalApi>): JournalApi => ({
  createJournalEntry: async () => ({ ok: false, error: 'unavailable' }),
  editJournalEntry: async () => ({ ok: false, error: 'unavailable' }),
  deleteJournalEntry: async () => ({ ok: false, error: 'unavailable' }),
  loadJournalPage: async () => ({ ok: false, error: 'unavailable' }),
  loadJournalEntry: async () => ({ ok: false, error: 'unavailable' }),
  changeNextStep: async () => ({ ok: false, error: 'unavailable' }),
  ...overrides,
})

const pageOf = (entries: JournalEntryView[]) => ({
  ok: true as const,
  page: {
    entries,
    nextCursor: null,
    coverage: {
      returned: entries.length,
      hasMore: false,
      oldestCreatedAt: entries.at(-1)?.createdAt ?? null,
      loadedAt: '2026-09-22T09:00:00.000Z',
    },
  },
})

test('a failed submitCapture keeps the draft and reports the error', async () => {
  const org = randomUUID(), user = randomUUID()
  const storage = new FakeStorage()
  const store = createCRMStore(snapshotFor(workspaceFor(org, user)), {
    journal: journalApiWith({ createJournalEntry: async () => ({ ok: false, error: 'boom' }) }),
    draftStorage: storage,
  })

  // The composer writes the draft before it submits; the store never touches
  // it. This is that draft.
  const requestKey = randomUUID()
  writeDraft(org, user, 'journal', { text: 'the call went well', requestKey, kind: 'update', occurredOn: null }, storage)

  const result = await store.getState().submitCapture(
    { requestKey, text: 'the call went well' },
    { surface: 'journal' }
  )

  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.error, 'boom', 'the failure is reported, not swallowed')

  // The one thing that must not happen: losing the words.
  const kept = readDraft(org, user, 'journal', storage)
  assert.equal(kept?.text, 'the call went well')
  assert.equal(kept?.requestKey, requestKey,
    'and the same key, so a retry of a save that did land returns the original entry')

  // A failure the composer does not explain in place earns a toast.
  assert.ok(store.getState().toasts.some((t) => t.message === 'Save entry — boom'))
})

test('request_key_conflict surfaces the entry the key already produced', async () => {
  const org = randomUUID(), user = randomUUID()
  const storage = new FakeStorage()
  const existing = entryFor(randomUUID(), 'the text that was saved first')
  const store = createCRMStore(snapshotFor(workspaceFor(org, user)), {
    journal: journalApiWith({
      createJournalEntry: async () => ({ ok: false, error: 'request_key_conflict', existing }),
    }),
    draftStorage: storage,
  })

  const requestKey = randomUUID()
  writeDraft(org, user, 'journal', { text: 'edited afterwards', requestKey, kind: 'update', occurredOn: null }, storage)

  const result = await store.getState().submitCapture(
    { requestKey, text: 'edited afterwards' },
    { surface: 'journal' }
  )

  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.error, 'request_key_conflict')
  assert.equal(result.ok === false && result.existing?.id, existing.id,
    'the composer needs the entry to be able to link to it')
  assert.equal(readDraft(org, user, 'journal', storage)?.text, 'edited afterwards',
    'the edited text is not lost to a collision')
  // The composer says "already saved" in place; a toast on top would be noise.
  assert.equal(store.getState().toasts.length, 0)
})

test('an entry held by two views is edited once and both views agree', async () => {
  const org = randomUUID(), user = randomUUID()
  const opportunityId = randomUUID()
  const link = {
    id: randomUUID(),
    targetType: 'opportunity' as const,
    targetId: opportunityId,
    targetLabel: 'Meridian Labs',
    relationship: 'about',
  }
  const id = randomUUID()
  const original = entryFor(id, 'first wording', [link])
  const edited = { ...original, body: 'second wording', revision: 2 }

  const store = createCRMStore(snapshotFor(workspaceFor(org, user)), {
    journal: journalApiWith({
      loadJournalPage: async () => pageOf([original]),
      editJournalEntry: async () => ({ ok: true, entry: edited }),
    }),
    draftStorage: new FakeStorage(),
  })

  // The global feed and the prospect's own drawer, both holding this entry.
  await store.getState().loadJournalView('journal')
  await store.getState().loadJournalView(`prospect:${opportunityId}`, {
    targets: [{ type: 'opportunity', id: opportunityId }],
  })
  assert.deepEqual(store.getState().journal.views['journal'].ids, [id])
  assert.deepEqual(store.getState().journal.views[`prospect:${opportunityId}`].ids, [id])

  const result = await store.getState().editJournalEntry(id, { body: 'second wording', expectedRevision: 1 })
  assert.equal(result.ok, true)

  // Normalized: one copy, so there is nowhere for the two to disagree.
  assert.equal(store.getState().journal.entries[id].body, 'second wording')
  assert.equal(store.getState().journal.entries[id].revision, 2)
  assert.deepEqual(store.getState().journal.views['journal'].ids, [id])
  assert.deepEqual(store.getState().journal.views[`prospect:${opportunityId}`].ids, [id])
})

test('a new entry is filed into every view its links satisfy, and no others', async () => {
  const org = randomUUID(), user = randomUUID()
  const mine = randomUUID(), other = randomUUID()
  const id = randomUUID()
  const entry = entryFor(id, 'said yes to the pilot', [
    { id: randomUUID(), targetType: 'opportunity', targetId: mine, targetLabel: 'Meridian Labs', relationship: 'about' },
  ])

  const store = createCRMStore(snapshotFor(workspaceFor(org, user)), {
    journal: journalApiWith({
      loadJournalPage: async () => pageOf([]),
      createJournalEntry: async () => ({ ok: true, entry }),
    }),
    draftStorage: new FakeStorage(),
  })

  await store.getState().loadJournalView('journal')
  await store.getState().loadJournalView(`prospect:${mine}`, { targets: [{ type: 'opportunity', id: mine }] })
  await store.getState().loadJournalView(`prospect:${other}`, { targets: [{ type: 'opportunity', id: other }] })

  await store.getState().submitCapture(
    { requestKey: randomUUID(), text: 'said yes to the pilot' },
    { surface: `prospect:${mine}` }
  )

  assert.deepEqual(store.getState().journal.views['journal'].ids, [id], 'the global feed takes everything')
  assert.deepEqual(store.getState().journal.views[`prospect:${mine}`].ids, [id])
  assert.deepEqual(store.getState().journal.views[`prospect:${other}`].ids, [],
    'a prospect this entry says nothing about does not gain a line')
})

/* ————————————————————————————————————————————————————————————————————————
   When a Server Action REJECTS instead of answering.

   Every fake above resolves `{ ok: false }`, which is what an action does for
   anything it can see: a missing row, a stale revision, no database. These
   three are the other half. The promise rejects — the browser is offline, the
   route returned a 500, a deploy rotated the action id this bundle holds,
   `requireAuth()` threw on a session that expired between the page load and
   the click — and the store must reach the same place it reaches for a
   refusal. Nothing below catches: the whole point is that the callers do not
   have to.
   ———————————————————————————————————————————————————————————————————————— */

/** An action that is unreachable rather than unwilling. */
const rejecting = (message: string) => async (): Promise<never> => {
  throw new Error(message)
}

test('a rejected delete puts the entry back on every feed and says so', async () => {
  const org = randomUUID(), user = randomUUID()
  const opportunityId = randomUUID()
  const link = {
    id: randomUUID(),
    targetType: 'opportunity' as const,
    targetId: opportunityId,
    targetLabel: 'Meridian Labs',
    relationship: 'about',
  }
  const first = entryFor(randomUUID(), 'first', [link])
  const middle = entryFor(randomUUID(), 'the one being deleted', [link])
  const last = entryFor(randomUUID(), 'last', [link])

  const store = createCRMStore(snapshotFor(workspaceFor(org, user)), {
    journal: journalApiWith({
      loadJournalPage: async () => pageOf([first, middle, last]),
      deleteJournalEntry: rejecting('Failed to fetch'),
    }),
    draftStorage: new FakeStorage(),
  })

  await store.getState().loadJournalView('journal')
  await store.getState().loadJournalView(`prospect:${opportunityId}`, {
    targets: [{ type: 'opportunity', id: opportunityId }],
  })

  const result = await store.getState().deleteJournalEntry(middle.id)

  // The worst case the try/catch exists for: the entry is removed
  // optimistically, the rejection skips the restore, and an entry the writer
  // believes is gone is still in the database with nothing said about it.
  assert.equal(result.ok, false, 'a rejection is an answer here, not an exception the card must catch')
  assert.deepEqual(store.getState().journal.views['journal'].ids, [first.id, middle.id, last.id],
    'back in the position it was removed from')
  assert.deepEqual(store.getState().journal.views[`prospect:${opportunityId}`].ids,
    [first.id, middle.id, last.id], 'in every view that was holding it, not just the one it was deleted from')
  assert.equal(store.getState().journal.entries[middle.id]?.body, 'the one being deleted')
  assert.ok(store.getState().toasts.some((t) => t.message === 'Delete entry — Failed to fetch'),
    'and the writer is told')
})

test('a rejected read leaves the feed in error, never stuck on loading', async () => {
  const store = createCRMStore(snapshotFor(workspaceFor(randomUUID(), randomUUID())), {
    journal: journalApiWith({ loadJournalPage: rejecting('network down') }),
    draftStorage: new FakeStorage(),
  })

  await store.getState().loadJournalView('journal')

  // `loading` disables Refresh AND Load more, so a read that rejected and left
  // it set takes the feed's only two ways out with it for the session.
  const view = store.getState().journal.views['journal']
  assert.equal(view.status, 'error', 'not "loading"')
  assert.equal(view.error, 'network down', 'and the cause is what the feed shows')
})

test('a rejected save resolves as a refusal, so the composer keeps its words', async () => {
  const org = randomUUID(), user = randomUUID()
  const storage = new FakeStorage()
  const store = createCRMStore(snapshotFor(workspaceFor(org, user)), {
    journal: journalApiWith({ createJournalEntry: rejecting('Failed to fetch') }),
    draftStorage: storage,
  })

  const requestKey = randomUUID()
  writeDraft(org, user, 'journal', { text: 'the call went well', requestKey, kind: 'update', occurredOn: null }, storage)

  const result = await store.getState().submitCapture(
    { requestKey, text: 'the call went well' },
    { surface: 'journal' }
  )

  // The composer branches on the result and does not catch: a throw arriving
  // here would leave it on `status: 'saving'` for ever, with Save disabled and
  // the words it is holding unsubmittable.
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.error, 'Failed to fetch')
  assert.equal(readDraft(org, user, 'journal', storage)?.text, 'the call went well',
    'and the one promise the composer makes is kept')
  assert.ok(store.getState().toasts.some((t) => t.message === 'Save entry — Failed to fetch'))
})

/* ———— what the coverage line is counting, and what the poller may replace ———— */

/** A page that can say there is more behind it. */
const pageWith = (
  entries: JournalEntryView[],
  options: { nextCursor: string | null; hasMore: boolean }
) => ({
  ok: true as const,
  page: {
    entries,
    nextCursor: options.nextCursor,
    coverage: {
      returned: entries.length,
      hasMore: options.hasMore,
      oldestCreatedAt: entries.at(-1)?.createdAt ?? null,
      loadedAt: '2026-09-22T09:00:00.000Z',
    },
  },
})

test('coverage counts the whole list, not the last page read', async () => {
  const org = randomUUID(), user = randomUUID()
  const a = entryFor(randomUUID(), 'a'), b = entryFor(randomUUID(), 'b')
  const c = entryFor(randomUUID(), 'c'), d = entryFor(randomUUID(), 'd')
  const written = entryFor(randomUUID(), 'just typed')

  const store = createCRMStore(snapshotFor(workspaceFor(org, user)), {
    journal: journalApiWith({
      loadJournalPage: async (input) =>
        (input as { cursor?: string }).cursor === 'page-2'
          ? pageWith([c, d], { nextCursor: null, hasMore: false })
          : pageWith([a, b], { nextCursor: 'page-2', hasMore: true }),
      createJournalEntry: async () => ({ ok: true, entry: written }),
    }),
    draftStorage: new FakeStorage(),
  })

  await store.getState().loadJournalView('journal')
  assert.equal(store.getState().journal.views['journal'].coverage?.returned, 2)

  await store.getState().loadMoreJournal('journal')
  const loaded = store.getState().journal.views['journal']
  assert.deepEqual(loaded.ids, [a.id, b.id, c.id, d.id])
  assert.equal(loaded.coverage?.returned, 4,
    'four cards on screen is "Showing 4" — taking the new page wholesale printed "Showing 2" over them')
  assert.equal(loaded.coverage?.hasMore, false,
    'while hasMore is the newest page talking about the tail, which is where it belongs')

  await store.getState().submitCapture(
    { requestKey: randomUUID(), text: 'just typed' },
    { surface: 'journal' }
  )
  const afterWrite = store.getState().journal.views['journal']
  assert.equal(afterWrite.ids.length, 5)
  assert.equal(afterWrite.coverage?.returned, 5, 'a write grows the list, so it grows the count of the list')
})

/** An entry at a given minute, so a keyset Journal has an order to page by. */
const at = (id: string, body: string, minute: number): JournalEntryView => ({
  ...entryFor(id, body),
  createdAt: `2026-09-22T08:${String(minute).padStart(2, '0')}:00.000Z`,
})

/**
 * A Journal that pages the way listEntries does: newest first, `size` per
 * page, and a keyset cursor naming the POSITION after the last row returned —
 * so an insert above, or a deletion, shifts what the next page holds, exactly
 * as it does against the database. `rows()` is read on every call, so a case
 * can change the Journal between two reads.
 *
 * The earlier fakes answered each cursor with a fixed page, which a poller
 * that only ever re-read page one could not tell apart from the real thing.
 * A poller that re-reads the whole range can: a fixed page two never moves.
 */
const keysetJournal = (rows: () => JournalEntryView[], size: number) => async (input: unknown) => {
  const { cursor } = input as { cursor?: string }
  const all = rows()
  const after = cursor?.slice('after:'.length)
  const from = after === undefined ? 0 : all.findIndex((entry) => entry.createdAt < after)
  const start = from === -1 ? all.length : from
  const entries = all.slice(start, start + size)
  const hasMore = start + size < all.length
  return pageWith(entries, { nextCursor: hasMore ? `after:${entries.at(-1)?.createdAt}` : null, hasMore })
}

test('a poller refresh keeps the pages a reader asked for; an explicit read replaces them', async () => {
  const org = randomUUID(), user = randomUUID()
  const a = at(randomUUID(), 'a', 50), b = at(randomUUID(), 'b', 49)
  const c = at(randomUUID(), 'c', 48), d = at(randomUUID(), 'd', 47)
  const e = at(randomUUID(), 'e', 46), f = at(randomUUID(), 'f', 45)
  const fromColleague = at(randomUUID(), 'written by somebody else', 55)

  let rows = [a, b, c, d, e, f]
  const store = createCRMStore(snapshotFor(workspaceFor(org, user)), {
    journal: journalApiWith({ loadJournalPage: keysetJournal(() => rows, 2) }),
    draftStorage: new FakeStorage(),
  })

  // A feed on screen, showing two pages because somebody pressed Load more.
  store.getState().acquireJournalView('journal')
  await store.getState().loadJournalView('journal')
  await store.getState().loadMoreJournal('journal')
  assert.deepEqual(store.getState().journal.views['journal'].ids, [a.id, b.id, c.id, d.id])

  // A colleague writes a line; the poller sees the stamp move.
  rows = [fromColleague, ...rows]
  assert.equal(await store.getState().refreshJournalViews(), 'applied')

  // Two pages of two now end at c. The walk reads on until it reaches d, the
  // entry that was last on screen, and the page it reaches it on comes whole.
  const merged = store.getState().journal.views['journal']
  assert.deepEqual(merged.ids, [fromColleague.id, a.id, b.id, c.id, d.id, e.id],
    'the new line is prepended and the second page is still there, down to the last entry the reader had')
  assert.equal(merged.nextCursor, `after:${e.createdAt}`, 'and the cursor still points past the tail')
  assert.equal(merged.coverage?.hasMore, true, 'which is the last page read talking about what is below it')
  assert.equal(merged.coverage?.returned, 6)

  // Refresh, pressed. Somebody asked for the newest page, so that is the list.
  await store.getState().loadJournalView('journal')
  const replaced = store.getState().journal.views['journal']
  assert.deepEqual(replaced.ids, [fromColleague.id, a.id])
  assert.equal(replaced.nextCursor, `after:${a.createdAt}`)
  assert.equal(replaced.coverage?.returned, 2)
})

test('R5 — a poller refresh re-reads every page held: a deletion leaves, an edit on page two arrives', async () => {
  const org = randomUUID(), user = randomUUID()
  const a = at(randomUUID(), 'a', 50), b = at(randomUUID(), 'b, which a colleague deletes', 49)
  const c = at(randomUUID(), 'c', 48), d = at(randomUUID(), 'd', 47)

  let rows = [a, b, c, d]
  const store = createCRMStore(snapshotFor(workspaceFor(org, user)), {
    journal: journalApiWith({ loadJournalPage: keysetJournal(() => rows, 2) }),
    draftStorage: new FakeStorage(),
  })

  store.getState().acquireJournalView('journal')
  await store.getState().loadJournalView('journal')
  await store.getState().loadMoreJournal('journal')
  assert.deepEqual(store.getState().journal.views['journal'].ids, [a.id, b.id, c.id, d.id])

  // Elsewhere: b is deleted (the feed no longer returns it) and c is reworded.
  const reworded = { ...c, body: 'c, as a colleague reworded it', revision: 2 }
  rows = [a, reworded, d]
  assert.equal(await store.getState().refreshJournalViews(), 'applied')

  const view = store.getState().journal.views['journal']
  assert.deepEqual(view.ids, [a.id, c.id, d.id], 'b is gone from the list; the reader keeps a, c and d')
  assert.equal(store.getState().journal.entries[c.id].body, 'c, as a colleague reworded it',
    'the edit on page two reached the card — the first-page merge never read page two again')
  assert.equal(store.getState().journal.entries[c.id].revision, 2)
  assert.equal(store.getState().journal.entries[b.id], undefined,
    'and the deleted text is not kept in the store for anything to render')
  assert.equal(view.coverage?.returned, 3)
  assert.equal(view.coverage?.hasMore, false)
  assert.equal(view.nextCursor, null)
})

test('an entry another feed still shows is not dropped from the store with the view that lost it', async () => {
  const org = randomUUID(), user = randomUUID(), opportunityId = randomUUID()
  const link = { id: randomUUID(), targetType: 'opportunity' as const, targetId: opportunityId, targetLabel: 'Meridian Labs', relationship: 'about' }
  const a = at(randomUUID(), 'a', 50), c = at(randomUUID(), 'c', 48), d = at(randomUUID(), 'd', 47)
  const moved = { ...at(randomUUID(), 'no longer in the global filter', 49), links: [link] }

  let rows = [a, moved, c, d]
  const store = createCRMStore(snapshotFor(workspaceFor(org, user)), {
    journal: journalApiWith({
      loadJournalPage: async (input) =>
        (input as { targets?: unknown[] }).targets ? pageOf([moved]) : keysetJournal(() => rows, 2)(input),
    }),
    draftStorage: new FakeStorage(),
  })

  store.getState().acquireJournalView('journal')
  await store.getState().loadJournalView('journal')
  await store.getState().loadMoreJournal('journal')
  // The prospect's drawer holds the same entry, and is not being polled.
  await store.getState().loadJournalView(`prospect:${opportunityId}`, { targets: [{ type: 'opportunity', id: opportunityId }] })

  rows = [a, c, d]
  await store.getState().refreshJournalViews()
  assert.deepEqual(store.getState().journal.views['journal'].ids, [a.id, c.id, d.id])
  assert.equal(store.getState().journal.entries[moved.id]?.body, 'no longer in the global filter',
    'the drawer still renders it, from the one copy there is')
})

test('a released view is dropped, and the poller stops re-reading it', async () => {
  const org = randomUUID(), user = randomUUID()
  const entry = entryFor(randomUUID(), 'about a prospect somebody opened once')
  let reads = 0

  const store = createCRMStore(snapshotFor(workspaceFor(org, user)), {
    journal: journalApiWith({
      loadJournalPage: async () => {
        reads += 1
        return pageOf([entry])
      },
    }),
    draftStorage: new FakeStorage(),
  })

  const key = `prospect:${randomUUID()}`
  store.getState().acquireJournalView(key)
  await store.getState().loadJournalView(key)
  assert.equal(reads, 1)

  await store.getState().refreshJournalViews()
  assert.equal(reads, 2, 'a feed on screen is kept current')

  // The drawer closes. The store outlives the navigation; the view must not,
  // or every prospect ever opened is re-read every twelve seconds after it.
  store.getState().releaseJournalView(key)
  assert.equal(store.getState().journal.views[key], undefined)
  assert.equal(store.getState().journal.entries[entry.id]?.body, 'about a prospect somebody opened once',
    'the entry itself is kept — one cheap copy, and reopening the drawer renders it at once')

  await store.getState().refreshJournalViews()
  assert.equal(reads, 2, 'and nothing is read on behalf of a feed nobody is looking at')
})

test('two feeds on one view are counted, so the first to close does not take the other list', async () => {
  const store = createCRMStore(snapshotFor(workspaceFor(randomUUID(), randomUUID())), {
    journal: journalApiWith({ loadJournalPage: async () => pageOf([entryFor(randomUUID(), 'shared')]) }),
    draftStorage: new FakeStorage(),
  })

  // The dashboard's feed and a drawer opened over it, both on `prospect:<id>`.
  const key = `prospect:${randomUUID()}`
  store.getState().acquireJournalView(key)
  store.getState().acquireJournalView(key)
  await store.getState().loadJournalView(key)

  store.getState().releaseJournalView(key)
  assert.ok(store.getState().journal.views[key], 'one is still on screen')

  store.getState().releaseJournalView(key)
  assert.equal(store.getState().journal.views[key], undefined)
})

/* ———— R4: the poller forgets a change only once it is on screen ———— */

test('refreshJournalViews says what happened: deferred while typing, failed on a read error, applied otherwise', async () => {
  const entry = entryFor(randomUUID(), 'on screen')
  let reads = 0
  let failing = false
  const store = createCRMStore(snapshotFor(workspaceFor(randomUUID(), randomUUID())), {
    journal: journalApiWith({
      loadJournalPage: async () => {
        reads += 1
        return failing ? { ok: false, error: 'network down' } : pageOf([entry])
      },
    }),
    draftStorage: new FakeStorage(),
  })
  store.getState().acquireJournalView('journal')
  await store.getState().loadJournalView('journal')
  assert.equal(reads, 1)

  store.getState().setJournalTyping(true)
  assert.equal(await store.getState().refreshJournalViews(), 'deferred')
  assert.equal(reads, 1, 'nothing is read under somebody typing')
  store.getState().setJournalTyping(false)

  failing = true
  assert.equal(await store.getState().refreshJournalViews(), 'failed')
  assert.equal(store.getState().journal.views['journal'].status, 'error')

  failing = false
  assert.equal(await store.getState().refreshJournalViews(), 'applied')
  assert.equal(store.getState().journal.views['journal'].status, 'idle')
})

test('nextPollState — applied advances; deferred and failed keep the stamp pending and retry it', () => {
  assert.equal(pollAction(null, 'v1'), 'adopt', 'the first answer describes what the feeds just read')
  assert.equal(pollAction('v1', 'v1'), 'skip')
  assert.equal(pollAction('v1', 'v2'), 'refresh')

  assert.deepEqual(nextPollState('v1', 'v2', 'applied'), { seen: 'v2', pending: null })
  assert.equal(pollAction('v2', 'v2'), 'skip', 'and once shown, the same stamp is nothing to do')

  for (const outcome of ['deferred', 'failed'] as const) {
    const held = nextPollState('v1', 'v2', outcome)
    assert.deepEqual(held, { seen: 'v1', pending: 'v2' }, `${outcome}: seen does not move`)
    // The next tick fetches the SAME stamp. Compared with the last fetch it
    // would look like nothing changed — which is the bug.
    assert.equal(pollAction(held.seen, 'v2'), 'refresh', `${outcome}: an equal fetched stamp is retried`)
  }
})

test('R4 — a line written while somebody types appears once the typing stops', async () => {
  const mine = at(randomUUID(), 'already on screen', 40)
  const theirs = at(randomUUID(), 'written by a colleague meanwhile', 41)
  let rows = [mine]
  const store = createCRMStore(snapshotFor(workspaceFor(randomUUID(), randomUUID())), {
    journal: journalApiWith({ loadJournalPage: keysetJournal(() => rows, 30) }),
    draftStorage: new FakeStorage(),
  })
  store.getState().acquireJournalView('journal')
  await store.getState().loadJournalView('journal')

  // JournalSync's tick, driven by the same two pure functions it calls.
  let seen: string | null = null
  const tick = async (fetched: string) => {
    const action = pollAction(seen, fetched)
    if (action === 'adopt') seen = fetched
    if (action !== 'refresh') return
    seen = nextPollState(seen, fetched, await store.getState().refreshJournalViews()).seen
  }

  await tick('v1')
  store.getState().setJournalTyping(true)
  rows = [theirs, mine]
  await tick('v2')
  await tick('v2')
  assert.deepEqual(store.getState().journal.views['journal'].ids, [mine.id], 'held while typing')

  store.getState().setJournalTyping(false)
  await tick('v2')
  assert.deepEqual(store.getState().journal.views['journal'].ids, [theirs.id, mine.id],
    'the same stamp, fetched again, is applied rather than treated as already seen')
})

/* ———— R1: a save that comes back after the writer kept typing ———— */

test('settleSave — an unchanged draft clears, a newer one is kept with a new key, another surface is left alone', () => {
  const sent: SaveSnapshot = { text: 'Called Elena', kind: 'conversation', occurredOn: '', requestKey: 'k1', surface: 'journal' }

  assert.deepEqual(
    settleSave(sent, { text: 'Called Elena', kind: 'conversation', occurredOn: '', surface: 'journal', requestKey: 'k1' }),
    { clear: true, mintNewKey: false, announce: 'saved' }
  )
  assert.equal(settleSave(sent, { text: 'Called Elena  ', kind: 'conversation', occurredOn: '', surface: 'journal' }).clear, true,
    'trailing whitespace is not a newer draft — the entry is the trimmed text')

  // Typed on after pressing Save: the saved sentence leaves the box, the words
  // after it stay, and the old key — which now belongs to the saved entry — is
  // replaced. The same at any network speed: a fast answer and a slow one end
  // in the same box.
  assert.deepEqual(
    settleSave(sent, { text: 'Called Elena. Budget locked in.', kind: 'conversation', occurredOn: '', surface: 'journal', requestKey: 'k1' }),
    { clear: false, mintNewKey: true, text: 'Budget locked in.', announce: 'savedKeptNewer' }
  )
  // Only punctuation or whitespace after the sentence: nothing newer to keep.
  assert.equal(settleSave(sent, { text: 'Called Elena.', kind: 'conversation', occurredOn: '', surface: 'journal', requestKey: 'k1' }).clear, true,
    'a full stop typed after the saved sentence is not a newer draft')
  // The sent sentence was edited rather than continued: the saved and the newer
  // words cannot be told apart, so the whole text stays.
  const edited = settleSave(sent, { text: 'I called Elena twice', kind: 'conversation', occurredOn: '', surface: 'journal', requestKey: 'k1' })
  assert.equal(edited.clear, false)
  assert.equal(edited.text, undefined, 'an edited sentence is kept whole')
  // The kind or the date changed: kept whole too, since the entry that was
  // saved is not the one the box now describes.
  const rekinded = settleSave(sent, { text: 'Called Elena', kind: 'decision', occurredOn: '', surface: 'journal' })
  assert.equal(rekinded.announce, 'savedKeptNewer')
  assert.equal(rekinded.text, undefined)
  assert.equal(settleSave(sent, { text: 'Called Elena', kind: 'conversation', occurredOn: '2026-09-21', surface: 'journal' }).mintNewKey, true)

  // Emptied and restarted while the save was in flight: that draft already
  // minted its own key and keeps it.
  assert.deepEqual(
    settleSave(sent, { text: 'Something else entirely', kind: 'update', occurredOn: '', surface: 'journal', requestKey: 'k2' }),
    { clear: false, mintNewKey: false, announce: 'savedKeptNewer' }
  )
  assert.equal(settleSave(sent, { text: '', kind: 'conversation', occurredOn: '', surface: 'journal' }).clear, true,
    'an emptied box has nothing in it to keep')

  // The drawer moved to another prospect: nothing on screen is this save's.
  assert.deepEqual(
    settleSave({ ...sent, surface: 'prospect:a' }, { text: 'Called Elena', kind: 'conversation', occurredOn: '', surface: 'prospect:b' }),
    { clear: false, mintNewKey: false, announce: 'ignored' }
  )
})

test('settleSave settles the draft a save left behind on another surface, by the same rule', () => {
  const org = randomUUID(), user = randomUUID()
  const storage = new FakeStorage()
  const sent: SaveSnapshot = { text: 'Called Elena', kind: 'update', occurredOn: '', requestKey: 'k1', surface: 'prospect:a' }

  // What the composer does on 'ignored', against storage: the stored draft is
  // asked the same question the box would have been.
  const settleStored = () => {
    const stored = readDraft(org, user, sent.surface, storage)
    if (!stored || stored.requestKey !== sent.requestKey) return
    const decision = settleSave(sent, { ...stored, occurredOn: stored.occurredOn ?? '', surface: sent.surface })
    if (decision.clear) clearDraft(org, user, sent.surface, storage)
    else if (decision.mintNewKey) writeDraft(org, user, sent.surface, { ...stored, requestKey: 'k-fresh' }, storage)
  }

  writeDraft(org, user, 'prospect:a', { text: 'Called Elena', requestKey: 'k1', kind: 'update', occurredOn: null }, storage)
  settleStored()
  assert.equal(readDraft(org, user, 'prospect:a', storage), null, 'saved as it was left: forgotten')

  writeDraft(org, user, 'prospect:a', { text: 'Called Elena, and then some', requestKey: 'k1', kind: 'update', occurredOn: null }, storage)
  settleStored()
  const kept = readDraft(org, user, 'prospect:a', storage)
  assert.equal(kept?.text, 'Called Elena, and then some', 'typed on before switching prospect: kept')
  assert.equal(kept?.requestKey, 'k-fresh', 'under a key of its own')
})

/* ———— round 2, B: two tabs share one stored draft ———— */

test('settleStoredDraft — cleared only while storage holds what was sent; adopted when another tab advanced it; kept when both moved', () => {
  const sent: SaveSnapshot = { text: 'Called Elena', kind: 'conversation', occurredOn: '', requestKey: 'k1', surface: 'journal' }
  const unchanged: ComposerNow = { text: 'Called Elena', kind: 'conversation', occurredOn: '', surface: 'journal', requestKey: 'k1' }
  const asSent: StoredDraft = { text: 'Called Elena', kind: 'conversation', occurredOn: null, requestKey: 'k1' }
  // Tab B read k1 on mount and typed on under it while tab A's save was out.
  const tabB: StoredDraft = { text: 'Called Elena. Budget locked in.', kind: 'decision', occurredOn: '2026-09-21', requestKey: 'k1' }

  // 1. Storage still holds exactly what was sent: forgotten, box emptied.
  assert.deepEqual(settleStoredDraft(sent, unchanged, asSent),
    { box: 'clear', mintNewKey: false, stored: 'clear', announce: 'saved' })
  assert.equal(settleStoredDraft(sent, unchanged, { ...asSent, text: 'Called Elena  ' }).stored, 'clear',
    'trailing whitespace is not a newer draft — the entry is the trimmed text')

  // 2. Another tab advanced the stored draft; this box did not move. Storage
  //    is left alone and the box takes it up, key included.
  assert.deepEqual(settleStoredDraft(sent, unchanged, tabB),
    { box: 'adopt', mintNewKey: false, stored: 'keep', announce: 'savedKeptNewer' })
  assert.equal(settleStoredDraft(sent, unchanged, { ...asSent, requestKey: 'k2' }).stored, 'keep',
    'the same words under another key are not what this save sent')
  assert.equal(settleStoredDraft(sent, unchanged, { ...asSent, occurredOn: '2026-09-20' }).box, 'adopt',
    'a changed date is a newer draft too')

  // 3. Both moved: this box keeps its own newer words — the saved sentence
  //    leaves it — under a fresh key, and storage, the other tab's words, is
  //    neither cleared nor overwritten.
  const tabA: ComposerNow = { ...unchanged, text: 'Called Elena. Sent the deck.' }
  assert.deepEqual(settleStoredDraft(sent, tabA, tabB),
    { box: 'keep', mintNewKey: true, text: 'Sent the deck.', stored: 'keep', announce: 'savedKeptNewer' })

  // R1 still holds for one tab. Typed on after Save: storage IS this box's
  // words, so it is rewritten under the fresh key.
  assert.deepEqual(settleStoredDraft(sent, tabA, { ...asSent, text: tabA.text }),
    { box: 'keep', mintNewKey: true, text: 'Sent the deck.', stored: 'write', announce: 'savedKeptNewer' })
  // Emptied and restarted in flight: that draft already has its own key.
  assert.deepEqual(settleStoredDraft(sent, { ...tabA, requestKey: 'k2' }, { ...asSent, text: tabA.text, requestKey: 'k2' }),
    { box: 'keep', mintNewKey: false, text: 'Sent the deck.', stored: 'write', announce: 'savedKeptNewer' })
  // No stored draft (none, or a private window): decided on the box alone.
  assert.deepEqual(settleStoredDraft(sent, unchanged, null),
    { box: 'clear', mintNewKey: false, stored: 'keep', announce: 'saved' })
  assert.deepEqual(settleStoredDraft(sent, tabA, null),
    { box: 'keep', mintNewKey: true, text: 'Sent the deck.', stored: 'write', announce: 'savedKeptNewer' })
  // An emptied box stays empty, and another tab's stored words stay stored.
  assert.deepEqual(settleStoredDraft(sent, { ...unchanged, text: '', requestKey: null }, tabB),
    { box: 'clear', mintNewKey: false, stored: 'keep', announce: 'saved' })

  // The drawer moved on: the old surface's draft is settled on its own.
  const elsewhere: ComposerNow = { ...unchanged, surface: 'prospect:b' }
  const fromA = { ...sent, surface: 'prospect:a' }
  assert.deepEqual(settleStoredDraft(fromA, elsewhere, asSent),
    { box: 'ignore', mintNewKey: false, stored: 'clear', announce: 'ignored' })
  assert.equal(settleStoredDraft(fromA, elsewhere, tabB).stored, 'rekey', 'typed on under the used key: kept, re-keyed')
  assert.equal(settleStoredDraft(fromA, elsewhere, { ...tabB, requestKey: 'k2' }).stored, 'keep', 'a draft with its own key is left alone')
})

test('a save in one tab no longer erases the newer draft another tab stored', () => {
  const org = randomUUID(), user = randomUUID()
  const storage = new FakeStorage()

  // What JournalComposer.save does with `{ ok: true }`, step for step, against
  // the fake storage: re-read, ask, carry the answer out.
  const settle = (sent: SaveSnapshot, now: ComposerNow): ComposerNow => {
    const stored = readDraft(org, user, sent.surface, storage)
    const settled = settleStoredDraft(sent, now, stored)
    if (settled.stored === 'clear') clearDraft(org, user, sent.surface, storage)
    else if (settled.stored === 'rekey' && stored) writeDraft(org, user, sent.surface, { ...stored, requestKey: newRequestKey() }, storage)
    if (settled.box === 'ignore') return now
    if (settled.box === 'clear') return { ...now, text: '', occurredOn: '', requestKey: null }
    if (settled.box === 'adopt' && stored) return adoptDraft(stored, now)
    const key = settled.mintNewKey || !now.requestKey ? newRequestKey() : now.requestKey
    if (settled.stored === 'write') {
      writeDraft(org, user, sent.surface, { text: now.text, requestKey: key, kind: now.kind, occurredOn: now.occurredOn || null }, storage)
    }
    return { ...now, requestKey: key }
  }

  // Tab A submits S under k1. Tab B, open on the same surface, types newer
  // words into the stored draft — still under k1, which it read on mount.
  const sent: SaveSnapshot = { text: 'Called Elena', kind: 'update', occurredOn: '', requestKey: 'k1', surface: 'journal' }
  const tabA: ComposerNow = { text: 'Called Elena', kind: 'update', occurredOn: '', surface: 'journal', requestKey: 'k1' }
  writeDraft(org, user, 'journal', { text: 'Called Elena. Tab B kept going.', requestKey: 'k1', kind: 'idea', occurredOn: '2026-09-21' }, storage)

  // A's success finds its own box unchanged. It used to clear storage here.
  const boxA = settle(sent, tabA)
  const reloaded = readDraft(org, user, 'journal', storage)
  assert.equal(reloaded?.text, 'Called Elena. Tab B kept going.', 'a reload of tab B still finds its words')
  assert.equal(reloaded?.requestKey, 'k1')
  assert.deepEqual(boxA, { text: 'Called Elena. Tab B kept going.', kind: 'idea', occurredOn: '2026-09-21', surface: 'journal', requestKey: 'k1' },
    'and tab A now shows what storage holds, request key and all')

  // Both tabs moved: A keeps its own words under a fresh key; B's stay stored.
  writeDraft(org, user, 'journal', { text: 'Tab B, newer still', requestKey: 'k1', kind: 'update', occurredOn: null }, storage)
  const keptA = settle(sent, { ...tabA, text: 'Called Elena. Tab A kept going.' })
  assert.equal(keptA.text, 'Called Elena. Tab A kept going.')
  assert.ok(keptA.requestKey && keptA.requestKey !== 'k1', 'under a key of its own')
  assert.equal(readDraft(org, user, 'journal', storage)?.text, 'Tab B, newer still', 'storage is not cleared, nor overwritten')

  // One tab, nothing else writing: exactly as before — cleared.
  writeDraft(org, user, 'journal', { text: 'Called Elena', requestKey: 'k1', kind: 'update', occurredOn: null }, storage)
  assert.equal(settle(sent, tabA).text, '')
  assert.equal(readDraft(org, user, 'journal', storage), null, 'saved as it was left: forgotten')
})

test('shouldAdoptStored — an idle tab follows storage; a tab being written in, or holding words storage lost, does not', () => {
  const box: ComposerNow = { text: 'Called Elena', kind: 'update', occurredOn: '', surface: 'journal', requestKey: 'k1' }
  const previous: StoredDraft = { text: 'Called Elena', kind: 'update', occurredOn: null, requestKey: 'k1' }

  assert.equal(shouldAdoptStored(box, false, previous), true, 'idle and in step with storage: follows the other tab')
  assert.equal(shouldAdoptStored(box, true, previous), false, 'somebody is writing here: their text wins')
  assert.equal(shouldAdoptStored({ ...box, text: '' }, false, null), true, 'an empty box has nothing to lose')
  assert.equal(shouldAdoptStored(box, false, { ...previous, text: 'something older' }), false,
    'this box holds words storage no longer had — adopting would erase the only copy')
  assert.equal(shouldAdoptStored(box, false, null), false)

  // Another tab emptied or saved the draft: an idle box in step with it empties.
  assert.deepEqual(adoptDraft(null, box), { ...box, text: '', occurredOn: '', requestKey: null })
})

test('the drafts module round-trips every field a tab adopts, and parses a storage event value', () => {
  const org = randomUUID(), user = randomUUID()
  const storage = new FakeStorage()
  const box: ComposerNow = { text: '', kind: 'update', occurredOn: '', surface: 'prospect:a', requestKey: null }

  writeDraft(org, user, 'prospect:a', { text: 'Tab B wrote this', requestKey: 'k1', kind: 'decision', occurredOn: '2026-09-21' }, storage)
  const stored = readDraft(org, user, 'prospect:a', storage)
  assert.ok(stored)
  assert.deepEqual(adoptDraft(stored, box),
    { text: 'Tab B wrote this', kind: 'decision', occurredOn: '2026-09-21', requestKey: 'k1', surface: 'prospect:a' },
    'text, kind, date and request key all come across — the key is never dropped')

  // What a `storage` event carries is the raw value under the same key.
  const raw = storage.getItem(draftKey(org, user, 'prospect:a'))
  assert.deepEqual(parseDraft(raw), stored)
  assert.equal(parseDraft(null), null, 'a removed draft')
  assert.equal(parseDraft('not json'), null)
  assert.equal(parseDraft(JSON.stringify({ text: 'no key' })), null, 'a blob without a request key is not a draft')

  writeDraft(org, user, 'prospect:a', { text: 'Tab B wrote this', requestKey: 'k1', kind: 'update', occurredOn: null }, storage)
  assert.deepEqual(adoptDraft(readDraft(org, user, 'prospect:a', storage), box).occurredOn, '', '"now" is an empty date field')
})

/* ———— R2: an open editor stays on the revision it was opened on ———— */

test('the edit session keeps its base; an incoming revision does not move it, a rebase does', () => {
  let session = editSessionReducer(null, { type: 'beginEdit', revision: 3 })
  assert.deepEqual(session, { base: 3, latest: 3, conflict: false }, 'the base is captured on open')
  assert.equal(isStale(session!), false)

  session = editSessionReducer(session, { type: 'incomingRevision', revision: 4 })
  assert.equal(session?.base, 3, 'a colleague revision reaching the card is NOT adopted as the base')
  assert.equal(session?.latest, 4)
  assert.equal(isStale(session!), true, 'and the card knows the entry moved under it')
  assert.equal(incomingRevision(session!, 2), session, 'an older revision changes nothing')

  session = editSessionReducer(session, { type: 'conflict' })
  assert.equal(session?.conflict, true)
  assert.equal(session?.base, 3)

  session = editSessionReducer(session, { type: 'rebase', revision: 4 })
  assert.deepEqual(session, { base: 4, latest: 4, conflict: false }, 'only the writer choosing it moves the base')
  assert.equal(isStale(session!), false)

  assert.equal(editSessionReducer(session, { type: 'end' }), null)
  assert.equal(editSessionReducer(null, { type: 'incomingRevision', revision: 9 }), null, 'no editor, no session')
})

/* ———— round 2, A: an edit that comes back after the writer kept typing ———— */

test('settleEditSave — an unchanged editor closes; newer words keep it open on the revision the save produced', () => {
  const sent: EditDraft = { title: 'Call', body: 'Called Elena', kind: 'conversation' }

  // 1. The editor still says what was sent: it closes, as before.
  assert.deepEqual(settleEditSave(sent, { ...sent }, 4), { close: true, announce: 'saved' })
  assert.deepEqual(settleEditSave(sent, { title: 'Call ', body: 'Called Elena  ', kind: 'conversation' }, 4),
    { close: true, announce: 'saved' }, 'whitespace the save trims away is not a newer draft')

  // 2. Typed on in the body after Save: the editor stays, based on revision 4.
  assert.deepEqual(settleEditSave(sent, { ...sent, body: 'Called Elena. Budget locked in.' }, 4),
    { close: false, newBase: 4, announce: 'savedKeptNewer' })

  // 3. The title or the kind changed after Save: the same.
  assert.deepEqual(settleEditSave(sent, { ...sent, title: 'Call with Elena' }, 4),
    { close: false, newBase: 4, announce: 'savedKeptNewer' })
  assert.deepEqual(settleEditSave(sent, { ...sent, kind: 'decision' }, 4),
    { close: false, newBase: 4, announce: 'savedKeptNewer' })

  // The session moves to the saved revision, so the next Save is checked
  // against the writer's own save rather than colliding with it.
  const session = editSessionReducer(beginEdit(3), { type: 'saved', revision: 4 })
  assert.deepEqual(session, { base: 4, latest: 4, conflict: false })
  assert.equal(isStale(incomingRevision(session!, 4)), false, 'the card now showing revision 4 is not a conflict')
  assert.equal(editSessionReducer(null, { type: 'saved', revision: 4 }), null, 'no editor, no session')

  // Unlike a rebase, it does not jump past a colleague revision the card has
  // already been shown: that one still holds Save.
  const moved = savedAt(incomingRevision(beginEdit(3), 5), 4)
  assert.deepEqual(moved, { base: 4, latest: 5, conflict: false })
  assert.equal(isStale(moved), true)
  assert.equal(savedAt({ base: 3, latest: 3, conflict: true }, 4).conflict, false, 'the save landed: no conflict left open')
})

test('a revision_conflict re-reads the entry, so the editor can be offered the version it lost to', async () => {
  const org = randomUUID(), user = randomUUID()
  const id = randomUUID()
  const original = entryFor(id, 'first wording')
  const theirs = { ...original, body: 'their wording', revision: 2 }
  const sent: unknown[] = []

  const store = createCRMStore(snapshotFor(workspaceFor(org, user)), {
    journal: journalApiWith({
      loadJournalPage: async () => pageOf([original]),
      editJournalEntry: async (_id, patch) => {
        sent.push(patch)
        return { ok: false, error: 'revision_conflict' }
      },
      loadJournalEntry: async () => ({
        ok: true,
        entry: { ...theirs, originalText: 'first wording', revisions: [] },
      }),
    }),
    draftStorage: new FakeStorage(),
  })
  await store.getState().loadJournalView('journal')

  // The card opens its editor on revision 1.
  let session = beginEdit(store.getState().journal.entries[id].revision)
  const result = await store.getState().editJournalEntry(id, { body: 'my wording', expectedRevision: session.base })
  assert.equal(result.ok === false && result.error, 'revision_conflict')
  assert.equal((sent[0] as { expectedRevision: number }).expectedRevision, 1)

  const held = store.getState().journal.entries[id]
  assert.equal(held.revision, 2, 'the store now holds the revision that won')
  assert.equal(held.body, 'their wording')
  assert.equal('revisions' in held, false, 'as a view — the detail fields are not filed into the one copy')
  assert.equal(store.getState().toasts.length, 0, 'the card explains a conflict in place')

  session = incomingRevision(editSessionReducer(session, { type: 'conflict' })!, held.revision)
  assert.equal(session.base, 1, 'still the revision the words were written against')
  assert.equal(isStale(session), true)
  session = rebase(session, held.revision)
  assert.equal(session.base, 2, 'until the writer, shown the latest, chooses it')
})

/* ———— the drawer's next step: one action, optimistic, restored on refusal ———— */

test('changeNextStep moves the field at once, files the line, and puts the old value back on a refusal', async () => {
  const org = randomUUID(), user = randomUUID()
  const opportunityId = randomUUID()
  const opportunity: Opportunity = {
    id: opportunityId, companyId: randomUUID(), contactId: randomUUID(), stage: 'Warm', priority: 'high',
    inPipeline: true, nextStep: 'Book the demo', followUpDate: '2026-09-30', lastInteraction: '2026-09-22',
    tags: [], notes: '', order: 0,
  }
  const snapshot: CRMSnapshot = { ...snapshotFor(workspaceFor(org, user)), opportunities: [opportunity] }
  const line: JournalEntryView = {
    ...entryFor(randomUUID(), 'Book the demo', [
      { id: randomUUID(), targetType: 'opportunity', targetId: opportunityId, targetLabel: 'Meridian Labs', relationship: 'about' },
    ]),
    origin: 'system',
    systemEvent: 'next_step_changed',
  }

  let answer: NextStepActionResult = { ok: true, entry: line, previous: 'Book the demo' }
  const during: { nextStep?: string; merged?: boolean }[] = []
  const store = createCRMStore(snapshot, {
    journal: journalApiWith({
      loadJournalPage: async () => pageOf([]),
      changeNextStep: async () => {
        during.push({
          nextStep: store.getState().opportunities.find((o) => o.id === opportunityId)?.nextStep,
          // A snapshot read while the change is in the air does not have it.
          merged: store.getState().applyRemoteSnapshot(snapshot),
        })
        return answer
      },
    }),
    draftStorage: new FakeStorage(),
  })
  await store.getState().loadJournalView('journal')
  await store.getState().loadJournalView(`prospect:${opportunityId}`, { targets: [{ type: 'opportunity', id: opportunityId }] })

  const saved = await store.getState().changeNextStep(opportunityId, 'Send the proposal')
  assert.equal(saved.ok, true)
  assert.equal(during[0].nextStep, 'Send the proposal', 'the field moved before the server answered')
  assert.equal(during[0].merged, false, 'and a snapshot merge could not put the old value back meanwhile')
  assert.equal(store.getState().opportunities[0].nextStep, 'Send the proposal')
  assert.deepEqual(store.getState().journal.views[`prospect:${opportunityId}`].ids, [line.id], 'the line is in the drawer')
  assert.deepEqual(store.getState().journal.views['journal'].ids, [line.id], 'and on the global feed')
  assert.equal(store.getState().toasts.length, 0)

  // A refusal: the value it replaced comes back, and the writer is told.
  answer = { ok: false, error: 'boom' }
  const refused = await store.getState().changeNextStep(opportunityId, 'Something else')
  assert.equal(refused.ok, false)
  assert.equal(store.getState().opportunities[0].nextStep, 'Send the proposal')
  assert.ok(store.getState().toasts.some((t) => t.message === 'Update next step — boom'))

  // No database behind the deployment: like every other demo-mode write, the
  // field keeps its new value, and nothing is toasted.
  answer = { ok: false, error: 'unavailable' }
  await store.getState().changeNextStep(opportunityId, 'Demo value')
  assert.equal(store.getState().opportunities[0].nextStep, 'Demo value')
  assert.equal(store.getState().toasts.length, 1)

  // The session ended: the identity path, restored, no toast.
  answer = { ok: false, error: 'unauthorized' }
  await store.getState().changeNextStep(opportunityId, 'Third try')
  assert.equal(store.getState().identityChanged, true)
  assert.equal(store.getState().opportunities[0].nextStep, 'Demo value')
  assert.equal(store.getState().toasts.length, 1)
})

test('unauthorized reloads but keeps the draft; context_mismatch reloads and clears it', async () => {
  const org = randomUUID(), user = randomUUID()
  const draft = { text: 'unsent', requestKey: 'k1', kind: 'update' as const, occurredOn: null }

  // The session or membership ended. Nobody else is acting in this browser,
  // and the draft is keyed by this person — who is the only one it can be
  // offered to after signing back in.
  const expired = new FakeStorage()
  const ended = createCRMStore(snapshotFor(workspaceFor(org, user)), {
    journal: journalApiWith({ createJournalEntry: async () => ({ ok: false, error: 'unauthorized' }) }),
    draftStorage: expired,
  })
  writeDraft(org, user, 'journal', draft, expired)
  const refused = await ended.getState().submitCapture({ requestKey: 'k1', text: 'unsent' }, { surface: 'journal' })
  assert.equal(refused.ok === false && refused.error, 'unauthorized')
  assert.equal(ended.getState().identityChanged, true, 'SnapshotSync reloads the page on this')
  assert.equal(readDraft(org, user, 'journal', expired)?.text, 'unsent', 'and the words are still in storage')
  assert.equal(readDraft(org, user, 'journal', expired)?.requestKey, 'k1',
    'with their key, so a save that did land comes back as itself after signing in')
  assert.equal(ended.getState().toasts.length, 0, 'and nothing is toasted over a page that is going')

  // The same answer reached from outside the store — a caller passing the
  // refusal along — keeps the draft too.
  const roster = new FakeStorage()
  const outside = createCRMStore(snapshotFor(workspaceFor(org, user)), { draftStorage: roster })
  writeDraft(org, user, 'journal', draft, roster)
  outside.getState().markIdentityChanged('unauthorized')
  assert.equal(outside.getState().identityChanged, true)
  assert.equal(readDraft(org, user, 'journal', roster)?.text, 'unsent')

  // A different identity is already acting in this browser: cleared, as
  // designed.
  const swapped = new FakeStorage()
  const mismatched = createCRMStore(snapshotFor(workspaceFor(org, user)), {
    journal: journalApiWith({ createJournalEntry: async () => ({ ok: false, error: 'context_mismatch' }) }),
    draftStorage: swapped,
  })
  writeDraft(org, user, 'journal', draft, swapped)
  const mismatch = await mismatched.getState().submitCapture({ requestKey: 'k1', text: 'unsent' }, { surface: 'journal' })
  assert.equal(mismatch.ok === false && mismatch.error, 'context_mismatch')
  assert.equal(mismatched.getState().identityChanged, true)
  assert.equal(readDraft(org, user, 'journal', swapped), null, 'context_mismatch still clears the drafts')
  assert.equal(mismatched.getState().toasts.length, 0)
})

test('identityChanged clears the drafts of the identity the store was built for', () => {
  const org = randomUUID(), user = randomUUID(), stranger = randomUUID()
  const storage = new FakeStorage()
  const store = createCRMStore(snapshotFor(workspaceFor(org, user)), { draftStorage: storage })

  writeDraft(org, user, 'journal', { text: 'mine', requestKey: 'k1', kind: 'update', occurredOn: null }, storage)
  writeDraft(org, user, 'dashboard', { text: 'also mine', requestKey: 'k2', kind: 'idea', occurredOn: null }, storage)
  writeDraft(org, stranger, 'journal', { text: 'somebody else', requestKey: 'k3', kind: 'update', occurredOn: null }, storage)

  store.getState().markIdentityChanged()

  assert.equal(store.getState().identityChanged, true)
  assert.equal(readDraft(org, user, 'journal', storage), null, 'every surface of the finished identity')
  assert.equal(readDraft(org, user, 'dashboard', storage), null)
  assert.equal(readDraft(org, stranger, 'journal', storage)?.text, 'somebody else',
    'and nobody else is touched')
})

test('signing out clears the leaving identity drafts through the same helper', () => {
  // The control in AppSidebar / MobileChrome calls exactly this before the
  // logout form posts.
  const org = randomUUID(), user = randomUUID(), otherOrg = randomUUID()
  const storage = new FakeStorage()
  writeDraft(org, user, 'journal', { text: 'unsent', requestKey: 'k1', kind: 'update', occurredOn: null }, storage)
  writeDraft(otherOrg, user, 'journal', { text: 'other workspace', requestKey: 'k2', kind: 'update', occurredOn: null }, storage)

  clearDraftsFor(org, user, storage)

  assert.equal(readDraft(org, user, 'journal', storage), null)
  assert.equal(readDraft(otherOrg, user, 'journal', storage)?.text, 'other workspace',
    'the same person in another organization is a different identity')
})

test('the mount sweep removes foreign-identity drafts and keeps the current one', () => {
  const org = randomUUID(), user = randomUUID(), otherOrg = randomUUID(), otherUser = randomUUID()
  const storage = new FakeStorage()
  writeDraft(org, user, 'journal', { text: 'keep me', requestKey: 'k1', kind: 'update', occurredOn: null }, storage)
  writeDraft(org, user, 'prospect:abc', { text: 'keep me too', requestKey: 'k2', kind: 'update', occurredOn: null }, storage)
  writeDraft(otherOrg, user, 'journal', { text: 'gone', requestKey: 'k3', kind: 'update', occurredOn: null }, storage)
  writeDraft(org, otherUser, 'dashboard', { text: 'gone', requestKey: 'k4', kind: 'update', occurredOn: null }, storage)
  storage.setItem('khyte-settings', '{"theme":"dark"}')

  sweepForeignDrafts(org, user, storage)

  assert.equal(readDraft(org, user, 'journal', storage)?.text, 'keep me')
  assert.equal(readDraft(org, user, 'prospect:abc', storage)?.text, 'keep me too',
    'a surface key containing a colon is parsed correctly')
  assert.equal(readDraft(otherOrg, user, 'journal', storage), null)
  assert.equal(readDraft(org, otherUser, 'dashboard', storage), null)
  assert.equal(storage.getItem('khyte-settings'), '{"theme":"dark"}',
    'and keys outside the draft prefix are none of the sweep business')
})

test('the draft module survives a storage that throws on every access', () => {
  const org = randomUUID(), user = randomUUID()
  // Private mode: `localStorage` exists and every call raises. None of this
  // may reach a composer as an exception — the cost of a refusal is that the
  // draft is not remembered, which the composer degrades to component state.
  assert.doesNotThrow(() =>
    writeDraft(org, user, 'journal', { text: 'x', requestKey: 'k', kind: 'update', occurredOn: null }, hostileStorage))
  assert.equal(readDraft(org, user, 'journal', hostileStorage), null)
  assert.doesNotThrow(() => clearDraft(org, user, 'journal', hostileStorage))
  assert.doesNotThrow(() => clearDraftsFor(org, user, hostileStorage))
  assert.doesNotThrow(() => sweepForeignDrafts(org, user, hostileStorage))
})

test('formatJournalDate never shifts a day, and reads an instant in the organization zone', () => {
  const options = { timezone: 'Europe/Stockholm', locale: 'sv-SE', unknownLabel: 'Okänt datum' }

  // A day somebody picked. `new Date('2026-09-22')` is midnight UTC, and
  // formatting that instant anywhere west of Greenwich prints the 21st — the
  // bug lib/journal/format.ts exists to make impossible. The viewer's own
  // zone is irrelevant by construction: the parts are formatted directly.
  const day = formatJournalDate(
    { occurredPrecision: 'day', occurredOn: '2026-09-22', occurredAt: null },
    options
  )
  assert.match(day, /22/, `the 22nd stays the 22nd, got ${day}`)
  assert.ok(!day.includes('21'), `and never slides back a day, got ${day}`)
  assert.match(day, /2026/)

  // Same date, read from a browser on the other side of the world.
  assert.equal(
    formatJournalDate(
      { occurredPrecision: 'day', occurredOn: '2026-09-22', occurredAt: null },
      { ...options, timezone: 'Pacific/Honolulu' }
    ),
    day,
    'a day carries no instant, so no timezone can move it'
  )

  // An instant, which genuinely belongs to a zone: 22:30 UTC on the 21st is
  // half past midnight on the 22nd in Stockholm (decision 7).
  const exact = formatJournalDate(
    { occurredPrecision: 'exact', occurredOn: '2026-09-22', occurredAt: '2026-09-21T22:30:00Z' },
    options
  )
  assert.match(exact, /22/, `the Swedish day, got ${exact}`)
  assert.match(exact, /00[:.]30/, `at half past midnight, got ${exact}`)

  assert.equal(
    formatJournalDate({ occurredPrecision: 'unknown', occurredOn: null, occurredAt: null }, options),
    'Okänt datum'
  )
})

test('formatJournalDateTime stamps a revision on the organization clock, not the browser one', () => {
  // The card shows an entry's date and, under History, when each revision was
  // written. The first was already the organization's zone; the second was
  // the viewer's, which is how an edit made at 00:30 in Stockholm came to
  // read as the day before the entry it edited.
  const stockholm = formatJournalDateTime('2026-09-21T22:30:00Z', {
    timezone: 'Europe/Stockholm',
    locale: 'sv-SE',
  })
  assert.match(stockholm, /22/, `the Swedish day, got ${stockholm}`)
  assert.match(stockholm, /00[:.]30/, `at half past midnight, got ${stockholm}`)

  // The zone argument is what decides, not whatever zone this process is in.
  assert.notEqual(
    formatJournalDateTime('2026-09-21T22:30:00Z', { timezone: 'Pacific/Honolulu', locale: 'sv-SE' }),
    stockholm
  )

  // Same contract as the rest of the module: an unreadable value is shown as
  // it was stored rather than as "Invalid Date".
  assert.equal(
    formatJournalDateTime('not a date', { timezone: 'Europe/Stockholm', locale: 'sv-SE' }),
    'not a date'
  )
})

test('buildExportRows counts the Journal entries a prospect carries', () => {
  const opportunityId = randomUUID(), companyId = randomUUID(), contactId = randomUUID()
  const company: Company = {
    id: companyId, name: 'Meridian Labs', domain: 'meridian.test', industry: 'SaaS',
    size: '50-200', location: 'Stockholm', tags: [],
  }
  const contact: Contact = {
    id: contactId, companyId, name: 'Elena Hartmann', role: 'COO', email: 'elena@meridian.test',
  }
  const opportunity: Opportunity = {
    id: opportunityId, companyId, contactId, stage: 'Warm', priority: 'high', inPipeline: true,
    nextStep: 'Book the exec demo', followUpDate: '2026-09-30', lastInteraction: '2026-09-22',
    tags: [], notes: 'their own free-text field', order: 0,
  }

  const rows = buildExportRows([{ opportunity, company, contact }], {
    colleagueName: () => '',
    journal: {
      [opportunityId]: [
        { id: randomUUID(), body: 'Called Elena, budget is locked in', createdAt: '2026-09-20T10:00:00.000Z', occurredOn: '2026-09-20' },
        { id: randomUUID(), body: 'Sent the SOC 2 report', createdAt: '2026-09-22T09:00:00.000Z', occurredOn: '2026-09-22' },
      ],
    },
    today: new Date('2026-09-22T12:00:00.000Z'),
  })

  assert.equal(rows.length, 1)
  assert.equal(rows[0].noteCount, '2')
  assert.match(rows[0].noteHistory, /Called Elena, budget is locked in/)
  assert.match(rows[0].noteHistory, /Sent the SOC 2 report/)
  // Oldest first — a timeline reads forward.
  assert.ok(
    rows[0].noteHistory.indexOf('Called Elena') < rows[0].noteHistory.indexOf('Sent the SOC 2'),
    'the history is ordered oldest first'
  )
  assert.equal(rows[0].notes, 'their own free-text field',
    'and the CSV column literally named `notes` is still the opportunity field, untouched')
})
