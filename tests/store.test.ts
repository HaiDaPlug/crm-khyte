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
import type { JournalEntryView, JournalKind } from '../lib/journal/contracts'
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
  followStorage,
  reconcileOnMount,
  settleEditSave,
  settleSave,
  settleSentSlot,
  type ComposerNow,
  type EditDraft,
  type FollowBox,
  type SaveSnapshot,
  type StorageChange,
  type StoredDraft,
} from '../lib/journal/composer-state'
import { DraftBox, type HandedOver } from '../lib/journal/draft-box'
import {
  clearDraftsFor,
  draftKey,
  forgetOwnDraft,
  listDrafts,
  loadDraftFor,
  type OwnDraft,
  ownDraft,
  ownDraftKey,
  parseDraft,
  readDraftSlot,
  rememberOwnDraft,
  removeDraftSlot,
  slotKey,
  slotOf,
  sweepForeignDrafts,
  writeDraftSlot,
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
  writeDraftSlot(org, user, 'journal', { text: 'the call went well', requestKey, kind: 'update', occurredOn: null }, storage)

  const result = await store.getState().submitCapture(
    { requestKey, text: 'the call went well' },
    { surface: 'journal' }
  )

  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.error, 'boom', 'the failure is reported, not swallowed')

  // The one thing that must not happen: losing the words.
  const kept = readDraftSlot(org, user, 'journal', requestKey, storage)
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
  writeDraftSlot(org, user, 'journal', { text: 'edited afterwards', requestKey, kind: 'update', occurredOn: null }, storage)

  const result = await store.getState().submitCapture(
    { requestKey, text: 'edited afterwards' },
    { surface: 'journal' }
  )

  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.error, 'request_key_conflict')
  assert.equal(result.ok === false && result.existing?.id, existing.id,
    'the composer needs the entry to be able to link to it')
  assert.equal(readDraftSlot(org, user, 'journal', requestKey, storage)?.text, 'edited afterwards',
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
  writeDraftSlot(org, user, 'journal', { text: 'the call went well', requestKey, kind: 'update', occurredOn: null }, storage)

  const result = await store.getState().submitCapture(
    { requestKey, text: 'the call went well' },
    { surface: 'journal' }
  )

  // The composer branches on the result and does not catch: a throw arriving
  // here would leave it on `status: 'saving'` for ever, with Save disabled and
  // the words it is holding unsubmittable.
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.error, 'Failed to fetch')
  assert.equal(readDraftSlot(org, user, 'journal', requestKey, storage)?.text, 'the call went well',
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
  assert.equal(settleSave(sent, { text: 'Called Elena  ', kind: 'conversation', occurredOn: '', surface: 'journal', requestKey: 'k1' }).clear, true,
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
  const rekinded = settleSave(sent, { text: 'Called Elena', kind: 'decision', occurredOn: '', surface: 'journal', requestKey: 'k1' })
  assert.equal(rekinded.announce, 'savedKeptNewer')
  assert.equal(rekinded.text, undefined)
  assert.equal(settleSave(sent, { text: 'Called Elena', kind: 'conversation', occurredOn: '2026-09-21', surface: 'journal', requestKey: 'k1' }).mintNewKey, true)

  // Emptied and restarted while the save was in flight: that draft already
  // minted its own key and keeps it.
  assert.deepEqual(
    settleSave(sent, { text: 'Something else entirely', kind: 'update', occurredOn: '', surface: 'journal', requestKey: 'k2' }),
    { clear: false, mintNewKey: false, announce: 'savedKeptNewer' }
  )
  // A box with words and no key cannot keep a key it does not have.
  assert.equal(settleSave(sent, { text: 'Stray words', kind: 'update', occurredOn: '', surface: 'journal', requestKey: null }).mintNewKey, true)
})

test('Astra round 3, case 1 — an old save never truncates a new draft that begins with its words', () => {
  // Save "Call Erik" (K1), empty the box, type "Call Erik tomorrow" — which
  // minted K2. Round 2 compared text alone, took the new draft for a
  // continuation of the sent one, and the answer left "tomorrow": in the box,
  // and on the next keystroke in storage.
  const sent: SaveSnapshot = { text: 'Call Erik', kind: 'update', occurredOn: '', requestKey: 'K1', surface: 'journal' }
  const fresh: ComposerNow = { text: 'Call Erik tomorrow', kind: 'update', occurredOn: '', surface: 'journal', requestKey: 'K2' }

  assert.deepEqual(settleSave(sent, fresh), { clear: false, mintNewKey: false, announce: 'savedKeptNewer' },
    'another key is another draft: its whole text stays, under its own key, with no `text` to cut it to')
  assert.deepEqual(settleSave(sent, { ...fresh, text: 'Call Erik' }), { clear: false, mintNewKey: false, announce: 'savedKeptNewer' },
    'even the exact sent words, typed again as a new draft, are that draft — not the saved one')

  // The same words under the SENT key are the writer typing on after Save:
  // the round-1 rule, unchanged.
  assert.deepEqual(settleSave(sent, { ...fresh, requestKey: 'K1' }),
    { clear: false, mintNewKey: true, text: 'tomorrow', announce: 'savedKeptNewer' })
  assert.equal(settleSave(sent, { text: '', kind: 'conversation', occurredOn: '', surface: 'journal', requestKey: null }).clear, true,
    'an emptied box has nothing in it to keep')

  // The drawer moved to another prospect: nothing on screen is this save's.
  assert.deepEqual(
    settleSave({ ...sent, surface: 'prospect:a' }, { text: 'Called Elena', kind: 'conversation', occurredOn: '', surface: 'prospect:b', requestKey: 'k1' }),
    { clear: false, mintNewKey: false, announce: 'ignored' }
  )
})

/* ———— round 3: one slot per draft, one owner per tab ———— */

test('settleSentSlot — the sent slot goes only while it still holds the sent words', () => {
  const sent: SaveSnapshot = { text: 'Called Elena', kind: 'conversation', occurredOn: '', requestKey: 'k1', surface: 'journal' }
  const asSent: StoredDraft = { text: 'Called Elena', kind: 'conversation', occurredOn: null, requestKey: 'k1' }

  assert.equal(settleSentSlot(sent, asSent), 'clear', 'still the sent words, under the sent key: they are an entry now')
  assert.equal(settleSentSlot(sent, { ...asSent, text: 'Called Elena  ' }), 'clear',
    'trailing whitespace is not a newer draft — the entry is the trimmed text')
  assert.equal(settleSentSlot(sent, null), 'clear', 'already gone: nothing to do, and removing it again is harmless')

  // Somebody typed on under the key after the words left. Not this save's to erase.
  assert.equal(settleSentSlot(sent, { ...asSent, text: 'Called Elena. Budget locked in.' }), 'keep', 'advanced')
  assert.equal(settleSentSlot(sent, { ...asSent, kind: 'decision' }), 'keep', 'reshaped: a changed kind is newer words')
  assert.equal(settleSentSlot(sent, { ...asSent, occurredOn: '2026-09-20' }), 'keep', 'and so is a changed date')
  assert.equal(settleSentSlot(sent, { ...asSent, requestKey: 'k2' }), 'keep',
    'the same words under another key are another draft, not what this save sent')
})

test('followStorage — mirrors follow; typed words are never adopted over or emptied: restored, or forked', () => {
  const box = (over: Partial<FollowBox> = {}): FollowBox => ({
    text: 'Called Elena', kind: 'update', occurredOn: '', surface: 'journal', requestKey: 'k1',
    typedHere: true, typedText: over.text ?? 'Called Elena', letGo: new Set<string>(), ...over,
  })
  const stored = (text: string, over: Partial<StoredDraft> = {}): StoredDraft =>
    ({ text, kind: 'update', occurredOn: null, requestKey: 'k1', ...over })
  const on = (requestKey: string, previous: StoredDraft | null, next: StoredDraft | null): StorageChange =>
    ({ requestKey, previous, next })
  const empty = box({ text: '', requestKey: null, typedHere: false })
  const mirror = box({ typedHere: false })
  const mirrored = (draft: StoredDraft | null) => ({ do: 'adopt', draft, typedHere: false })

  // Another slot on this surface.
  const started = stored('Tab B started this', { requestKey: 'k2' })
  assert.deepEqual(followStorage(empty, false, on('k2', null, started)), mirrored(started),
    'an empty tab follows what another tab starts')
  assert.deepEqual(followStorage(empty, true, on('k2', null, started)), mirrored(started),
    'focused or not: an empty box has nothing to lose')
  assert.deepEqual(followStorage(box({ ...empty, letGo: new Set(['k2']) }), false, on('k2', null, started)), { do: 'ignore' },
    'but never a key this box let go of — a draft it saved or emptied does not come back to it')
  assert.deepEqual(followStorage(empty, false, on('k2', started, null)), { do: 'ignore' }, 'nothing to follow')
  assert.deepEqual(followStorage(mirror, false, on('k2', null, started)), { do: 'ignore' }, 'a box holding a draft ignores another one')
  assert.deepEqual(followStorage(box(), false, on('k2', null, started)), { do: 'ignore' })

  // This box's slot, removed — the other tab saved it, or emptied its box.
  assert.deepEqual(followStorage(box({ text: '' }), false, on('k1', stored('x'), null)), mirrored(null),
    'an empty box drops the key')
  assert.deepEqual(followStorage(mirror, false, on('k1', stored('Called Elena'), null)), mirrored(null),
    'a mirror in step with the slot: its owner is finished with it')
  assert.deepEqual(followStorage(mirror, false, on('k1', stored('Called Elena  '), null)), mirrored(null),
    'in step, as a saved entry reads it: trimmed')
  assert.deepEqual(followStorage(mirror, false, on('k1', stored('something older'), null)), { do: 'restore' },
    'a mirror holding words the slot did not have writes them back')
  assert.deepEqual(followStorage(mirror, false, on('k1', null, null)), { do: 'restore' }, 'and so does one that cannot tell')
  // (b) Astra's listener bug: the box's words equalled the old value, but they
  // were TYPED here. That another tab saved or emptied the same words proves
  // nothing about this tab's copy, which may be the only one: kept — under the
  // SAME key, so saving them again replays the filed entry rather than filing
  // a second one.
  assert.deepEqual(followStorage(box(), false, on('k1', stored('Called Elena'), null)), { do: 'restore' },
    'typed here: restores, never adopts the removal, never mints a key')
  assert.deepEqual(followStorage(box(), true, on('k1', stored('Called Elena'), null)), { do: 'restore' })

  // This box's slot, written by another tab.
  const onward = stored('Called Elena, and then some')
  assert.deepEqual(followStorage(box({ text: '' }), true, on('k1', null, onward)), mirrored(onward), 'empty: follows')
  assert.deepEqual(followStorage(mirror, false, on('k1', stored('Called Elena'), onward)), mirrored(onward),
    'a mirror follows its source')
  const rewritten = stored('Something else entirely', { kind: 'decision' })
  assert.deepEqual(followStorage(mirror, true, on('k1', stored('Called Elena'), rewritten)), mirrored(rewritten),
    'whatever the source writes, focused or not: nothing in a mirror was typed here')
  // Typed here, idle, and the new words carry on from the box: nothing typed
  // here is lost — and it is still in the box, as the start of the new words,
  // so the box stays typed-here and no later rule may empty it.
  assert.deepEqual(followStorage(box(), false, on('k1', stored('Called Elena'), onward)),
    { do: 'adopt', draft: onward, typedHere: true })
  assert.deepEqual(followStorage(box({ text: 'Called Elena ' }), false, on('k1', null, onward)),
    { do: 'adopt', draft: onward, typedHere: true }, 'compared trimmed: a trailing space in the box is not words')
  assert.deepEqual(followStorage(box(), true, on('k1', stored('Called Elena'), onward)), { do: 'fork' },
    'somebody is writing HERE: their words move to a key of their own rather than change under the cursor')
  assert.deepEqual(followStorage(box(), false, on('k1', null, stored('Called Elena, and then some', { kind: 'decision' }))),
    { do: 'fork' }, 'a continuation with another kind is not this box carried on')
  assert.deepEqual(followStorage(box(), false, on('k1', null, stored('Called Elena, and then some', { occurredOn: '2026-09-21' }))),
    { do: 'fork' }, 'nor one with another date')
  // (a) The other named loss: a tab that typed words is written over with
  // DIFFERENT words under the same key. Adopting would erase the only copy.
  assert.deepEqual(followStorage(box(), false, on('k1', stored('Called Elena'), stored('Called Erik instead'))), { do: 'fork' },
    'typed here, and the other tab wrote different words: fork, never adopt')
  // What counts is what was TYPED here, not the box: after taking up another
  // tab's " Erik", that tab taking its own words back still continues "Call".
  const took = box({ text: 'Call Erik', typedText: 'Call' })
  assert.deepEqual(followStorage(took, false, on('k1', stored('Call Erik'), stored('Call Eri'))),
    { do: 'adopt', draft: stored('Call Eri'), typedHere: true }, 'a backspace in the other tab does not fork this one')
  assert.deepEqual(followStorage(took, false, on('k1', stored('Call Erik'), stored('Cal'))), { do: 'fork' },
    'a backspace into the words typed HERE does')

  // Adopting nothing empties the box the way a save empties it.
  assert.deepEqual(adoptDraft(null, box()), { ...box(), text: '', occurredOn: '', requestKey: null })
})

