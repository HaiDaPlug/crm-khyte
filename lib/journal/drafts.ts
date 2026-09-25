import type { JournalKind } from './contracts'

/**
 * What the composer is holding but has not managed to save yet.
 *
 * NO `server-only`, NO REACT, NO NODE IMPORTS — same reasoning as
 * ./contracts.ts. The store imports this to clear an identity's drafts, the
 * composer imports it to keep one, and tests/store.test.ts runs both without
 * `--conditions=react-server`.
 *
 * WHY BROWSER STORAGE AT ALL. Text somebody typed into a box is the one thing
 * in this app that exists nowhere else: a refused save, a reload, a tab
 * restored tomorrow morning — every one of those loses the sentence unless it
 * was written down somewhere. Component state does not survive any of them.
 *
 * WHY THE KEY CARRIES THE IDENTITY.
 * `khyte:journal-draft:<org>:<user>:<surface>:<requestKey>`. A browser can
 * hold sessions for two organizations, and two people share a machine. A draft
 * keyed by surface alone would be offered back to whoever opened the composer
 * next, in whatever organization they were in — and then saved there. Keying
 * by organization AND user means the worst case is a draft that is never
 * offered back, not a draft offered to the wrong person.
 *
 * THE REQUEST KEY LIVES HERE TOO, and that is the point of persisting a draft
 * rather than just the text. It is minted when the draft is first written and
 * kept across every retry, so a retry of a save that actually landed (the
 * answer was lost, not the write) carries the same key and comes back as the
 * original entry instead of writing a second one. A key minted per attempt
 * would make every retry a duplicate. It is re-minted only on purpose: by
 * "save as a new entry", by the words typed after a save landed, and by a
 * fork, when another tab writes different words under it.
 *
 * ONE SLOT PER DRAFT, NOT PER SURFACE — the request key is the last segment of
 * the storage key. An earlier build kept one slot per surface, so a draft was
 * identified by where it was typed rather than by whose it was, and two tabs
 * open on one surface wrote the same slot: when they held different unsaved
 * words, one version lived only in memory and a reload lost it, and a tab
 * following the other's writes could overwrite the last copy of its own. With
 * a slot per request key, divergent words in two tabs end in two slots and
 * both survive a reload. A surface may contain a colon (`prospect:<id>`); a
 * request key never does (a UUID, or `draft-…`), so a slot is always the
 * surface's key plus exactly one more segment.
 *
 * EVERY TAB REMEMBERS WHICH SLOT IS ITS OWN, in sessionStorage under
 * `khyte:journal-draft-owner:<org>:<user>:<surface>`, because sessionStorage is
 * the one browser store that belongs to a single tab and survives its reload.
 * A reloaded tab therefore gets its own words back, not whichever tab wrote
 * last — and still knows they were typed in it (`ownDraft`), so another tab
 * emptying the same draft after the reload cannot empty this one. The record
 * also keeps the tab's own COPY of the draft (`OwnSnapshot`): while the
 * composer is on another surface (the drawer moved to another prospect)
 * nothing here is live to hear another tab empty or rewrite the shared slot,
 * so the next mount reconciles the copy with the slot instead — restoring,
 * forking or following exactly as the live listener would. A tab that owns
 * nothing yet — a new one — takes the newest slot on the surface, another
 * tab's or a closed one's, and remembers it: it is a mirror of that draft
 * until somebody types in it. "Duplicate tab" copies
 * sessionStorage and so makes two owners of one key; that is the same case as
 * a new tab mirroring an open one, and the composer's cross-tab rules
 * (`followStorage` in ./composer-state.ts) are written for it. The owner
 * prefix is deliberately not under `PREFIX` — it lives in another storage —
 * but it carries the identity the same way, and since the record holds a copy
 * of the words, sign-out (`clearDraftsFor`) and the mount sweep
 * (`sweepForeignDrafts`) clear it like a slot.
 *
 * A SLOT IS REMOVED ONLY BY WHOEVER IS LETTING GO OF ITS WORDS, and only while
 * it still holds exactly those words — a save whose words landed, a box that
 * was emptied, a draft moved to a fresh key. The decision is made in
 * ./composer-state.ts (`settleSentSlot`); this module files, reads and removes
 * what it is told to.
 *
 * AN OLDER BUILD'S SINGLE SLOT — the surface's key with no request key after
 * it — is moved into its own slot the first time the surface is listed. Stage
 * 2 has not shipped, so this only serves developer machines, but a draft must
 * never be dropped by an upgrade.
 *
 * EVERY ACCESS IS WRAPPED. `localStorage` and `sessionStorage` throw on access
 * in a Safari private window, are absent during server rendering, and can be
 * full. None of those is worth an exception in a composer — the failure mode
 * is "the draft is not remembered", or "this tab does not remember which draft
 * is its own", which the composer degrades to component state without telling
 * anybody anything alarming.
 */

