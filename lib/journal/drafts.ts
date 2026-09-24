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
 * WHY THE KEY CARRIES THE IDENTITY. `khyte:journal-draft:<org>:<user>:<surface>`.
 * A browser can hold sessions for two organizations, and two people share a
 * machine. A draft keyed by surface alone would be offered back to whoever
 * opened the composer next, in whatever organization they were in — and then
 * saved there. Keying by organization AND user means the worst case is a draft
 * that is never offered back, not a draft offered to the wrong person.
 *
 * THE REQUEST KEY LIVES HERE TOO, and that is the point of persisting a draft
 * rather than just the text. It is minted once, when the draft is first
 * written, and kept until the save succeeds; a retry of a save that actually
 * landed (the answer was lost, not the write) therefore carries the same key
 * and comes back as the original entry instead of writing a second one. A key
 * minted per attempt would make every retry a duplicate.
 *
 * TWO TABS ON ONE SURFACE SHARE ONE DRAFT — the key has no tab in it, on
 * purpose: a reload must find the words whichever tab typed them. So the
 * stored draft is not this tab's property. A save that lands clears it only
 * when it still holds exactly what that save sent (`settleStoredDraft` in
 * ./composer-state.ts decides), and an idle tab follows what another tab
 * writes through the `storage` event (`shouldAdoptStored`).
 *
 * EVERY ACCESS IS WRAPPED. `localStorage` throws on access in a Safari private
 * window, is absent during server rendering, and can be full. None of those is
 * worth an exception in a composer — the failure mode is "the draft is not
 * remembered", which the composer degrades to component state without telling
 * anybody anything alarming.
 */

/** Everything under one prefix, so a sweep can find keys it did not write. */
const PREFIX = 'khyte:journal-draft:'

/** Where a composer sits. `prospect:<opportunityId>` is one per prospect. */
export type JournalSurface = 'dashboard' | 'journal' | `prospect:${string}`

export interface JournalDraft {
  text: string
  /** Minted on the first write, kept until the save succeeds. See above. */
  requestKey: string
  kind: JournalKind
  /** `YYYY-MM-DD` when the writer picked a day, null for "now". */
  occurredOn: string | null
  updatedAt: string
}

/**
 * The slice of `Storage` this module uses.
 *
 * Structural rather than `Storage` itself so a test can hand in a plain object
 * — `Storage` is a DOM interface with an index signature no plain object
 * satisfies. A real `localStorage` is assignable to this.
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

function resolve(storage?: DraftStorage): DraftStorage | null {
  return storage ?? defaultStorage()
}

export function draftKey(organizationId: string, userId: string, surface: string): string {
  return `${PREFIX}${organizationId}:${userId}:${surface}`
}

/**
 * A fresh request key.
 *
 * `crypto.randomUUID` is present in every browser this app supports and in
 * Node 19+; the fallback exists so a composer in an exotic context still gets
 * a key rather than throwing, and it only has to be unique among one person's
 * unsaved drafts.
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

/** The draft for one surface, or null when there is none or it is unreadable. */
export function readDraft(
  organizationId: string,
  userId: string,
  surface: string,
  storage?: DraftStorage
): JournalDraft | null {
  const store = resolve(storage)
  if (!store) return null
  try {
    return parseDraft(store.getItem(draftKey(organizationId, userId, surface)))
  } catch {
    return null
  }
}

/**
 * One stored value, as a draft — or null when it is not one.
 *
 * Separate from `readDraft` because a `storage` event hands over the value a
 * key held BEFORE another tab wrote it (`oldValue`), which is not in storage
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
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

/** Files a draft. Silent on failure — see the header. */
export function writeDraft(
  organizationId: string,
  userId: string,
  surface: string,
  draft: Omit<JournalDraft, 'updatedAt'> & { updatedAt?: string },
  storage?: DraftStorage
): void {
  const store = resolve(storage)
  if (!store) return
  try {
    const payload: JournalDraft = { ...draft, updatedAt: draft.updatedAt ?? new Date().toISOString() }
    store.setItem(draftKey(organizationId, userId, surface), JSON.stringify(payload))
  } catch {
    // Quota, private mode, or no storage at all. The composer keeps the text
    // in component state either way.
  }
}

/** Forgets one surface's draft. Called only after `{ ok: true }`. */
export function clearDraft(
  organizationId: string,
  userId: string,
  surface: string,
  storage?: DraftStorage
): void {
  const store = resolve(storage)
  if (!store) return
  try {
    store.removeItem(draftKey(organizationId, userId, surface))
  } catch {
    // Nothing to do; a stale draft is offered back once and then overwritten.
  }
}

/**
 * Every key the given identity owns, whatever surface it came from.
 *
 * Called when the store learns it is finished (`identityChanged`) and by the
 * sign-out control. Both are the same statement: this person is done in this
 * browser, and their unsaved words must not be offered to whoever signs in
 * next — which, with the identity in the key, would not happen anyway, but a
 * draft nobody will ever be offered is a draft that should not be lying around.
 */
export function clearDraftsFor(organizationId: string, userId: string, storage?: DraftStorage): void {
  const store = resolve(storage)
  if (!store) return
  removeMatching(store, key => {
    const identity = identityOf(key)
    return identity !== null && identity.organizationId === organizationId && identity.userId === userId
  })
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
export function sweepForeignDrafts(organizationId: string, userId: string, storage?: DraftStorage): void {
  const store = resolve(storage)
  if (!store) return
  removeMatching(store, key => {
    const identity = identityOf(key)
    // A key under our prefix that does not parse is not one this build wrote;
    // it goes too, for the same reason.
    if (identity === null) return true
    return identity.organizationId !== organizationId || identity.userId !== userId
  })
}

/**
 * `<org>:<user>` out of a draft key, or null when the key is not one.
 *
 * The surface may itself contain a colon (`prospect:<id>`), so only the first
 * two segments are taken and the rest is left alone.
 */
function identityOf(key: string): { organizationId: string; userId: string } | null {
  if (!key.startsWith(PREFIX)) return null
  const rest = key.slice(PREFIX.length)
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
function removeMatching(store: DraftStorage, matches: (key: string) => boolean): void {
  const doomed: string[] = []
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i)
      if (key && key.startsWith(PREFIX) && matches(key)) doomed.push(key)
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