test('the draft slots round-trip every field a tab adopts, and parse a storage event value', () => {
  const org = randomUUID(), user = randomUUID()
  const storage = new FakeStorage()
  const box: ComposerNow = { text: '', kind: 'update', occurredOn: '', surface: 'prospect:a', requestKey: null }

  writeDraftSlot(org, user, 'prospect:a', { text: 'Tab B wrote this', requestKey: 'k1', kind: 'decision', occurredOn: '2026-09-21' }, storage)
  const stored = readDraftSlot(org, user, 'prospect:a', 'k1', storage)
  assert.ok(stored)
  assert.deepEqual(adoptDraft(stored, box),
    { text: 'Tab B wrote this', kind: 'decision', occurredOn: '2026-09-21', requestKey: 'k1', surface: 'prospect:a' },
    'text, kind, date and request key all come across — the key is never dropped')

  // What a `storage` event carries is the raw value under the slot's key, and
  // the key itself says which draft it is.
  const key = slotKey(org, user, 'prospect:a', 'k1')
  assert.equal(key, `${draftKey(org, user, 'prospect:a')}:k1`)
  assert.equal(slotOf(key, org, user, 'prospect:a'), 'k1')
  assert.equal(slotOf(draftKey(org, user, 'prospect:a'), org, user, 'prospect:a'), null, 'the legacy single key is not a slot')
  assert.equal(slotOf(key, org, user, 'prospect'), null, 'nor is a longer surface a slot of a shorter one')
  assert.equal(slotOf(slotKey(org, randomUUID(), 'prospect:a', 'k1'), org, user, 'prospect:a'), null, 'nor somebody else’s')
  assert.equal(slotOf('khyte-settings', org, user, 'prospect:a'), null)
  assert.deepEqual(parseDraft(storage.getItem(key)), stored)
  assert.equal(parseDraft(null), null, 'a removed draft')
  assert.equal(parseDraft('not json'), null)
  assert.equal(parseDraft(JSON.stringify({ text: 'no key' })), null, 'a blob without a request key is not a draft')

  writeDraftSlot(org, user, 'prospect:a', { text: 'Tab B wrote this', requestKey: 'k1', kind: 'update', occurredOn: null }, storage)
  assert.deepEqual(adoptDraft(readDraftSlot(org, user, 'prospect:a', 'k1', storage), box).occurredOn, '', '"now" is an empty date field')

  removeDraftSlot(org, user, 'prospect:a', 'k1', storage)
  assert.equal(readDraftSlot(org, user, 'prospect:a', 'k1', storage), null)
})

test('loadDraftFor — the owned slot wins, a tab owning nothing takes the newest, a legacy slot is moved not dropped', () => {
  const org = randomUUID(), user = randomUUID()
  const local = new FakeStorage()
  const mine = new FakeStorage()
  writeDraftSlot(org, user, 'journal',
    { text: 'mine', requestKey: 'k1', kind: 'update', occurredOn: null, updatedAt: '2026-09-24T08:00:00.000Z' }, local)
  writeDraftSlot(org, user, 'journal',
    { text: 'theirs, newer', requestKey: 'k2', kind: 'idea', occurredOn: null, updatedAt: '2026-09-24T09:00:00.000Z' }, local)
  rememberOwnDraft(org, user, 'journal', 'k1', mine)

  assert.deepEqual(listDrafts(org, user, 'journal', local).map(d => d.requestKey), ['k2', 'k1'], 'newest first')
  assert.equal(loadDraftFor(org, user, 'journal', local, mine)?.text, 'mine',
    'a reload gets its own words back, however much newer another tab’s are')
  assert.equal(ownDraftKey(org, user, 'journal', mine), 'k1')

  const fresh = new FakeStorage()
  assert.equal(loadDraftFor(org, user, 'journal', local, fresh)?.text, 'theirs, newer', 'a new tab takes the newest')
  assert.equal(ownDraftKey(org, user, 'journal', fresh), 'k2', 'and remembers it as its own')

  // The owned slot is gone (saved, or emptied elsewhere): the newest remaining.
  removeDraftSlot(org, user, 'journal', 'k1', local)
  assert.equal(loadDraftFor(org, user, 'journal', local, mine)?.requestKey, 'k2')
  assert.equal(ownDraftKey(org, user, 'journal', mine), 'k2')

  // Nothing at all: nothing shown, and a key naming a slot that is gone forgotten.
  const stale = new FakeStorage()
  rememberOwnDraft(org, user, 'dashboard', 'gone', stale)
  assert.equal(loadDraftFor(org, user, 'dashboard', local, stale), null)
  assert.equal(ownDraftKey(org, user, 'dashboard', stale), null)

  // An older build's single slot: moved to the slot its key names, then removed.
  local.setItem(draftKey(org, user, 'dashboard'),
    JSON.stringify({ text: 'from the old build', requestKey: 'k9', kind: 'idea', occurredOn: '2026-09-20', updatedAt: '2026-09-23T08:00:00.000Z' }))
  const migrated = loadDraftFor(org, user, 'dashboard', local, new FakeStorage())
  assert.equal(migrated?.text, 'from the old build')
  assert.equal(migrated?.requestKey, 'k9', 'with its key, so a save that landed still comes back as itself')
  assert.equal(readDraftSlot(org, user, 'dashboard', 'k9', local)?.occurredOn, '2026-09-20')
  assert.equal(local.getItem(draftKey(org, user, 'dashboard')), null, 'and the legacy key is gone')

  // A legacy draft whose key is already taken by different words: both kept.
  local.setItem(draftKey(org, user, 'prospect:a'), JSON.stringify({ text: 'old build words', requestKey: 'k7', kind: 'update' }))
  writeDraftSlot(org, user, 'prospect:a', { text: 'new build words', requestKey: 'k7', kind: 'update', occurredOn: null }, local)
  assert.deepEqual(listDrafts(org, user, 'prospect:a', local).map(d => d.text).sort(), ['new build words', 'old build words'])
  assert.equal(readDraftSlot(org, user, 'prospect:a', 'k7', local)?.text, 'new build words', 'the slot is not written over')
  assert.equal(local.getItem(draftKey(org, user, 'prospect:a')), null)

  // A legacy draft already in its slot, word for word: only the legacy key goes.
  writeDraftSlot(org, user, 'prospect:b', { text: 'same', requestKey: 'k8', kind: 'update', occurredOn: null }, local)
  local.setItem(draftKey(org, user, 'prospect:b'), JSON.stringify({ text: 'same', requestKey: 'k8', kind: 'update', occurredOn: null }))
  assert.equal(listDrafts(org, user, 'prospect:b', local).length, 1)
  assert.equal(local.getItem(draftKey(org, user, 'prospect:b')), null,
    'the legacy key itself is gone — listing alone would pass even if it stayed, since it is not a slot')

  // A slot without a stamp (hand-edited, or an older build's) is the oldest,
  // not the newest: a tab owning nothing must not be handed it over real words.
  local.setItem(slotKey(org, user, 'prospect:c', 'unstamped'), JSON.stringify({ text: 'no stamp', requestKey: 'unstamped', kind: 'update' }))
  writeDraftSlot(org, user, 'prospect:c',
    { text: 'stamped', requestKey: 'stamped', kind: 'update', occurredOn: null, updatedAt: '2020-01-01T00:00:00.000Z' }, local)
  assert.deepEqual(listDrafts(org, user, 'prospect:c', local).map(d => d.requestKey), ['stamped', 'unstamped'])
  assert.equal(parseDraft(local.getItem(slotKey(org, user, 'prospect:c', 'unstamped')))?.updatedAt, '')
})

/**
 * One origin's localStorage, shared by several tabs. A write fires `storage`
 * in the OTHER tabs — as a browser does, on a later task, so the events queue
 * here until `deliver()` — and only when the value actually changed. The
 * clock gives every write its own `updatedAt`, so "newest" is unambiguous;
 * `full` makes every write throw, as a quota does.
 */
class Origin {
  readonly local = new FakeStorage()
  readonly tabs: BrowserTab[] = []
  full = false
  private clock = Date.parse('2026-09-24T08:00:00.000Z')
  private queue: Array<{ from: BrowserTab; key: string; oldValue: string | null; newValue: string | null }> = []

  readonly now = (): string => {
    this.clock += 1000
    return new Date(this.clock).toISOString()
  }

  storageFor(tab: BrowserTab): DraftStorage {
    const origin = this
    const { local, queue } = this
    return {
      get length() { return local.length },
      key: (index) => local.key(index),
      getItem: (key) => local.getItem(key),
      setItem: (key, value) => {
        if (origin.full) throw new Error('QuotaExceededError')
        const oldValue = local.getItem(key)
        local.setItem(key, value)
        if (oldValue !== value) queue.push({ from: tab, key, oldValue, newValue: value })
      },
      removeItem: (key) => {
        const oldValue = local.getItem(key)
        local.removeItem(key)
        if (oldValue !== null) queue.push({ from: tab, key, oldValue, newValue: null })
      },
    }
  }

  deliver(): void {
    for (let event = this.queue.shift(); event; event = this.queue.shift()) {
      for (const tab of this.tabs) if (tab !== event.from) tab.hear(event)
    }
  }
}

/**
 * A browser tab: its own sessionStorage, whether it has focus, and the REAL
 * `DraftBox` of the composer on screen — lib/journal/draft-box.ts, the module
 * JournalComposer.tsx calls, not a copy of it. Nothing here decides anything;
 * it only routes the origin's `storage` events to the draft box, as the
 * component's listener does, and names things for the assertions.
 */
class BrowserTab {
  focused = false
  draft!: DraftBox
  /** Answers handed to the box on screen by one unmounted mid-save — what the
   *  component's `listen` callback renders. */
  readonly heard: HandedOver[] = []
  readonly session: FakeStorage
  private readonly local: DraftStorage

  constructor(
    private readonly origin: Origin,
    private readonly org: string,
    private readonly user: string,
    session = new FakeStorage()
  ) {
    this.session = session
    this.local = origin.storageFor(this)
    origin.tabs.push(this)
  }

  /** The composer mounting on a surface — or the drawer swapping to one. */
  mount(surface = 'journal'): this {
    this.draft?.unmount()
    this.draft = new DraftBox({
      organizationId: this.org, userId: this.user, surface,
      storage: this.local, session: this.session, now: this.origin.now,
    })
    this.draft.mount()
    this.draft.listen((handedOver) => this.heard.push(handedOver))
    return this
  }

  hear(event: { key: string; oldValue: string | null; newValue: string | null }): void {
    this.draft.onStorage(event.key, event.oldValue, event.newValue, this.focused)
  }

  get box() {
    return this.draft.box
  }

  type(text: string): this {
    this.draft.change({ text })
    return this
  }

  /** Save pressed; the answer is `settleOk(sent)` or `settleRefused(sent, refusal)`. */
  press(options: { freshKey?: boolean } = {}): SaveSnapshot {
    const start = this.draft.beginSave(options)
    assert.ok(start, 'there was something to save')
    return start.sent
  }