/** Everything under one prefix, so a sweep can find keys it did not write. */
const PREFIX = 'khyte:journal-draft:'

/** Which slot a tab owns. Not under `PREFIX` — see the header. */
const OWNER_PREFIX = 'khyte:journal-draft-owner:'

/** Where a composer sits. `prospect:<opportunityId>` is one per prospect. */
export type JournalSurface = 'dashboard' | 'journal' | `prospect:${string}`

export interface JournalDraft {
  text: string
  /** Names the slot. Kept across retries; re-minted only on purpose — see above. */
  requestKey: string
  kind: JournalKind
  /** `YYYY-MM-DD` when the writer picked a day, null for "now". */
  occurredOn: string | null
  updatedAt: string
  /**
   * The key these words were forked FROM, when a tab moved them off another
   * tab's key (lib/journal/draft-box.ts). The same words may already be, or
   * later become, filed under that key, so every holder of this draft — a
   * reload, the drawer coming back, a new tab mirroring it — sends its Save
   * there: the service replays, files once, or answers with the conflict
   * strip, and never files the sentence a second time under this slot's key.
   * Stored with the draft because it must outlive the tab that forked.
   */
  forkedFrom?: string
}

/**
 * The slice of `Storage` this module uses — of `localStorage` for the drafts
 * and of `sessionStorage` for which one a tab owns.
 *
 * Structural rather than `Storage` itself so a test can hand in a plain object
 * — `Storage` is a DOM interface with an index signature no plain object
 * satisfies. A real `localStorage` or `sessionStorage` is assignable to this.
 */
export interface DraftStorage {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** `localStorage` when there is one, null on the server. Never throws. */
function defaultStorage(): DraftStorage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

/** `sessionStorage` when there is one, null on the server. Never throws. */
function defaultSession(): DraftStorage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

function resolve(storage?: DraftStorage): DraftStorage | null {
  return storage ?? defaultStorage()
}

function resolveSession(session?: DraftStorage): DraftStorage | null {
  return session ?? defaultSession()
}

/**
 * The surface's key. Every slot on the surface is this plus `:<requestKey>`;
 * the exact key, with nothing after it, is the single slot an older build
 * wrote.
 */
export function draftKey(organizationId: string, userId: string, surface: string): string {
  return `${PREFIX}${organizationId}:${userId}:${surface}`
}

/** The storage key of one draft. */
export function slotKey(organizationId: string, userId: string, surface: string, requestKey: string): string {
  return `${draftKey(organizationId, userId, surface)}:${requestKey}`
}

/**
 * The request key a storage key holds a draft for, when it is a slot on this
 * surface — or null.
 *
 * The composer's `storage` listener hears every key of the origin and needs
 * exactly this: is it one of this surface's drafts, and whose? What follows
 * the surface's key must be one non-empty segment, so the legacy key, and the
 * slots of a longer surface that happens to share the prefix, are never taken
 * for slots of this one.
 */
export function slotOf(key: string, organizationId: string, userId: string, surface: string): string | null {
  const prefix = `${draftKey(organizationId, userId, surface)}:`
  if (!key.startsWith(prefix)) return null
  const requestKey = key.slice(prefix.length)
  return requestKey !== '' && !requestKey.includes(':') ? requestKey : null
}

/**
 * A fresh request key.
 *
 * `crypto.randomUUID` is present in every browser this app supports and in
 * Node 19+; the fallback exists so a composer in an exotic context still gets
 * a key rather than throwing, and it only has to be unique among one person's
 * unsaved drafts. Neither form contains a colon, which `slotOf` relies on.
 */
export function newRequestKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // Fall through.
  }
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * One stored value, as a draft — or null when it is not one.
 *
 * Separate from `readDraftSlot` because a `storage` event hands over the value
 * a key held BEFORE another tab wrote it (`oldValue`), which is not in storage
 * any more and can only be parsed. The composer needs it to tell whether the
 * words it is holding were in storage when the other tab wrote over them.
 */