  slot(requestKey: string | null, surface = this.box.surface) {
    return requestKey ? readDraftSlot(this.org, this.user, surface, requestKey, this.local) : null
  }

  own(surface = this.box.surface) {
    return ownDraftKey(this.org, this.user, surface, this.session)
  }

  /** The tab closes: its composer unmounts, and it hears nothing more. */
  close(): void {
    this.draft.unmount()
    this.origin.tabs.splice(this.origin.tabs.indexOf(this), 1)
  }

  /** A reload: the same sessionStorage, a new page. */
  reload(surface = this.box.surface): BrowserTab {
    this.close()
    return new BrowserTab(this.origin, this.org, this.user, this.session).mount(surface)
  }
}

/**
 * The service's request-key contract, as the composer meets it: a key files
 * its words once; the same key with the same words again is a replay of that
 * entry; the same key with other words is `request_key_conflict`.
 */
class Service {
  readonly entries = new Map<string, string>()

  /** Save pressed in `tab`, answered, and the answer settled — as `save` does. */
  save(tab: BrowserTab, options: { freshKey?: boolean } = {}): 'filed' | 'replayed' | 'request_key_conflict' {
    const start = tab.draft.beginSave(options)
    assert.ok(start, 'there was something to save')
    const answer = this.answer(start.sent)
    if (answer === 'request_key_conflict') tab.draft.settleRefused(start.sent, { error: answer, existing: null })
    else tab.draft.settleOk(start.sent)
    return answer
  }

  answer(sent: SaveSnapshot): 'filed' | 'replayed' | 'request_key_conflict' {
    const words = sent.text.trim()
    const filed = this.entries.get(sent.requestKey)
    if (filed === undefined) {
      this.entries.set(sent.requestKey, words)
      return 'filed'
    }
    return filed === words ? 'replayed' : 'request_key_conflict'
  }
}

test('Astra round 3, case 2 — divergent drafts in two tabs end in two slots, each tab owning its own', () => {
  // The old model, replayed in words. Both tabs wrote ONE slot per surface,
  // `khyte:journal-draft:<org>:<user>:journal`. When A wrote "X Z" over it,
  // B's box held "X Y" — exactly the event's old value, since B had written
  // it — and B was idle, so B adopted "X Z": "X Y" then existed nowhere, the
  // listener having overwritten the last copy of B's words. Had B been
  // focused instead, it would have kept "X Y" in memory alone, with storage
  // holding "X Z", and B's reload would have come back with A's words.
  const origin = new Origin()
  const org = randomUUID(), user = randomUUID()

  const a = new BrowserTab(origin, org, user).mount()
  a.focused = true
  a.type('X')
  origin.deliver()
  const k1 = a.box.requestKey
  assert.ok(k1)
  assert.equal(a.own(), k1, 'the tab that minted the key owns it')

  // B opens, owning nothing: it mirrors the newest draft, and owns it too.
  const b = new BrowserTab(origin, org, user).mount()
  assert.deepEqual([b.box.text, b.box.requestKey, b.box.typedHere], ['X', k1, false])
  assert.equal(b.own(), k1)

  // B types on. A, idle, sees words that carry its own on, and follows.
  a.focused = false
  b.focused = true
  b.type('X Y')
  origin.deliver()
  assert.deepEqual([a.box.text, a.box.requestKey, a.box.typedHere], ['X Y', k1, true],
    'A follows: nothing typed in A is lost, and what A typed is still the start of its box')

  // A edits to "X Z" while B's "X Y" was typed in B. B's words do not carry
  // on from A's, and they were typed there: B forks, and A keeps the key.
  b.focused = false
  a.focused = true
  a.type('X Z')
  origin.deliver()
  assert.equal(a.box.text, 'X Z')
  assert.equal(a.box.requestKey, k1)
  assert.equal(b.box.text, 'X Y', 'B still shows its own words')
  const k2 = b.box.requestKey
  assert.ok(k2 && k2 !== k1, 'under a key of its own')
  assert.equal(b.own(), k2)

  assert.equal(a.slot(k1)?.text, 'X Z', 'both versions are in storage')
  assert.equal(a.slot(k2)?.text, 'X Y')
  assert.equal(listDrafts(org, user, 'journal', origin.local).length, 2)

  // Reload each tab (same sessionStorage): each gets its own words back.
  assert.equal(new BrowserTab(origin, org, user, a.session).mount().box.text, 'X Z')
  assert.equal(new BrowserTab(origin, org, user, b.session).mount().box.text, 'X Y')
  // A new tab owns nothing and takes the newest — B's fork was written last.
  assert.equal(new BrowserTab(origin, org, user).mount().box.text, 'X Y')
})

test('the save flow settles slots by key: typed on, begun again, saved as new, saved elsewhere', () => {
  const org = randomUUID(), user = randomUUID()

  // One tab, typed on after Save (R1): the saved sentence leaves the box, the
  // rest moves to a fresh key and slot, and the old slot — which the box's own
  // keystrokes filled — goes with the words that left it.
  {
    const tab = new BrowserTab(new Origin(), org, user).mount()
    tab.type('Called Elena')
    const sent = tab.press()
    tab.type('Called Elena. Budget locked in.')
    tab.draft.settleOk(sent)
    assert.equal(tab.box.text, 'Budget locked in.')
    assert.ok(tab.box.requestKey && tab.box.requestKey !== sent.requestKey)
    assert.equal(tab.box.typedHere, true, 'still typed here and unsaved: nothing may adopt over it')
    assert.equal(tab.slot(sent.requestKey), null, 'no stale copy of the saved sentence is left to be offered again')
    assert.equal(tab.slot(tab.box.requestKey)?.text, 'Budget locked in.')
    assert.equal(tab.own(), tab.box.requestKey)
  }

  // Astra's case 1, through the wiring: emptied and begun again while the
  // save was out. The new draft is whole, in the box and in its slot.
  {
    const tab = new BrowserTab(new Origin(), org, user).mount()
    tab.type('Call Erik')
    const sent = tab.press()
    tab.type('')
    assert.equal(tab.slot(sent.requestKey), null, 'emptying the box released its slot')
    tab.type('Call Erik tomorrow')
    const k2 = tab.box.requestKey
    tab.draft.settleOk(sent)
    assert.deepEqual([tab.box.text, tab.box.requestKey], ['Call Erik tomorrow', k2])
    assert.equal(tab.slot(k2)?.text, 'Call Erik tomorrow', 'and storage was never cut down to "tomorrow"')
    assert.equal(tab.own(), k2)
  }

  // Unchanged: box and slot cleared, ownership forgotten.
  {
    const tab = new BrowserTab(new Origin(), org, user).mount()
    tab.type('Called Elena')
    const sent = tab.press()
    tab.draft.settleOk(sent)
    assert.equal(tab.box.text, '')
    assert.equal(tab.slot(sent.requestKey), null)
    assert.equal(tab.own(), null)
  }

  // "Save as a new entry": the draft MOVES from the collided key to a fresh
  // one before the await — written there, released here, remembered as own.
  {
    const tab = new BrowserTab(new Origin(), org, user).mount()
    tab.type('edited afterwards')
    const collided = tab.box.requestKey
    const sent = tab.press({ freshKey: true })
    assert.notEqual(sent.requestKey, collided)
    assert.equal(tab.slot(collided), null, 'the old slot is gone')
    assert.equal(tab.slot(sent.requestKey)?.text, 'edited afterwards', 'the words are in the new one before the answer')
    assert.equal(tab.own(), sent.requestKey, 'and a reload finds them under the new key, not the one that collides')
    tab.draft.settleOk(sent)
    assert.equal(tab.slot(sent.requestKey), null)
  }

  // The drawer moved on mid-save: only the sent slot is settled. Unchanged, it
  // goes; typed on before the switch, it stays under the sent key — its words
  // were never saved, and saving them later meets the conflict strip.
  // The answer goes to the draft box the save was pressed in, as the
  // component's `save` closure sends it — not to the one on screen now.
  {
    const tab = new BrowserTab(new Origin(), org, user).mount('prospect:a')
    tab.type('Called Elena')
    const pressedIn = tab.draft
    const sent = tab.press()
    tab.mount('prospect:b')
    tab.type('Words about prospect b')
    assert.equal(pressedIn.settleOk(sent), null, 'a box that is gone shows nothing')
    assert.equal(tab.slot(sent.requestKey, 'prospect:a'), null, 'saved as it was left: forgotten')
    assert.equal(tab.box.text, 'Words about prospect b', 'and the box on screen is none of its business')

    tab.mount('prospect:a')
    tab.type('Called Elena')
    const pressedAgain = tab.draft
    const again = tab.press()
    tab.type('Called Elena, and then some')
    tab.mount('prospect:b')
    assert.equal(pressedAgain.settleOk(again), null)
    assert.equal(tab.box.text, 'Words about prospect b')
    assert.equal(tab.slot(again.requestKey, 'prospect:a')?.text, 'Called Elena, and then some', 'typed on before switching: kept')
    assert.equal(tab.mount('prospect:a').box.text, 'Called Elena, and then some', 'and offered back on return')
  }

  // Another tab typed on under the sent key while the save was out, and A
  // took the words up. They are B's, not A's: A clears as saved and leaves
  // them in B's slot, under the sent key, where B's own Save meets
  // `request_key_conflict` and the strip. Round 5 kept them in A too, under a
  // fresh key — the same words in two drafts, one filable without a question.
  {
    const origin = new Origin()
    const a = new BrowserTab(origin, org, user).mount()
    a.focused = true
    a.type('Called Elena')
    origin.deliver()
    const b = new BrowserTab(origin, org, user).mount()
    const sent = a.press()
    a.focused = false
    b.focused = true
    b.type('Called Elena. B kept going.')
    origin.deliver()
    assert.equal(a.draft.settleOk(sent)?.status, 'saved')
    origin.deliver()
    assert.deepEqual([a.box.text, a.box.requestKey], ['', null], 'nothing of B’s is kept as A’s own')
    assert.equal(a.own(), null)
    assert.deepEqual([b.box.text, b.box.requestKey], ['Called Elena. B kept going.', sent.requestKey])
    assert.equal(b.slot(sent.requestKey)?.text, 'Called Elena. B kept going.', 'B’s slot was never released')
    assert.equal(listDrafts(org, user, 'journal', origin.local).length, 1, 'one draft, not two')
  }
})

test('the invariant — a tab whose typed words another tab saves or empties keeps them', () => {
  const origin = new Origin()
  const org = randomUUID(), user = randomUUID()
  const a = new BrowserTab(origin, org, user).mount()
  a.focused = true
  a.type('Words typed in A')
  origin.deliver()
  const k1 = a.box.requestKey
  const b = new BrowserTab(origin, org, user).mount()
  assert.equal(b.box.text, 'Words typed in A', 'B mirrors them')

  // B empties its box: a deliberate deletion — in B. A typed them, and keeps
  // them, back in storage under their own key; B, having let that key go,
  // stays empty instead of being refilled with them.
  a.focused = false
  b.focused = true
  b.type('')
  origin.deliver()
  assert.equal(a.box.text, 'Words typed in A')
  assert.equal(a.box.requestKey, k1)
  assert.equal(a.slot(k1)?.text, 'Words typed in A', 'and they are back in storage')
  assert.equal(b.box.text, '', 'B stays empty')
  assert.equal(b.box.requestKey, null)

  // A mirror that nobody typed in follows its owner out.
  const c = new BrowserTab(origin, org, user).mount()
  assert.equal(c.box.requestKey, a.box.requestKey)
  c.focused = false
  a.focused = true
  const sent = a.press()
  a.draft.settleOk(sent)
  origin.deliver()
  assert.equal(a.box.text, '')
  assert.equal(c.box.text, '', 'a mirror of a draft its owner saved empties with it')
})

test('a saved or emptied mirror stays gone: the typing tab keeps its key, the other tab stays empty', () => {
  const org = randomUUID(), user = randomUUID()

  // B saves its mirror of A's words. Round 3 forked A to a key the server had
  // never seen, and B — empty — adopted that key and showed the words again:
  // every later Save in either tab filed an identical entry.
  {
    const origin = new Origin()
    const a = new BrowserTab(origin, org, user).mount()
    a.focused = true
    a.type('Call Erik')
    origin.deliver()
    const k1 = a.box.requestKey
    const b = new BrowserTab(origin, org, user).mount()
    a.focused = false
    b.focused = true
    const sent = b.press()
    assert.equal(sent.requestKey, k1)
    assert.equal(b.draft.settleOk(sent)?.status, 'saved')
    origin.deliver()
    assert.deepEqual([b.box.text, b.box.requestKey], ['', null], 'B clears, says Saved, and stays clear')
    assert.deepEqual([a.box.text, a.box.requestKey], ['Call Erik', k1], 'A keeps its words, under the key the entry was filed with')
    assert.equal(a.slot(k1)?.text, 'Call Erik')

    // A's next Save sends that same key: the service replays the filed entry.
    b.focused = false
    a.focused = true
    const again = a.press()
    assert.equal(again.requestKey, k1, 'a key the server has seen — replayed, never filed twice')
    assert.equal(a.draft.settleOk(again)?.status, 'saved')
    origin.deliver()
    assert.equal(a.box.text, '')
    assert.equal(b.box.text, '', 'and B is still empty')
    assert.equal(listDrafts(org, user, 'journal', origin.local).length, 0, 'nothing left to offer anybody')
  }

  // B empties its mirror of A's words: B stays empty, however A carries on.
  {
    const origin = new Origin()
    const a = new BrowserTab(origin, org, user).mount()
    a.focused = true
    a.type('Call Erik')
    origin.deliver()
    const k1 = a.box.requestKey
    const b = new BrowserTab(origin, org, user).mount()
    a.focused = false
    b.focused = true
    b.type('')
    origin.deliver()
    assert.deepEqual([a.box.text, a.box.requestKey], ['Call Erik', k1], 'A keeps its words and its key')
    assert.equal(a.slot(k1)?.text, 'Call Erik')
    assert.equal(b.box.text, '', 'B is not refilled')
    b.focused = false
    a.focused = true
    a.type('Call Erik tomorrow')
    origin.deliver()
    assert.equal(b.box.text, '', 'not even as A types on under that key')
  }
})

test('a full stop or a space typed after Save does not leave the saved sentence in storage', () => {
  for (const tail of ['.', '. ', ',', ' .']) {
    const tab = new BrowserTab(new Origin(), randomUUID(), randomUUID()).mount()
    tab.type('Called Elena')
    const sent = tab.press()
    tab.type(`Called Elena${tail}`)
    assert.equal(tab.draft.settleOk(sent)?.status, 'saved', `tail ${JSON.stringify(tail)} belongs to the saved sentence`)
    assert.equal(tab.box.text, '')
    assert.equal(tab.slot(sent.requestKey), null, `tail ${JSON.stringify(tail)}: the box's slot goes with it`)
    assert.equal(tab.own(), null)
    assert.equal(tab.mount().box.text, '', 'a reload brings nothing back')
  }
})

test('a fork during this tab’s own save settles as the draft that was sent', () => {
  const org = randomUUID(), user = randomUUID()
  const setUp = () => {
    const origin = new Origin()
    const a = new BrowserTab(origin, org, user).mount()
    a.focused = true
    a.type('Called Elena')
    origin.deliver()
    const k1 = a.box.requestKey
    const b = new BrowserTab(origin, org, user).mount()
    const sent = a.press()
    // While A's save is out, B writes different words under the same key.
    a.focused = false
    b.focused = true
    b.type('Called Erik instead')
    origin.deliver()
    assert.equal(a.box.text, 'Called Elena')
    assert.notEqual(a.box.requestKey, k1, 'A forked')
    return { origin, a, b, k1, k2: a.box.requestKey, sent }
  }

  // Unchanged: the forked words ARE the sent words. Saved and cleared — not
  // "kept newer" with a copy left for the next Save to file twice.
  {
    const { origin, a, b, k1, k2, sent } = setUp()
    assert.equal(a.draft.settleOk(sent)?.status, 'saved')
    origin.deliver()
    assert.equal(a.box.text, '')
    assert.equal(a.slot(k2), null, 'the fork’s slot goes with them')
    assert.equal(a.own(), null)
    assert.equal(b.slot(k1)?.text, 'Called Erik instead', 'B’s words under the old key are B’s, and stay')
    assert.equal(b.box.text, 'Called Erik instead')
  }

  // Typed on after the fork: the sent sentence leaves, the rest moves on from
  // the fork's slot to a key of its own.
  {
    const { origin, a, k2, sent } = setUp()
    a.focused = true
    a.type('Called Elena. Budget locked in.')
    assert.equal(a.draft.settleOk(sent)?.status, 'savedKeptNewer')
    origin.deliver()
    assert.equal(a.box.text, 'Budget locked in.')
    assert.equal(a.slot(k2), null)
    assert.equal(a.slot(a.box.requestKey)?.text, 'Budget locked in.')
  }
})

test('a box that takes up words continuing its own still counts them as typed here', () => {
  const origin = new Origin()
  const org = randomUUID(), user = randomUUID()
  const a = new BrowserTab(origin, org, user).mount()
  a.focused = true
  a.type('X')
  origin.deliver()
  const k1 = a.box.requestKey
  const b = new BrowserTab(origin, org, user).mount()
  a.focused = false
  b.focused = true
  b.type('X Y')
  origin.deliver()
  assert.deepEqual([a.box.text, a.box.typedHere], ['X Y', true], 'the "X" typed in A is still in its box')
  assert.equal(a.box.typedText, 'X', 'what A answers for is what A typed')

  // B now empties its box. A's "X" is inside "X Y": A writes it all back
  // rather than emptying — the words it typed are not B's to delete.
  b.type('')
  origin.deliver()
  assert.equal(a.box.text, 'X Y')
  assert.equal(a.slot(k1)?.text, 'X Y')
  assert.equal(b.box.text, '')
  assert.equal(a.box.typedText, 'X Y', 'written back, the whole box is A’s to answer for')
})

test('a draft moves to a new key only once its new slot is written', () => {
  const org = randomUUID(), user = randomUUID()
  const draft = { text: 'x', requestKey: 'k', kind: 'update' as const, occurredOn: null }
  assert.equal(writeDraftSlot(org, user, 'journal', draft, new FakeStorage()), true)
  assert.equal(writeDraftSlot(org, user, 'journal', draft, hostileStorage), false, 'a refused write says so')

  // "Save as a new entry" while storage is full: the old slot is the only
  // stored copy of the words, and stays.
  {
    const origin = new Origin()
    const tab = new BrowserTab(origin, org, user).mount()
    tab.type('edited afterwards')
    const collided = tab.box.requestKey
    origin.full = true
    const sent = tab.press({ freshKey: true })
    origin.full = false
    assert.notEqual(sent.requestKey, collided)
    assert.equal(tab.slot(sent.requestKey), null, 'the new slot could not be written')
    assert.equal(tab.slot(collided)?.text, 'edited afterwards', 'so the old one was not released')
  }

  // Typed on after Save, and the remainder's new slot cannot be written: the
  // old slot, holding every word, stays.
  {
    const origin = new Origin()
    const tab = new BrowserTab(origin, org, user).mount()
    tab.type('Called Elena')
    const sent = tab.press()
    tab.type('Called Elena. More')
    origin.full = true
    assert.equal(tab.draft.settleOk(sent)?.status, 'savedKeptNewer')
    origin.full = false
    assert.equal(tab.box.text, 'More')
    assert.equal(tab.slot(tab.box.requestKey), null)
    assert.equal(tab.slot(sent.requestKey)?.text, 'Called Elena. More', 'nothing released while nothing replaced it')
  }
})

test('an answer reaching an unmounted draft box goes to the box on screen that holds the sent draft, or settles only its slots', () => {
  const org = randomUUID(), user = randomUUID()

  // The drawer went away and came back to the same prospect mid-save, and the
  // writer typed on. The box now on screen holds the sent draft: it settles
  // the answer — the sentence leaves, the rest stays under a key of its own,
  // "savedKeptNewer" — as 8082ed0 did, instead of leaving the words typed
  // after the return to meet the conflict strip.
  {
    const origin = new Origin()
    const tab = new BrowserTab(origin, org, user).mount('prospect:a')
    tab.type('Called Elena')
    const gone = tab.draft
    const sent = tab.press()
    assert.equal(gone.beginSave(), null, 'one save at a time')
    tab.type('Called Elena. More')
    tab.mount('prospect:b')
    tab.mount('prospect:a')
    assert.equal(tab.box.text, 'Called Elena. More', 'the new box finds the words')
    tab.type('Called Elena. More, still')

    assert.equal(gone.settleOk(sent), null, 'nothing for the gone box itself to show')
    assert.deepEqual(tab.heard, [{ saved: { view: { text: 'More, still', kind: 'update', occurredOn: '' }, status: 'savedKeptNewer' } }],
      'the box on screen announces it')
    assert.equal(tab.box.text, 'More, still')
    assert.notEqual(tab.box.requestKey, sent.requestKey)
    assert.equal(tab.slot(sent.requestKey), null, 'no copy of the saved sentence under its used key')
    assert.equal(tab.slot(tab.box.requestKey)?.text, 'More, still')
    assert.equal(tab.own(), tab.box.requestKey)
  }

  // The box on screen holds another draft (emptied and begun again): nothing
  // is handed over, and the owner key stays the live box's.
  {
    const origin = new Origin()
    const tab = new BrowserTab(origin, org, user).mount()
    tab.type('Called Elena')
    const gone = tab.draft
    const sent = tab.press()
    tab.mount()
    tab.type('')
    tab.type('Something else')
    const own = tab.own()
    assert.equal(gone.settleOk(sent), null)
    assert.deepEqual(tab.heard, [])
    assert.equal(tab.box.text, 'Something else')
    assert.equal(tab.own(), own)
    assert.equal(listDrafts(org, user, 'journal', origin.local).length, 1, 'no slot written by the gone box')
  }

  // Saved as it was left: the gone box still releases the sent slot, and
  // forgets this tab's copy of the draft — it is exactly the acknowledged
  // words, and a return must not restore them.
  {
    const tab = new BrowserTab(new Origin(), org, user).mount()
    tab.type('Saved as it was left')
    const gone = tab.draft
    const sent = tab.press()
    gone.unmount()
    assert.equal(gone.settleOk(sent), null)
    assert.equal(tab.slot(sent.requestKey), null)
    assert.equal(tab.own(), null)
    assert.equal(gone.settleRefused(sent, { error: 'boom', existing: null }), false, 'a refusal is not said over a box that is gone either')
    assert.equal(tab.mount().box.text, '', 'and the return shows nothing')
  }
})

test('a backspace in the other tab never forks the words typed here', () => {
  const origin = new Origin()
  const org = randomUUID(), user = randomUUID()
  const a = new BrowserTab(origin, org, user).mount()
  a.focused = true
  a.type('Call')
  origin.deliver()
  const k1 = a.box.requestKey
  const b = new BrowserTab(origin, org, user).mount()
  a.focused = false
  b.focused = true
  for (const text of ['Call E', 'Call Er', 'Call Eri', 'Call Erik', 'Call Eri', 'Call Erik']) {
    b.type(text)
    origin.deliver()
    assert.deepEqual([a.box.text, a.box.requestKey], [text, k1], `A follows "${text}" on the same key`)
  }
  assert.equal(listDrafts(org, user, 'journal', origin.local).length, 1, 'one draft, never forked')
})