export function parseDraft(raw: string | null | undefined): JournalDraft | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<JournalDraft>
    // A blob written by an older build, or hand-edited: anything without both
    // halves of the identity-of-a-save is not a draft this module can honour.
    if (typeof parsed.text !== 'string' || typeof parsed.requestKey !== 'string') return null
    return {
      text: parsed.text,
      requestKey: parsed.requestKey,
      kind: (parsed.kind ?? 'update') as JournalKind,
      occurredOn: typeof parsed.occurredOn === 'string' ? parsed.occurredOn : null,
      // A missing stamp stays missing: filling in "now" would make the
      // oldest, unstamped draft sort as the newest in `listDrafts`.
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      ...(typeof parsed.forkedFrom === 'string' && parsed.forkedFrom !== '' ? { forkedFrom: parsed.forkedFrom } : {}),
    }
  } catch {
    return null
  }
}

/** One draft, by its request key, or null when there is none or it is unreadable. */
export function readDraftSlot(
  organizationId: string,
  userId: string,
  surface: string,
  requestKey: string,
  storage?: DraftStorage
): JournalDraft | null {
  const store = resolve(storage)
  if (!store) return null
  try {
    return parseDraft(store.getItem(slotKey(organizationId, userId, surface, requestKey)))
  } catch {
    return null
  }
}

/**
 * Files a draft in the slot its request key names. Never throws — see the
 * header — but says whether the write went through: a caller MOVING a draft
 * to a new key releases the old slot only on `true`, or a swallowed quota
 * failure followed by the release would remove the only stored copy.
 */
export function writeDraftSlot(
  organizationId: string,
  userId: string,
  surface: string,
  draft: Omit<JournalDraft, 'updatedAt'> & { updatedAt?: string },
  storage?: DraftStorage
): boolean {
  const store = resolve(storage)
  if (!store) return false
  try {
    const payload: JournalDraft = { ...draft, updatedAt: draft.updatedAt ?? new Date().toISOString() }
    store.setItem(slotKey(organizationId, userId, surface, draft.requestKey), JSON.stringify(payload))
    return true
  } catch {
    // Quota, private mode, or no storage at all. The composer keeps the text
    // in component state either way.
    return false
  }
}

/** Forgets one draft. When is the composer's decision — see the header. */
export function removeDraftSlot(
  organizationId: string,
  userId: string,
  surface: string,
  requestKey: string,
  storage?: DraftStorage
): void {
  const store = resolve(storage)
  if (!store) return
  try {
    store.removeItem(slotKey(organizationId, userId, surface, requestKey))
  } catch {
    // Nothing to do. The slot stays and is offered back on a mount; no other
    // tab writes over it, since every draft has a slot of its own.
  }
}

/**
 * Every draft on one surface, newest first — after moving an older build's
 * single slot into a slot of its own.
 *
 * Newest first because a tab that owns nothing takes the head of this list:
 * of the words nobody in this tab typed, the ones written last are the ones
 * most likely still being written.
 */
export function listDrafts(
  organizationId: string,
  userId: string,
  surface: string,
  storage?: DraftStorage
): JournalDraft[] {
  const store = resolve(storage)
  if (!store) return []
  migrateLegacySlot(store, organizationId, userId, surface)
  const drafts: JournalDraft[] = []
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i)
      if (!key || slotOf(key, organizationId, userId, surface) === null) continue
      const draft = parseDraft(store.getItem(key))
      if (draft) drafts.push(draft)
    }
  } catch {
    // Whatever was read before the refusal is still worth offering.
  }
  return drafts.sort((a, b) => stampOf(b) - stampOf(a))
}