test('a fork keeps its link to the key its words left: a Save replays, files once, or meets the strip', () => {
  const org = randomUUID(), user = randomUUID()
  // A types "Call"; B takes it on to "Call Erik", then rewrites it as "Meet
  // Erik", which does not carry A's words on: A forks "Call Erik" to K2.
  const setUp = () => {
    const origin = new Origin()
    const service = new Service()
    const a = new BrowserTab(origin, org, user).mount()
    a.focused = true
    a.type('Call')
    origin.deliver()
    const k1 = a.box.requestKey!
    const b = new BrowserTab(origin, org, user).mount()
    a.focused = false
    b.focused = true
    b.type('Call Erik')
    origin.deliver()
    b.type('Meet Erik')
    origin.deliver()
    assert.equal(a.box.text, 'Call Erik')
    assert.notEqual(a.box.requestKey, k1, 'A forked')
    return { origin, service, a, b, k1, k2: a.box.requestKey! }
  }

  // B goes back to "Call Erik" and files it under K1. A's Save of the same
  // words sends K1, not K2: the entry is replayed, and there is one.
  {
    const { origin, service, a, b, k1, k2 } = setUp()
    b.type('Call Erik')
    origin.deliver()
    assert.equal(service.save(b), 'filed')
    origin.deliver()
    assert.equal(service.save(a), 'replayed', 'sent under the key the words left')
    assert.equal(service.entries.size, 1, 'one entry, not two')
    assert.equal(a.box.text, '')
    assert.equal(a.slot(k2), null, 'the fork slot goes with the words')
    assert.equal(a.slot(k1), null)
  }

  // B files different words under K1: A's Save meets the conflict strip, and
  // "save as a new entry" then files A's words — deliberately — once.
  {
    const { origin, service, a, b } = setUp()
    assert.equal(service.save(b), 'filed')
    origin.deliver()
    assert.equal(service.save(a), 'request_key_conflict', 'never a silent second entry')
    assert.equal(a.box.text, 'Call Erik', 'the words stay for the strip')
    assert.equal(service.save(a, { freshKey: true }), 'filed')
    assert.deepEqual([...service.entries.values()].sort(), ['Call Erik', 'Meet Erik'])
  }

  // Nobody filed K1 yet: A files its words under it, and B's different words
  // under K1 then meet B's strip.
  {
    const { service, a, b, k1 } = setUp()
    assert.equal(service.save(a), 'filed')
    assert.equal(service.entries.get(k1), 'Call Erik')
    assert.equal(service.save(b), 'request_key_conflict')
    assert.equal(service.entries.size, 1)
  }
})

test('a box unmounted after a fork in flight releases the fork slot holding the saved words', () => {
  const origin = new Origin()
  const org = randomUUID(), user = randomUUID()
  const a = new BrowserTab(origin, org, user).mount('prospect:a')
  a.focused = true
  a.type('Called Elena')
  origin.deliver()
  const k1 = a.box.requestKey
  const b = new BrowserTab(origin, org, user).mount('prospect:a')
  const pressedIn = a.draft
  const sent = a.press()
  a.focused = false
  b.focused = true
  b.type('Called Erik instead')
  origin.deliver()
  const k2 = a.box.requestKey
  assert.notEqual(k2, k1, 'A forked while its save was out')

  a.mount('prospect:b')
  assert.equal(pressedIn.settleOk(sent), null)
  assert.equal(a.slot(k2, 'prospect:a'), null, 'the saved words are not left under a key the server never saw')
  assert.equal(a.own('prospect:a'), null, 'nor is that key left as this tab’s own')
  assert.equal(b.slot(k1, 'prospect:a')?.text, 'Called Erik instead', 'B’s words stay')
})

test('a Retry after a lost answer and a fork goes back to the key the words may be filed under', () => {
  const origin = new Origin()
  const service = new Service()
  const org = randomUUID(), user = randomUUID()
  const a = new BrowserTab(origin, org, user).mount()
  a.focused = true
  a.type('Call Erik')
  origin.deliver()
  const k1 = a.box.requestKey
  const b = new BrowserTab(origin, org, user).mount()

  // The write lands; the answer is lost.
  const start = a.draft.beginSave()
  assert.ok(start)
  assert.equal(service.answer(start.sent), 'filed')
  assert.equal(a.draft.settleRefused(start.sent, { error: 'Failed to fetch', existing: null }), true)

  // B writes other words under the key: A forks.
  a.focused = false
  b.focused = true
  b.type('Meet Erik')
  origin.deliver()
  assert.notEqual(a.box.requestKey, k1)

  // Retry: sent under K1 again, and replayed — one entry.
  a.focused = true
  b.focused = false
  assert.equal(service.save(a), 'replayed')
  assert.equal(service.entries.size, 1)
  assert.equal(a.box.text, '')

  // The other order: forked first, then a Save under the fork's old key whose
  // answer is lost. The refusal keeps the fork record, so the Retry goes back
  // to that key too.
  {
    const origin2 = new Origin()
    const service2 = new Service()
    const c = new BrowserTab(origin2, org, user).mount()
    c.focused = true
    c.type('Call Erik')
    origin2.deliver()
    const d = new BrowserTab(origin2, org, user).mount()
    c.focused = false
    d.focused = true
    d.type('Meet Erik')
    origin2.deliver()
    const lost = c.draft.beginSave()
    assert.ok(lost)
    assert.equal(service2.answer(lost.sent), 'filed')
    assert.equal(c.draft.settleRefused(lost.sent, { error: 'Failed to fetch', existing: null }), true)
    assert.equal(service2.save(c), 'replayed', 'the Retry is the same entry')
    assert.equal(service2.entries.size, 1)
  }
})

test('a reload keeps the words typed here as typed: another tab emptying them restores rather than empties', () => {
  const origin = new Origin()
  const org = randomUUID(), user = randomUUID()
  let a = new BrowserTab(origin, org, user).mount()
  a.focused = true
  a.type('Words typed in A')
  origin.deliver()
  const k1 = a.box.requestKey
  a = a.reload()
  assert.deepEqual([a.box.text, a.box.requestKey, a.box.typedHere], ['Words typed in A', k1, true])

  const b = new BrowserTab(origin, org, user).mount()
  assert.equal(b.box.typedHere, false, 'a new tab is a mirror')
  a.focused = false
  b.focused = true
  b.type('')
  origin.deliver()
  assert.equal(a.box.text, 'Words typed in A')
  assert.equal(a.slot(k1)?.text, 'Words typed in A', 'written back')
  assert.equal(b.box.text, '', 'and the tab that emptied them stays empty')
})

test('the fork origin travels with the words: a reload, or another tab mirroring the fork slot, saves under it', () => {
  const org = randomUUID(), user = randomUUID()
  // A types "Call"; B takes it on to "Call Erik", then rewrites it as "Meet
  // Erik": A forks "Call Erik" to K2, and K2's slot names K1 as its origin.
  const setUp = () => {
    const origin = new Origin()
    const service = new Service()
    const a = new BrowserTab(origin, org, user).mount()
    a.focused = true
    a.type('Call')
    origin.deliver()
    const k1 = a.box.requestKey!
    const b = new BrowserTab(origin, org, user).mount()
    a.focused = false
    b.focused = true
    b.type('Call Erik')
    origin.deliver()
    b.type('Meet Erik')
    origin.deliver()
    const k2 = a.box.requestKey!
    assert.notEqual(k2, k1)
    assert.equal(a.slot(k2)?.forkedFrom, k1, 'the fork slot carries its origin')
    return { origin, service, a, b, k1, k2 }
  }

  // A reloads, then B files "Call Erik" under K1: A's Save replays it.
  {
    const { origin, service, a: before, b } = setUp()
    const a = before.reload()
    assert.equal(a.box.text, 'Call Erik')
    b.type('Call Erik')
    origin.deliver()
    assert.equal(service.save(b), 'filed')
    origin.deliver()
    assert.equal(service.save(a), 'replayed', 'the reloaded tab sends the origin, not K2')
    assert.equal(service.entries.size, 1)
  }

  // A new tab C mirrors the fork slot and saves it: under the origin, K1.
  // A, whose slot that removed, writes its words back — and its own Save is
  // then the same entry, replayed.
  {
    const { origin, service, a, b, k1, k2 } = setUp()
    const c = new BrowserTab(origin, org, user).mount()
    assert.deepEqual([c.box.text, c.box.requestKey], ['Call Erik', k2], 'C mirrors the newest slot, the fork')
    a.focused = false
    b.focused = false
    c.focused = true
    assert.equal(service.save(c), 'filed')
    assert.equal(service.entries.get(k1), 'Call Erik', 'filed under the origin')
    origin.deliver()
    assert.equal(a.slot(k2)?.text, 'Call Erik', 'A restored its words')
    assert.equal(service.save(a), 'replayed')
    assert.equal(service.entries.size, 1, 'one entry')
    assert.equal(service.save(b), 'request_key_conflict', 'and B’s different words under K1 meet B’s strip')
  }

  // C is open BEFORE the fork, and empty: it mirrored K1 and let it go. It
  // can learn the fork's origin only from storage events — the fork's write,
  // then A's keystroke — never from a mount.
  {
    const origin = new Origin()
    const a = new BrowserTab(origin, org, user).mount()
    a.focused = true
    a.type('Call')
    origin.deliver()
    const k1 = a.box.requestKey
    const c = new BrowserTab(origin, org, user).mount()
    a.focused = false
    c.focused = true
    c.type('')
    origin.deliver()
    const b = new BrowserTab(origin, org, user).mount()
    c.focused = false
    b.focused = true
    b.type('Call Erik')
    origin.deliver()
    assert.equal(c.box.text, '', 'C stays empty: it let K1 go')
    b.type('Meet Erik')
    origin.deliver()
    const k2 = a.box.requestKey
    assert.notEqual(k2, k1, 'A forked')
    b.focused = false
    a.focused = true
    a.type('Call Erik!')
    origin.deliver()
    assert.deepEqual([c.box.text, c.box.requestKey], ['Call Erik!', k2], 'C took up the fork slot through the events')
    assert.equal(c.draft.beginSave()?.key, k1, 'and saves under the origin')
  }
})

test('every Save of forked words goes to the origin: edited after a lost answer, it meets the strip', () => {
  const origin = new Origin()
  const service = new Service()
  const org = randomUUID(), user = randomUUID()
  const a = new BrowserTab(origin, org, user).mount()
  a.focused = true
  a.type('Call Erik')
  origin.deliver()
  const k1 = a.box.requestKey
  const b = new BrowserTab(origin, org, user).mount()

  const lost = a.draft.beginSave()
  assert.ok(lost)
  assert.equal(service.answer(lost.sent), 'filed')
  a.draft.settleRefused(lost.sent, { error: 'Failed to fetch', existing: null })

  a.focused = false
  b.focused = true
  b.type('Meet Erik')
  origin.deliver()
  assert.notEqual(a.box.requestKey, k1, 'A forked')

  // A adds a full stop. Sent under the fork's own key, that was a second,
  // silent filing of "Call Erik."; sent under the origin, it is a question.
  b.focused = false
  a.focused = true
  a.type('Call Erik.')
  assert.equal(service.save(a), 'request_key_conflict')
  assert.equal(service.entries.size, 1)
  assert.equal(a.box.text, 'Call Erik.', 'the words stay for the strip')
})

test('a fork in flight, then the drawer away and back: the box on screen holding the fork hears Saved', () => {
  const origin = new Origin()
  const org = randomUUID(), user = randomUUID()
  const a = new BrowserTab(origin, org, user).mount('prospect:a')
  a.focused = true
  a.type('Called Elena')
  origin.deliver()
  const b = new BrowserTab(origin, org, user).mount('prospect:a')
  const pressedIn = a.draft
  const sent = a.press()
  a.focused = false
  b.focused = true
  b.type('Called Erik instead')
  origin.deliver()
  const k2 = a.box.requestKey
  assert.notEqual(k2, sent.requestKey, 'A forked while its save was out')

  a.mount('prospect:b')
  a.mount('prospect:a')
  assert.deepEqual([a.box.text, a.box.requestKey], ['Called Elena', k2], 'the returned box holds the fork')
  assert.equal(pressedIn.settleOk(sent), null)
  assert.deepEqual(a.heard, [{ saved: { view: { text: '', kind: 'update', occurredOn: '' }, status: 'saved' } }])
  assert.equal(a.box.text, '', 'and holds nothing')
  assert.equal(a.slot(k2, 'prospect:a'), null)
  assert.equal(b.slot(sent.requestKey, 'prospect:a')?.text, 'Called Erik instead')
})

test('a Save sent through the fork origin, a second fork mid-flight, then the answer: Saved, and an empty box', () => {
  const origin = new Origin()
  const service = new Service()
  const org = randomUUID(), user = randomUUID()
  const a = new BrowserTab(origin, org, user).mount()
  a.focused = true
  a.type('Call')
  origin.deliver()
  const k1 = a.box.requestKey
  const b = new BrowserTab(origin, org, user).mount()
  a.focused = false
  b.focused = true
  b.type('Call Erik')
  origin.deliver()
  b.type('Meet Erik')
  origin.deliver()
  const k2 = a.box.requestKey
  const c = new BrowserTab(origin, org, user).mount()
  assert.equal(c.box.requestKey, k2, 'C mirrors the fork slot')

  const start = a.draft.beginSave()
  assert.ok(start)
  assert.equal(start.key, k1, 'sent through the fork origin')

  // C rewrites the fork slot while that save is out: A forks again.
  b.focused = false
  c.focused = true
  c.type('Something else')
  origin.deliver()
  const k3 = a.box.requestKey
  assert.ok(k3 !== k1 && k3 !== k2)
  assert.equal(a.slot(k3)?.forkedFrom, k1, 'a second fork keeps the FIRST origin')

  assert.equal(service.answer(start.sent), 'filed')
  assert.deepEqual(a.draft.settleOk(start.sent), { view: { text: '', kind: 'update', occurredOn: '' }, status: 'saved' })
  assert.equal(a.slot(k3), null)
})

test('a refusal after the drawer went away and back reaches the box on screen: the error with Retry, or the strip', () => {
  const org = randomUUID(), user = randomUUID()
  const awayAndBack = () => {
    const tab = new BrowserTab(new Origin(), org, user).mount('prospect:a')
    tab.type('Called Elena')
    const pressedIn = tab.draft
    const sent = tab.press()
    tab.mount('prospect:b')
    tab.mount('prospect:a')
    return { tab, pressedIn, sent }
  }

  // An error: heard by the box on screen, which can Retry — same key.
  {
    const { tab, pressedIn, sent } = awayAndBack()
    assert.equal(pressedIn.settleRefused(sent, { error: 'Failed to fetch', existing: null }), false)
    assert.deepEqual(tab.heard, [{ refused: { error: 'Failed to fetch', existing: null } }])
    const retry = tab.draft.beginSave()
    assert.equal(retry?.key, sent.requestKey, 'Retry sends the same key: a save that did land comes back as itself')
  }

  // A conflict: the strip, with the entry the key already produced.
  {
    const { tab, pressedIn, sent } = awayAndBack()
    const existing = entryFor(randomUUID(), 'Called Elena, first version')
    pressedIn.settleRefused(sent, { error: 'request_key_conflict', existing })
    assert.deepEqual(tab.heard, [{ refused: { error: 'request_key_conflict', existing } }])
  }

  // Still away: nothing is said over another prospect's box.
  {
    const tab = new BrowserTab(new Origin(), org, user).mount('prospect:a')
    tab.type('Called Elena')
    const pressedIn = tab.draft
    const sent = tab.press()
    tab.mount('prospect:b')
    pressedIn.settleRefused(sent, { error: 'Failed to fetch', existing: null })
    assert.deepEqual(tab.heard, [])
  }

  // Back, but the box now mirrors another tab's words (this tab saved a
  // mirror of them, and that tab rewrote them): the refusal is not said over
  // them either.
  {
    const origin = new Origin()
    const other = new BrowserTab(origin, org, user).mount('prospect:a')
    other.focused = true
    other.type('Called Elena')
    origin.deliver()
    const tab = new BrowserTab(origin, org, user).mount('prospect:a')
    const pressedIn = tab.draft
    const sent = tab.press()
    tab.mount('prospect:b')
    other.type('Meeting with Bob')
    origin.deliver()
    tab.mount('prospect:a')
    assert.equal(tab.box.text, 'Meeting with Bob')
    assert.equal(pressedIn.settleRefused(sent, { error: 'Failed to fetch', existing: null }), false)
    assert.deepEqual(tab.heard, [], 'no error line over words this save never sent')
  }
})

test('an answer is not handed to a returned box whose slot another tab rewrote while it was away', () => {
  // A saves a MIRROR of B's words, so what A returns to is B's slot, as a
  // mirror — a box that typed its own words would fork them back instead.
  const origin = new Origin()
  const org = randomUUID(), user = randomUUID()
  const b = new BrowserTab(origin, org, user).mount('prospect:a')
  b.focused = true
  b.type('Called Elena')
  origin.deliver()
  const k1 = b.box.requestKey
  const a = new BrowserTab(origin, org, user).mount('prospect:a')
  const pressedIn = a.draft
  const sent = a.press()
  assert.equal(sent.requestKey, k1)
  a.mount('prospect:b')
  b.type('Meeting with Bob')
  origin.deliver()

  a.mount('prospect:a')
  assert.deepEqual([a.box.text, a.box.requestKey], ['Meeting with Bob', k1])
  assert.equal(a.box.typedHere, false, 'B’s words, not A’s: a mirror')
  assert.equal(pressedIn.settleOk(sent), null)
  assert.deepEqual(a.heard, [], 'not taken for this tab’s own edit of the sent draft')
  assert.deepEqual([a.box.text, a.box.requestKey], ['Meeting with Bob', k1], 'the box on screen is untouched')
  assert.equal(b.slot(k1, 'prospect:a')?.text, 'Meeting with Bob', 'B’s words stay under their key')
  assert.equal(listDrafts(org, user, 'prospect:a', origin.local).length, 1, 'one slot, not two')
})

test('the owner record keeps the typed words: a slot that no longer carries them loads as a mirror', () => {
  const org = randomUUID(), user = randomUUID()
  const local = new FakeStorage(), session = new FakeStorage()
  const load = () => {
    const box = new DraftBox({ organizationId: org, userId: user, surface: 'journal', storage: local, session })
    box.mount()
    return box.box
  }
  rememberOwnDraft(org, user, 'journal', 'k1', session, 'Called Elena')
  assert.deepEqual(ownDraft(org, user, 'journal', session), { requestKey: 'k1', typedText: 'Called Elena', snapshot: null })

  writeDraftSlot(org, user, 'journal', { text: 'Meeting with Bob', requestKey: 'k1', kind: 'update', occurredOn: null }, local)
  assert.deepEqual([load().typedHere, load().typedText], [false, ''], 'other words under the key: a mirror')

  writeDraftSlot(org, user, 'journal', { text: 'Called Elena, and more', requestKey: 'k1', kind: 'update', occurredOn: null }, local)
  rememberOwnDraft(org, user, 'journal', 'k1', session, 'Called Elena')
  assert.deepEqual([load().typedHere, load().typedText], [true, 'Called Elena'], 'words carrying them on: still typed here')

  session.setItem(`khyte:journal-draft-owner:${org}:${user}:journal`, 'k1')
  assert.deepEqual(ownDraft(org, user, 'journal', session), { requestKey: 'k1', typedText: '', snapshot: null }, 'a bare key from an earlier build')
  assert.equal(load().typedHere, false)
})

/** A types "Call"; B takes it on to "Call Erik", then rewrites it as "Meet
 *  Erik": A forks "Call Erik" from K1 to K2. */
const forked = (
  org: string,
  user: string,
  shape: { kind: JournalKind; occurredOn: string } = { kind: 'update', occurredOn: '' }
) => {
  const origin = new Origin()
  const service = new Service()
  const a = new BrowserTab(origin, org, user).mount()
  a.focused = true
  a.draft.change({ text: 'Call', ...shape })
  origin.deliver()
  const k1 = a.box.requestKey!
  const b = new BrowserTab(origin, org, user).mount()
  a.focused = false
  b.focused = true
  b.type('Call Erik')
  origin.deliver()
  b.type('Meet Erik')
  origin.deliver()
  b.focused = false
  a.focused = true
  return { origin, service, a, b, k1, k2: a.box.requestKey! }
}

test('the fork origin is dropped when its words are filed, emptied, moved on, or saved as new', () => {
  const org = randomUUID(), user = randomUUID()

  // Filed: the next sentence goes under its own key.
  {
    const { service, a, k1 } = forked(org, user)
    assert.equal(service.save(a), 'filed')
    a.type('A new sentence')
    assert.equal(a.draft.beginSave()?.key, a.box.requestKey)
    assert.notEqual(a.box.requestKey, k1)
  }
  // Emptied: likewise.
  {
    const { a, k1 } = forked(org, user)
    a.type('')
    a.type('A new sentence')
    const key = a.draft.beginSave()?.key
    assert.equal(key, a.box.requestKey)
    assert.notEqual(key, k1)
  }
  // Moved on: the remainder of an origin save goes under its own key.
  {
    const { service, a, k1 } = forked(org, user)
    const start = a.draft.beginSave()
    assert.equal(start?.key, k1)
    a.type('Call Erik. More')
    assert.equal(service.answer(start!.sent), 'filed')
    assert.equal(a.draft.settleOk(start!.sent)?.status, 'savedKeptNewer')
    assert.equal(a.box.text, 'More')
    assert.equal(a.draft.beginSave()?.key, a.box.requestKey)
  }
  // Saved as new, answer lost: the Retry sends the new entry's key, and replays.
  {
    const { service, a, b, k2 } = forked(org, user)
    assert.equal(service.save(b), 'filed')
    assert.equal(service.save(a), 'request_key_conflict')
    const lost = a.draft.beginSave({ freshKey: true })
    assert.equal(lost?.key, k2)
    assert.equal(service.answer(lost!.sent), 'filed')
    a.draft.settleRefused(lost!.sent, { error: 'Failed to fetch', existing: null })
    const retry = a.draft.beginSave()
    assert.equal(retry?.key, k2, 'not the origin again')
    assert.equal(service.answer(retry!.sent), 'replayed')
  }
})

test('"save as a new entry" on forked words shared by two tabs files them once', () => {
  const org = randomUUID(), user = randomUUID()
  const { origin, service, a, b, k2 } = forked(org, user)
  // C takes up the fork slot and types into it too: both hold "Call Erik",
  // typed, with the origin K1.
  const c = new BrowserTab(origin, org, user).mount()
  a.focused = false
  c.focused = true
  c.type('Call Erik ')
  origin.deliver()
  c.type('Call Erik')
  origin.deliver()
  assert.deepEqual([a.box.text, a.box.requestKey, c.box.requestKey], ['Call Erik', k2, k2])

  assert.equal(service.save(b), 'filed', 'B files "Meet Erik" under the origin')
  assert.equal(service.save(c), 'request_key_conflict')
  assert.equal(service.save(c, { freshKey: true }), 'filed', 'C files "Call Erik" — under the shared fork key')
  origin.deliver()
  assert.equal(a.box.text, 'Call Erik', 'A still holds its typed words')

  c.focused = false
  a.focused = true
  assert.equal(service.save(a), 'request_key_conflict')
  assert.equal(service.save(a, { freshKey: true }), 'replayed', 'A’s "save as new" is C’s entry, replayed')
  assert.deepEqual([...service.entries.values()].sort(), ['Call Erik', 'Meet Erik'], 'once each')
})

/* ———— R4-1: a draft parked while the drawer shows another prospect ———— */

test('reconcileOnMount — what the live listener would have done, applied when the composer mounts again', () => {
  const copy = { text: 'Call Erik tomorrow', kind: 'decision' as const, occurredOn: '2026-09-25' }
  const typed: OwnDraft = { requestKey: 'k1', typedText: 'Call Erik tomorrow', snapshot: copy }
  const slot = (text: string, over: Partial<StoredDraft> = {}): StoredDraft =>
    ({ text, kind: 'decision', occurredOn: '2026-09-25', requestKey: 'k1', ...over })
  const show = (typedHere: boolean) => ({ do: 'show', typedHere })

  assert.deepEqual(reconcileOnMount(null, null), { do: 'fallback' }, 'nothing remembered')
  // Typed words, with a copy.
  assert.deepEqual(reconcileOnMount(typed, slot('Call Erik tomorrow')), show(true), 'the same words')
  assert.deepEqual(reconcileOnMount({ ...typed, typedText: 'Something else typed' }, slot('Call Erik tomorrow')), show(true),
    'a slot saying exactly this tab’s copy is never forked, whatever the typed words')
  assert.deepEqual(reconcileOnMount(typed, slot('Call Erik tomorrow  ')), show(true), 'the same, as an entry reads them')
  assert.deepEqual(reconcileOnMount({ ...typed, typedText: 'Call Erik' }, slot('Call Erik tomorrow, early')), show(true),
    'another tab carried the typed words on')
  assert.deepEqual(reconcileOnMount(typed, slot('Meet Anna instead')), { do: 'fork' }, 'other words')
  assert.deepEqual(reconcileOnMount(typed, slot('Call Erik tomorrow', { kind: 'update' })), { do: 'fork' }, 'another kind')
  assert.deepEqual(reconcileOnMount(typed, slot('Call Erik tomorrow', { occurredOn: null })), { do: 'fork' }, 'another date')
  assert.deepEqual(reconcileOnMount(typed, null), { do: 'restore' }, 'the slot is gone')
  // A mirror.
  const mirror: OwnDraft = { ...typed, typedText: '' }
  assert.deepEqual(reconcileOnMount(mirror, slot('Meet Anna instead')), show(false))
  assert.deepEqual(reconcileOnMount(mirror, null), { do: 'fallback' }, 'its owner let it go')
  // A record from an earlier build: as before.
  const earlier: OwnDraft = { requestKey: 'k1', typedText: 'Call Erik', snapshot: null }
  assert.deepEqual(reconcileOnMount(earlier, slot('Call Erik tomorrow')), show(true))
  assert.deepEqual(reconcileOnMount(earlier, slot('Meet Anna instead')), show(false))
  assert.deepEqual(reconcileOnMount(earlier, null), { do: 'fallback' }, 'no copy to restore')
})