/** `updatedAt` as a number to sort by; a missing or unreadable stamp (`''`
 *  from `parseDraft`) is 0, and sorts last. */
function stampOf(draft: JournalDraft): number {
  const at = Date.parse(draft.updatedAt)
  return Number.isNaN(at) ? 0 : at
}

/**
 * Moves an older build's one-slot-per-surface draft into the slot its request
 * key names.
 *
 * The legacy key is removed only after the write went through: a `setItem`
 * that throws skips the removal, and the move is tried again next time. A
 * slot already holding different words under the same key (an old-build tab
 * and a new one open at once) is not written over — the legacy words take a
 * fresh key instead, as does a key that could not name a slot. A near-
 * duplicate draft is possible that way; a lost one is not.
 */
function migrateLegacySlot(store: DraftStorage, organizationId: string, userId: string, surface: string): void {
  try {
    const legacyKey = draftKey(organizationId, userId, surface)
    const legacy = parseDraft(store.getItem(legacyKey))
    if (!legacy) return
    const nameable = legacy.requestKey !== '' && !legacy.requestKey.includes(':')
    const occupant = nameable ? parseDraft(store.getItem(slotKey(organizationId, userId, surface, legacy.requestKey))) : null
    const alreadyThere =
      occupant !== null &&
      occupant.text === legacy.text &&
      occupant.kind === legacy.kind &&
      occupant.occurredOn === legacy.occurredOn
    if (!alreadyThere) {
      const requestKey = nameable && occupant === null ? legacy.requestKey : newRequestKey()
      store.setItem(slotKey(organizationId, userId, surface, requestKey), JSON.stringify({ ...legacy, requestKey }))
    }
    store.removeItem(legacyKey)
  } catch {
    // The legacy slot stays where it is, and is moved next time.
  }
}

function ownerKey(organizationId: string, userId: string, surface: string): string {
  return `${OWNER_PREFIX}${organizationId}:${userId}:${surface}`
}

/**
 * The draft this tab's box holds on this surface: its request key, and the
 * words typed in this tab (`typedText`, empty for a mirror) — or null.
 *
 * The typed words are kept here, beside the key, because a reload must not
 * turn this tab's own words into a mirror: a mirror empties when another tab
 * deletes the draft, and typed words must not. The WORDS, not a flag: the
 * slot may hold something else by the time this tab mounts again — another
 * tab rewrote it while the drawer was away — and those words are a mirror,
 * however this tab's own ones were. A value written by an earlier build (the
 * bare key, or a flag without words) reads as a mirror.
 */
export function ownDraft(
  organizationId: string,
  userId: string,
  surface: string,
  session?: DraftStorage
): OwnDraft | null {
  const store = resolveSession(session)
  if (!store) return null
  try {
    const raw = store.getItem(ownerKey(organizationId, userId, surface))
    if (!raw) return null
    if (!raw.startsWith('{')) return { requestKey: raw, typedText: '', snapshot: null }
    const parsed = JSON.parse(raw) as Partial<Record<'requestKey' | 'typedText' | 'text' | 'kind' | 'occurredOn' | 'forkedFrom', unknown>>
    if (typeof parsed.requestKey !== 'string' || parsed.requestKey === '') return null
    const snapshot: OwnSnapshot | null =
      typeof parsed.text === 'string'
        ? {
            text: parsed.text,
            kind: (typeof parsed.kind === 'string' ? parsed.kind : 'update') as JournalKind,
            occurredOn: typeof parsed.occurredOn === 'string' ? parsed.occurredOn : null,
            ...(typeof parsed.forkedFrom === 'string' && parsed.forkedFrom !== '' ? { forkedFrom: parsed.forkedFrom } : {}),
          }
        : null
    return { requestKey: parsed.requestKey, typedText: typeof parsed.typedText === 'string' ? parsed.typedText : '', snapshot }
  } catch {
    return null
  }
}