/** A types a decision about Erik, dated; B mirrors it; A's drawer moves to
 *  another prospect, so nothing in A is live on Erik's slot. */
const parked = (org: string, user: string) => {
  const origin = new Origin()
  const service = new Service()
  const a = new BrowserTab(origin, org, user).mount('prospect:erik')
  a.focused = true
  a.draft.change({ text: 'Call Erik tomorrow', kind: 'decision', occurredOn: '2026-09-25' })
  origin.deliver()
  const k1 = a.box.requestKey!
  const b = new BrowserTab(origin, org, user).mount('prospect:erik')
  assert.equal(b.box.text, 'Call Erik tomorrow')
  a.mount('prospect:other')
  a.focused = false
  b.focused = true
  return { origin, service, a, b, k1 }
}

test('R4-1 (a, b) — a parked draft comes back whole: restored when emptied elsewhere, forked when rewritten', () => {
  const org = randomUUID(), user = randomUUID()
  const whole = { text: 'Call Erik tomorrow', kind: 'decision', occurredOn: '2026-09-25' }

  for (const reload of [false, true]) {
    // (a) B empties it.
    {
      const { origin, a: parkedA, b, k1 } = parked(org, user)
      b.type('')
      origin.deliver()
      assert.equal(b.slot(k1), null)
      const a = reload ? parkedA.reload('prospect:erik') : parkedA.mount('prospect:erik')
      origin.deliver()
      const { text, kind, occurredOn, requestKey, typedHere } = a.box
      assert.deepEqual({ text, kind, occurredOn, requestKey, typedHere }, { ...whole, requestKey: k1, typedHere: true },
        `restored whole — kind and date too${reload ? ', across a reload' : ''}`)
      assert.equal(a.slot(k1)?.text, 'Call Erik tomorrow', 'and back in storage under its key')
      assert.equal(b.box.text, '', 'B, having let it go, stays empty')
    }
    // (b) B rewrites it.
    {
      const { origin, service, a: parkedA, b, k1 } = parked(org, user)
      b.type('Meet Anna instead')
      origin.deliver()
      const a = reload ? parkedA.reload('prospect:erik') : parkedA.mount('prospect:erik')
      origin.deliver()
      const k2 = a.box.requestKey
      assert.notEqual(k2, k1, 'forked')
      assert.deepEqual([a.box.text, a.box.kind, a.box.occurredOn, a.box.typedHere], [whole.text, whole.kind, whole.occurredOn, true])
      assert.equal(a.slot(k2)?.forkedFrom, k1, 'its origin is the key it left')
      assert.equal(b.slot(k1)?.text, 'Meet Anna instead', 'B keeps its words: both versions recoverable')
      assert.equal(service.save(b), 'filed')
      a.focused = true
      b.focused = false
      assert.equal(service.save(a), 'request_key_conflict', 'A’s Save goes to the origin: the strip, not a silent second filing')
    }
  }
})

test('R4-1 (c) — a parked draft that was itself a fork comes back with its origin', () => {
  const org = randomUUID(), user = randomUUID()
  for (const rewrite of [false, true]) {
    // A forked "Call Erik" from K1 to K2; C mirrors K2; A's drawer moves away.
    const { origin, a, k1, k2 } = forked(org, user, { kind: 'decision', occurredOn: '2026-09-25' })
    const c = new BrowserTab(origin, org, user).mount()
    assert.equal(c.box.requestKey, k2)
    a.mount('prospect:other')
    a.focused = false
    c.focused = true
    c.type(rewrite ? 'Something else' : '')
    origin.deliver()
    a.mount()
    origin.deliver()
    assert.equal(a.box.text, 'Call Erik', rewrite ? 'forked again' : 'restored')
    assert.equal(a.box.requestKey === k2, !rewrite)
    assert.deepEqual([a.box.kind, a.box.occurredOn], ['decision', '2026-09-25'], 'with its kind and date')
    const slot = a.slot(a.box.requestKey)
    assert.deepEqual([slot?.kind, slot?.occurredOn], ['decision', '2026-09-25'], 'in the box and in storage')
    assert.equal(slot?.forkedFrom, k1, 'the first origin survives')
    a.focused = true
    c.focused = false
    assert.equal(a.draft.beginSave()?.key, k1, 'and its Save goes there')
  }
})

test('R4-1 (d, e) — an acknowledged save or a local discard stays settled; a lost acknowledgement replays', () => {
  const org = randomUUID(), user = randomUUID()

  // A saves; the answer is acknowledged while the drawer is away.
  {
    const { origin, service, a: parkedA, k1 } = parked(org, user)
    const a = parkedA.mount('prospect:erik')
    assert.equal(a.box.typedHere, true)
    a.focused = true
    const pressedIn = a.draft
    const start = a.draft.beginSave()!
    a.mount('prospect:other')
    assert.equal(service.answer(start.sent), 'filed')
    assert.equal(pressedIn.settleOk(start.sent), null)
    origin.deliver()
    assert.equal(a.own('prospect:erik'), null, 'the copy of the acknowledged words is forgotten')
    assert.equal(a.mount('prospect:erik').box.text, '', 'not brought back')
    assert.equal(a.slot(k1), null)
  }
  // A saves, types on, and the drawer moves away; the save is acknowledged,
  // then B empties the draft. The copy holds words beyond the saved ones: it
  // is kept, and they come back.
  {
    const { origin, service, a: parkedA, b } = parked(org, user)
    const a = parkedA.mount('prospect:erik')
    a.focused = true
    const pressedIn = a.draft
    const start = a.draft.beginSave()!
    a.draft.change({ text: 'Call Erik tomorrow, and Anna' })
    origin.deliver()
    a.mount('prospect:other')
    assert.equal(service.answer(start.sent), 'filed')
    assert.equal(pressedIn.settleOk(start.sent), null)
    a.focused = false
    b.focused = true
    b.type('')
    origin.deliver()
    a.mount('prospect:erik')
    assert.deepEqual([a.box.text, a.box.typedHere], ['Call Erik tomorrow, and Anna', true], 'the unsaved words are back')
    a.focused = true
    assert.equal(service.save(a), 'request_key_conflict', 'and meet the strip — never a silent second filing')
  }
  // A empties its box before the drawer moves away.
  {
    const { origin, a: parkedA, k1 } = parked(org, user)
    const a = parkedA.mount('prospect:erik')
    a.type('')
    a.mount('prospect:other')
    origin.deliver()
    assert.equal(a.mount('prospect:erik').box.text, '', 'a discard stays discarded')
    assert.equal(a.slot(k1), null)
  }
  // B saves the words A typed, while A is away: A's words come back, and
  // A's Save is that entry, replayed — one entry.
  {
    const { origin, service, a: parkedA, b } = parked(org, user)
    assert.equal(service.save(b), 'filed')
    origin.deliver()
    const a = parkedA.mount('prospect:erik')
    assert.equal(a.box.text, 'Call Erik tomorrow')
    a.focused = true
    b.focused = false
    assert.equal(service.save(a), 'replayed')
    assert.equal(service.entries.size, 1)
  }
  // (e) A's save lands but the answer is lost while A is away; B empties
  // the draft. A's words come back, and the Retry replays.
  {
    const { origin, service, a: parkedA, b } = parked(org, user)
    const a = parkedA.mount('prospect:erik')
    a.focused = true
    const pressedIn = a.draft
    const lost = a.draft.beginSave()!
    a.mount('prospect:other')
    assert.equal(service.answer(lost.sent), 'filed')
    pressedIn.settleRefused(lost.sent, { error: 'Failed to fetch', existing: null })
    a.focused = false
    b.focused = true
    b.type('')
    origin.deliver()
    a.mount('prospect:erik')
    assert.equal(a.box.text, 'Call Erik tomorrow', 'restored')
    a.focused = true
    assert.equal(service.save(a), 'replayed')
    assert.equal(service.entries.size, 1)
  }
})

test('R4-1 — an answer arriving after the return reaches the box that forked the sent words back', () => {
  const org = randomUUID(), user = randomUUID()
  for (const answer of ['ok', 'refused'] as const) {
    // A saves, the drawer moves away, B rewrites the slot, A comes back: A's
    // own words are forked back under K2, their origin the sent key K1.
    const { origin, a: parkedA, b, k1 } = parked(org, user)
    const a = parkedA.mount('prospect:erik')
    const pressedIn = a.draft
    const sent = a.press()
    a.mount('prospect:other')
    b.type('Meet Anna instead')
    origin.deliver()
    a.mount('prospect:erik')
    const k2 = a.box.requestKey
    assert.notEqual(k2, k1)

    if (answer === 'ok') {
      assert.equal(pressedIn.settleOk(sent), null)
      assert.deepEqual(a.heard.map(h => 'saved' in h && h.saved.status), ['saved'], 'the acknowledged words do not linger')
      assert.equal(a.box.text, '')
      assert.equal(a.slot(k2), null)
    } else {
      pressedIn.settleRefused(sent, { error: 'Failed to fetch', existing: null })
      assert.deepEqual(a.heard, [{ refused: { error: 'Failed to fetch', existing: null } }], 'the error line, with Retry')
      assert.equal(a.draft.beginSave()?.key, k1, 'and the Retry goes to the sent key')
    }
    assert.equal(b.slot(k1)?.text, 'Meet Anna instead', 'B’s words untouched')
  }
})

test('R4-1 (f) — owner records from earlier builds load as they did', () => {
  const org = randomUUID(), user = randomUUID()
  const local = new FakeStorage(), session = new FakeStorage()
  const ownerKey = `khyte:journal-draft-owner:${org}:${user}:journal`
  const load = () => {
    const box = new DraftBox({ organizationId: org, userId: user, surface: 'journal', storage: local, session })
    box.mount()
    return box.box
  }
  writeDraftSlot(org, user, 'journal', { text: 'Call Erik tomorrow', requestKey: 'k1', kind: 'update', occurredOn: null }, local)

  session.setItem(ownerKey, JSON.stringify({ requestKey: 'k1', typed: true }))
  assert.deepEqual(ownDraft(org, user, 'journal', session), { requestKey: 'k1', typedText: '', snapshot: null })
  assert.deepEqual([load().text, load().typedHere], ['Call Erik tomorrow', false], 'a flag without words: a mirror')

  session.setItem(ownerKey, JSON.stringify({ requestKey: 'k1', typedText: 'Call Erik' }))
  assert.deepEqual([load().text, load().typedHere], ['Call Erik tomorrow', true], 'typed words without a copy: as before')

  // Without a copy, a slot that is gone is not restored — there is nothing to
  // restore it from — and the record goes, as before.
  removeDraftSlot(org, user, 'journal', 'k1', local)
  session.setItem(ownerKey, JSON.stringify({ requestKey: 'k1', typedText: 'Call Erik' }))
  assert.equal(load().text, '')
  assert.equal(ownDraft(org, user, 'journal', session), null)
})

test('R4-1 notes — an acknowledgement reaching a parked box settles a mount fork, and a punctuation tail', () => {
  const org = randomUUID(), user = randomUUID()

  // Press, park, B rewrites, return (the mount forks the copy to K2, origin
  // K1), park again — then the answer: the fork holds exactly the saved words.
  {
    const { origin, a: parkedA, b, k1 } = parked(org, user)
    const a = parkedA.mount('prospect:erik')
    const pressedIn = a.draft
    const sent = a.press()
    a.mount('prospect:other')
    b.type('Meet Anna instead')
    origin.deliver()
    a.mount('prospect:erik')
    const k2 = a.box.requestKey
    assert.notEqual(k2, k1)
    a.mount('prospect:other')
    assert.equal(pressedIn.settleOk(sent), null)
    assert.equal(a.slot(k2, 'prospect:erik'), null, 'the fork slot of the saved words goes')
    assert.equal(a.mount('prospect:erik').box.text, 'Meet Anna instead', 'and the return is B’s draft, as a mirror')
    assert.equal(a.box.typedHere, false)
  }

  // Press, type a full stop, park, answer: the tail belongs to the saved sentence.
  {
    const { origin, a: parkedA, k1 } = parked(org, user)
    const a = parkedA.mount('prospect:erik')
    const pressedIn = a.draft
    const sent = a.press()
    a.type('Call Erik tomorrow.')
    origin.deliver()
    a.mount('prospect:other')
    assert.equal(pressedIn.settleOk(sent), null)
    origin.deliver()
    assert.equal(a.slot(k1, 'prospect:erik'), null)
    assert.equal(a.mount('prospect:erik').box.text, '', 'nothing comes back')
  }
})

test('R4-1 notes — sign-out and the sweep clear the tab’s own copies; an ended session keeps them', () => {
  const org = randomUUID(), user = randomUUID()
  const typeAndLeave = (local: FakeStorage, session: FakeStorage) => {
    const box = new DraftBox({ organizationId: org, userId: user, surface: 'journal', storage: local, session })
    box.mount()
    box.change({ text: 'Unsent words' })
    box.unmount()
  }
  const remount = (local: FakeStorage, session: FakeStorage, as = user) => {
    const box = new DraftBox({ organizationId: org, userId: as, surface: 'journal', storage: local, session })
    box.mount()
    return box.box.text
  }

  // Signed out: the slot and this tab's copy both go.
  {
    const local = new FakeStorage(), session = new FakeStorage()
    typeAndLeave(local, session)
    clearDraftsFor(org, user, local, session)
    assert.equal(ownDraft(org, user, 'journal', session), null)
    assert.equal(remount(local, session), '', 'signing back in on this tab restores nothing')
  }
  // Another identity mounts in this tab: its sweep takes the copy too.
  {
    const local = new FakeStorage(), session = new FakeStorage()
    typeAndLeave(local, session)
    remount(local, session, randomUUID())
    assert.equal(ownDraft(org, user, 'journal', session), null)
    assert.equal(remount(local, session), '')
  }
  // Through the store: an identity change clears; an ended session keeps —
  // even with the slot gone, the copy brings the words back.
  for (const reason of [undefined, 'unauthorized'] as const) {
    const local = new FakeStorage(), session = new FakeStorage()
    const store = createCRMStore(snapshotFor(workspaceFor(org, user)), { draftStorage: local, draftSession: session })
    typeAndLeave(local, session)
    store.getState().markIdentityChanged(reason)
    listDrafts(org, user, 'journal', local).forEach(d => removeDraftSlot(org, user, 'journal', d.requestKey, local))
    assert.equal(remount(local, session), reason ? 'Unsent words' : '')
  }
})

test('R4-1 notes — "save as a new entry" on a shared fork drops the origin from the tab’s copy too', () => {
  const org = randomUUID(), user = randomUUID()
  const { service, a, b, k2 } = forked(org, user)
  assert.equal(service.save(b), 'filed')
  assert.equal(service.save(a), 'request_key_conflict')
  const lost = a.draft.beginSave({ freshKey: true })
  assert.equal(lost?.key, k2)
  assert.equal(ownDraft(org, user, 'journal', a.session)?.snapshot?.forkedFrom, undefined, 'the copy carries no origin')
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
  writeDraftSlot(org, user, 'journal', draft, expired)
  const refused = await ended.getState().submitCapture({ requestKey: 'k1', text: 'unsent' }, { surface: 'journal' })
  assert.equal(refused.ok === false && refused.error, 'unauthorized')
  assert.equal(ended.getState().identityChanged, true, 'SnapshotSync reloads the page on this')
  assert.equal(readDraftSlot(org, user, 'journal', 'k1', expired)?.text, 'unsent', 'and the words are still in storage')
  assert.equal(readDraftSlot(org, user, 'journal', 'k1', expired)?.requestKey, 'k1',
    'with their key, so a save that did land comes back as itself after signing in')
  assert.equal(ended.getState().toasts.length, 0, 'and nothing is toasted over a page that is going')

  // The same answer reached from outside the store — a caller passing the
  // refusal along — keeps the draft too.
  const roster = new FakeStorage()
  const outside = createCRMStore(snapshotFor(workspaceFor(org, user)), { draftStorage: roster })
  writeDraftSlot(org, user, 'journal', draft, roster)
  outside.getState().markIdentityChanged('unauthorized')
  assert.equal(outside.getState().identityChanged, true)
  assert.equal(readDraftSlot(org, user, 'journal', 'k1', roster)?.text, 'unsent')

  // A different identity is already acting in this browser: cleared, as
  // designed.
  const swapped = new FakeStorage()
  const mismatched = createCRMStore(snapshotFor(workspaceFor(org, user)), {
    journal: journalApiWith({ createJournalEntry: async () => ({ ok: false, error: 'context_mismatch' }) }),
    draftStorage: swapped,
  })
  writeDraftSlot(org, user, 'journal', draft, swapped)
  const mismatch = await mismatched.getState().submitCapture({ requestKey: 'k1', text: 'unsent' }, { surface: 'journal' })
  assert.equal(mismatch.ok === false && mismatch.error, 'context_mismatch')
  assert.equal(mismatched.getState().identityChanged, true)
  assert.equal(readDraftSlot(org, user, 'journal', 'k1', swapped), null, 'context_mismatch still clears the drafts')
  assert.equal(mismatched.getState().toasts.length, 0)
})

test('identityChanged clears the drafts of the identity the store was built for', () => {
  const org = randomUUID(), user = randomUUID(), stranger = randomUUID()
  const storage = new FakeStorage()
  const store = createCRMStore(snapshotFor(workspaceFor(org, user)), { draftStorage: storage })

  writeDraftSlot(org, user, 'journal', { text: 'mine', requestKey: 'k1', kind: 'update', occurredOn: null }, storage)
  // A second tab's draft on the same surface: a slot of its own.
  writeDraftSlot(org, user, 'journal', { text: 'mine, other tab', requestKey: 'k5', kind: 'update', occurredOn: null }, storage)
  writeDraftSlot(org, user, 'dashboard', { text: 'also mine', requestKey: 'k2', kind: 'idea', occurredOn: null }, storage)
  writeDraftSlot(org, stranger, 'journal', { text: 'somebody else', requestKey: 'k3', kind: 'update', occurredOn: null }, storage)

  store.getState().markIdentityChanged()

  assert.equal(store.getState().identityChanged, true)
  assert.equal(readDraftSlot(org, user, 'journal', 'k1', storage), null, 'every surface of the finished identity')
  assert.equal(readDraftSlot(org, user, 'journal', 'k5', storage), null, 'and every slot on it')
  assert.equal(readDraftSlot(org, user, 'dashboard', 'k2', storage), null)
  assert.equal(readDraftSlot(org, stranger, 'journal', 'k3', storage)?.text, 'somebody else',
    'and nobody else is touched')
})

test('signing out clears the leaving identity drafts through the same helper', () => {
  // The control in AppSidebar / MobileChrome calls exactly this before the
  // logout form posts.
  const org = randomUUID(), user = randomUUID(), otherOrg = randomUUID()
  const storage = new FakeStorage()
  writeDraftSlot(org, user, 'journal', { text: 'unsent', requestKey: 'k1', kind: 'update', occurredOn: null }, storage)
  writeDraftSlot(otherOrg, user, 'journal', { text: 'other workspace', requestKey: 'k2', kind: 'update', occurredOn: null }, storage)

  clearDraftsFor(org, user, storage)

  assert.equal(readDraftSlot(org, user, 'journal', 'k1', storage), null)
  assert.equal(readDraftSlot(otherOrg, user, 'journal', 'k2', storage)?.text, 'other workspace',
    'the same person in another organization is a different identity')
})

test('the mount sweep removes foreign-identity drafts and keeps the current one', () => {
  const org = randomUUID(), user = randomUUID(), otherOrg = randomUUID(), otherUser = randomUUID()
  const storage = new FakeStorage()
  writeDraftSlot(org, user, 'journal', { text: 'keep me', requestKey: 'k1', kind: 'update', occurredOn: null }, storage)
  writeDraftSlot(org, user, 'prospect:abc', { text: 'keep me too', requestKey: 'k2', kind: 'update', occurredOn: null }, storage)
  writeDraftSlot(otherOrg, user, 'journal', { text: 'gone', requestKey: 'k3', kind: 'update', occurredOn: null }, storage)
  writeDraftSlot(org, otherUser, 'dashboard', { text: 'gone', requestKey: 'k4', kind: 'update', occurredOn: null }, storage)
  storage.setItem('khyte-settings', '{"theme":"dark"}')
  // An older build's single slot of a foreign identity goes too.
  storage.setItem(draftKey(otherOrg, user, 'dashboard'), JSON.stringify({ text: 'gone', requestKey: 'k6', kind: 'update' }))

  sweepForeignDrafts(org, user, storage)

  assert.equal(readDraftSlot(org, user, 'journal', 'k1', storage)?.text, 'keep me')
  assert.equal(readDraftSlot(org, user, 'prospect:abc', 'k2', storage)?.text, 'keep me too',
    'a surface key containing a colon, followed by the request key, is parsed correctly')
  assert.equal(readDraftSlot(otherOrg, user, 'journal', 'k3', storage), null)
  assert.equal(readDraftSlot(org, otherUser, 'dashboard', 'k4', storage), null)
  assert.equal(storage.getItem(draftKey(otherOrg, user, 'dashboard')), null)
  assert.equal(storage.getItem('khyte-settings'), '{"theme":"dark"}',
    'and keys outside the draft prefix are none of the sweep business')
})

test('the draft module survives a storage that throws on every access', () => {
  const org = randomUUID(), user = randomUUID()
  // Private mode: `localStorage` exists and every call raises. None of this
  // may reach a composer as an exception — the cost of a refusal is that the
  // draft is not remembered, which the composer degrades to component state.
  assert.doesNotThrow(() =>
    writeDraftSlot(org, user, 'journal', { text: 'x', requestKey: 'k', kind: 'update', occurredOn: null }, hostileStorage))
  assert.equal(readDraftSlot(org, user, 'journal', 'k', hostileStorage), null)
  assert.doesNotThrow(() => removeDraftSlot(org, user, 'journal', 'k', hostileStorage))
  assert.deepEqual(listDrafts(org, user, 'journal', hostileStorage), [])
  assert.doesNotThrow(() => clearDraftsFor(org, user, hostileStorage))
  assert.doesNotThrow(() => sweepForeignDrafts(org, user, hostileStorage))
  // The same for the tab's own sessionStorage: which draft is its own is
  // simply not remembered, and a mount offers what localStorage has.
  assert.doesNotThrow(() => rememberOwnDraft(org, user, 'journal', 'k', hostileStorage))
  assert.equal(ownDraftKey(org, user, 'journal', hostileStorage), null)
  assert.doesNotThrow(() => forgetOwnDraft(org, user, 'journal', hostileStorage))
  assert.equal(loadDraftFor(org, user, 'journal', hostileStorage, hostileStorage), null)
  const storage = new FakeStorage()
  writeDraftSlot(org, user, 'journal', { text: 'x', requestKey: 'k', kind: 'update', occurredOn: null }, storage)
  assert.equal(loadDraftFor(org, user, 'journal', storage, hostileStorage)?.text, 'x',
    'a refused sessionStorage still gets the words back')
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