/**
 * This tab's own copy of the draft its box holds: the words, kind, date and
 * fork origin, as the box last showed them.
 *
 * WHY A COPY, when the slot has the words. The slot is shared: while this
 * tab's composer is not mounted on the surface — the drawer moved to another
 * prospect — another tab may empty it or write over it, and nothing here is
 * live to write the words back or fork them. The copy is in sessionStorage,
 * which no other tab can touch, and the next mount reconciles it with the slot
 * by the same rules the live listener applies (`reconcileOnMount` in
 * ./composer-state.ts).
 */
export interface OwnSnapshot {
  text: string
  kind: JournalKind
  occurredOn: string | null
  forkedFrom?: string
}

/** What a tab remembers of its draft on a surface — see `ownDraft`. */
export interface OwnDraft {
  requestKey: string
  /** The words typed in this tab; empty for a mirror. */
  typedText: string
  /** Null for a record written by an earlier build: the key, and no words. */
  snapshot: OwnSnapshot | null
}

/** The request key this tab's box holds on this surface, or null. */
export function ownDraftKey(
  organizationId: string,
  userId: string,
  surface: string,
  session?: DraftStorage
): string | null {
  return ownDraft(organizationId, userId, surface, session)?.requestKey ?? null
}

/**
 * Records the request key this tab's box now holds, the words typed in this
 * tab (empty for a mirror), and — when given — the tab's own copy of the
 * draft (see `ownDraft` and `OwnSnapshot`). Silent on failure.
 */
export function rememberOwnDraft(
  organizationId: string,
  userId: string,
  surface: string,
  requestKey: string,
  session?: DraftStorage,
  typedText = '',
  snapshot?: OwnSnapshot
): void {
  const store = resolveSession(session)
  if (!store) return
  try {
    store.setItem(ownerKey(organizationId, userId, surface), JSON.stringify({ requestKey, typedText, ...snapshot }))
  } catch {
    // The previous record stays, older than the box: the next mount weighs
    // that older copy against the slot and shows, restores or forks it by the
    // usual rules — still this tab's words, a keystroke or two behind, never
    // nothing. With no previous record, the mount takes the newest slot.
  }
}

/** This tab's box holds no draft on this surface any more. Silent on failure. */
export function forgetOwnDraft(organizationId: string, userId: string, surface: string, session?: DraftStorage): void {
  const store = resolveSession(session)
  if (!store) return
  try {
    store.removeItem(ownerKey(organizationId, userId, surface))
  } catch {
    // Nothing to do; a key naming a slot that is gone is passed over on load.
  }
}

/**
 * The draft a box shows when it mounts on a surface.
 *
 *   this tab owns a key and its slot exists → that slot: a reload gets its own
 *                                             words back, whatever other tabs
 *                                             wrote since.
 *   otherwise, any slot on the surface      → the newest, and its key is
 *                                             remembered as this tab's own: a
 *                                             new tab mirrors the draft another
 *                                             tab, or a closed one, left.
 *   nothing                                 → null, and a remembered key whose
 *                                             slot is gone is forgotten.
 */
export function loadDraftFor(
  organizationId: string,
  userId: string,
  surface: string,
  storage?: DraftStorage,
  session?: DraftStorage
): JournalDraft | null {
  const drafts = listDrafts(organizationId, userId, surface, storage)
  const own = ownDraftKey(organizationId, userId, surface, session)
  if (own !== null) {
    const owned = readDraftSlot(organizationId, userId, surface, own, storage)
    if (owned) return owned
  }
  const newest = drafts[0] ?? null
  if (newest) rememberOwnDraft(organizationId, userId, surface, newest.requestKey, session)
  else if (own !== null) forgetOwnDraft(organizationId, userId, surface, session)
  return newest
}

/**
 * Every key the given identity owns, whatever surface it came from.
 *
 * Called when the store learns it is finished (`identityChanged`) and by the
 * sign-out control. Both are the same statement: this person is done in this
 * browser, and their unsaved words must not be offered to whoever signs in
 * next — which, with the identity in the key, would not happen anyway, but a
 * draft nobody will ever be offered is a draft that should not be lying around.
 *
 * NOT A TOMBSTONE. Another tab of the same identity that holds words typed in
 * it hears each removal as its own slot going, and writes its words back
 * (`followStorage` answers 'restore') — the rule that keeps typed words from
 * being erased by another tab cannot tell a sign-out from a save. The slot it
 * restores stays keyed to the signed-out identity, so it is never offered to
 * anybody else, and `sweepForeignDrafts` removes it on the next mount by
 * another identity. Before per-key slots the same tab rewrote it on its next
 * keystroke; an idle one emptied.
 */
export function clearDraftsFor(
  organizationId: string,
  userId: string,
  storage?: DraftStorage,
  session?: DraftStorage
): void {
  const theirs = (prefix: string) => (key: string) => {
    const identity = identityOf(key, prefix)
    return identity !== null && identity.organizationId === organizationId && identity.userId === userId
  }
  const store = resolve(storage)
  if (store) removeMatching(store, PREFIX, theirs(PREFIX))
  // And this tab's own copies of that identity's drafts (`ownDraft`): they
  // hold the words too, and signing back in on this tab must not restore
  // a draft that was signed out.
  const tab = resolveSession(session)
  if (tab) removeMatching(tab, OWNER_PREFIX, theirs(OWNER_PREFIX))
}

/**
 * Drops drafts belonging to any OTHER identity.
 *
 * Run on composer mount. Its job is the case `clearDraftsFor` cannot reach:
 * a session that ended without passing through sign-out or an identity change
 * — a revoked membership, an expired cookie, a browser closed mid-sentence and
 * reopened by somebody else. Those keys would otherwise sit in storage
 * indefinitely holding somebody's words.
 */
export function sweepForeignDrafts(
  organizationId: string,
  userId: string,
  storage?: DraftStorage,
  session?: DraftStorage
): void {
  const foreign = (prefix: string) => (key: string) => {
    const identity = identityOf(key, prefix)
    // A key under our prefix that does not parse is not one this build wrote;
    // it goes too, for the same reason.
    if (identity === null) return true
    return identity.organizationId !== organizationId || identity.userId !== userId
  }
  const store = resolve(storage)
  if (store) removeMatching(store, PREFIX, foreign(PREFIX))
  // And this tab's copies of other identities' drafts, which hold their words.
  const tab = resolveSession(session)
  if (tab) removeMatching(tab, OWNER_PREFIX, foreign(OWNER_PREFIX))
}

/**
 * `<org>:<user>` out of a draft key — or, with `OWNER_PREFIX`, an owner
 * record's key — or null when the key is not one.
 *
 * The surface may itself contain a colon (`prospect:<id>`) and a slot adds its
 * request key after it, so only the first two segments are taken and the rest
 * is left alone — which is why a slot and the legacy single key answer to the
 * same identity.
 */
function identityOf(key: string, prefix = PREFIX): { organizationId: string; userId: string } | null {
  if (!key.startsWith(prefix)) return null
  const rest = key.slice(prefix.length)
  const first = rest.indexOf(':')
  if (first <= 0) return null
  const second = rest.indexOf(':', first + 1)
  if (second <= first + 1) return null
  return { organizationId: rest.slice(0, first), userId: rest.slice(first + 1, second) }
}

/**
 * Removes every key under the prefix the predicate accepts.
 *
 * Collected first, then removed: removing while walking `store.key(i)`
 * reindexes the store underneath the loop and silently skips entries.
 */
function removeMatching(store: DraftStorage, prefix: string, matches: (key: string) => boolean): void {
  const doomed: string[] = []
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i)
      if (key && key.startsWith(prefix) && matches(key)) doomed.push(key)
    }
  } catch {
    return
  }
  for (const key of doomed) {
    try {
      store.removeItem(key)
    } catch {
      // Keep going; one unreadable key must not strand the rest.
    }
  }
}
