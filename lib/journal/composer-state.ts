import { CONTEXT_MISMATCH } from '@/lib/actions/scope'
import type { JournalKind } from './contracts'

/**
 * The decisions the Journal's three client surfaces make, as pure functions.
 *
 * NO REACT, NO `server-only`, NO STORAGE — the same reasoning as ./drafts.ts
 * and ./contracts.ts. Each function below is a question one of the components
 * used to answer inline, in a closure, against whatever state that closure
 * happened to capture; each of the bugs they fix (Astra's R1, R2 and R4) was a
 * closure answering with a value that had stopped being true by the time the
 * answer mattered. Pulled out here, the question is asked with the values
 * passed in, and tests/store.test.ts can ask it without rendering anything.
 */

/* ———— identity ———— */

/**
 * The two refusals that mean "this tab is finished".
 *
 * `context_mismatch`: the cookie now names somebody else. `unauthorized`: the
 * session or the membership ended between the page load and this call. Both
 * go the same way — the store's `finishIdentity`, the "signing you back in"
 * sentence, no Retry — because a retry from a tab in either state is a write
 * that cannot succeed, or one that would succeed as the wrong person.
 */
export const UNAUTHORIZED = 'unauthorized'

export function isIdentityRefusal(error: string): boolean {
  return error === CONTEXT_MISMATCH || error === UNAUTHORIZED
}

/* ———— R1: a save that comes back after the writer kept typing ———— */

/** What the composer submitted, frozen at the moment Save was pressed. */
export interface SaveSnapshot {
  text: string
  kind: JournalKind
  /** `''` for "now", as the composer's date field holds it. */
  occurredOn: string
  requestKey: string
  /** The draft the save came from. The drawer reuses one composer for every
   *  prospect, so this can stop being the box's surface mid-save. */
  surface: string
}

/** What the composer holds at the moment the answer arrives. */
export interface ComposerNow {
  text: string
  kind: JournalKind
  occurredOn: string
  surface: string
  /**
   * The key the current draft carries, when the caller knows it. A draft that
   * already has a key of its own (the box was emptied and a new sentence
   * begun while the save was in flight) needs no new one.
   */
  requestKey?: string | null
}

export type SaveAnnouncement = 'saved' | 'savedKeptNewer' | 'ignored'

export interface SaveSettlement {
  /** Empty the box and forget the stored draft. */
  clear: boolean
  /** Keep the box, and give what is in it a key of its own. */
  mintNewKey: boolean
  announce: SaveAnnouncement
}

/**
 * What an `{ ok: true }` may do to the box it came back to.
 *
 * Before this, success emptied the box unconditionally — and the textarea is
 * deliberately not disabled while a save is in flight, so every word typed
 * between Save and the answer was erased by the answer. Three cases now:
 *
 *   the box still says what was sent       → it was saved; empty it ('saved').
 *   the box says something newer           → the earlier words were saved, the
 *                                            newer ones stay, and they get a
 *                                            new request key: the old key now
 *                                            belongs to a saved entry, and a
 *                                            retry on it would collide
 *                                            ('savedKeptNewer').
 *   the box is on another surface now      → nothing on screen is this save's
 *                                            to touch ('ignored'); the caller
 *                                            settles the OLD surface's stored
 *                                            draft instead, which it can do by
 *                                            asking this same function about
 *                                            that draft.
 *
 * "The same" is the text, trimmed — the saved entry is the trimmed text, so a
 * trailing space is not a newer draft — plus the kind and the date. An empty
 * box is treated as settled: there is nothing in it to keep.
 */
export function settleSave(snapshot: SaveSnapshot, current: ComposerNow): SaveSettlement {
  if (current.surface !== snapshot.surface) {
    return { clear: false, mintNewKey: false, announce: 'ignored' }
  }
  const text = current.text.trim()
  const unchanged =
    text === snapshot.text.trim() &&
    current.kind === snapshot.kind &&
    current.occurredOn === snapshot.occurredOn
  if (unchanged || text === '') {
    return { clear: true, mintNewKey: false, announce: 'saved' }
  }
  const ownKey =
    current.requestKey !== undefined &&
    current.requestKey !== null &&
    current.requestKey !== snapshot.requestKey
  return { clear: false, mintNewKey: !ownKey, announce: 'savedKeptNewer' }
}

/* ———— R2: an editor that stays on the revision it was opened on ———— */

/**
 * One open card editor.
 *
 * `base` is the revision the words in the editor were written against, and
 * the only value `expectedRevision` may ever be. Before this the card sent
 * the entry prop's revision at the moment of saving — and the prop is live, so
 * a colleague's edit that reached the store while the editor was open became
 * the base silently, and saving overwrote their wording without a conflict.
 *
 * `latest` is the newest revision the card has been shown since. `latest >
 * base` means the entry moved under the editor; `conflict` means the server
 * said so. Either way the editor stays open with the local words, and only an
 * explicit `rebase` — somebody pressing "use the latest version as the base",
 * having been shown it — moves `base`.
 */
export interface EditSession {
  base: number
  latest: number
  conflict: boolean
}

export type EditSessionAction =
  | { type: 'beginEdit'; revision: number }
  | { type: 'incomingRevision'; revision: number }
  | { type: 'conflict' }
  | { type: 'rebase'; revision: number }
  | { type: 'end' }

export function beginEdit(revision: number): EditSession {
  return { base: revision, latest: revision, conflict: false }
}

/** A newer revision reached the card. Recorded; the base does NOT move. */
export function incomingRevision(session: EditSession, revision: number): EditSession {
  if (revision <= session.latest) return session
  return { ...session, latest: revision }
}

/** The writer has seen the newer wording and chooses to write over it. */
export function rebase(session: EditSession, revision: number): EditSession {
  const latest = Math.max(session.latest, revision)
  return { base: latest, latest, conflict: false }
}

/** Has the entry moved under this editor, as far as the card knows? */
export function isStale(session: EditSession): boolean {
  return session.conflict || session.latest > session.base
}

/** The same four transitions, as a reducer for `useReducer`. `null` is "no
 *  editor open". */
export function editSessionReducer(state: EditSession | null, action: EditSessionAction): EditSession | null {
  switch (action.type) {
    case 'beginEdit':
      return beginEdit(action.revision)
    case 'end':
      return null
    default:
      if (state === null) return null
      if (action.type === 'incomingRevision') return incomingRevision(state, action.revision)
      if (action.type === 'conflict') return state.conflict ? state : { ...state, conflict: true }
      return rebase(state, action.revision)
  }
}

/* ———— R4: a poller that only forgets a change once it has shown it ———— */

/** What `refreshJournalViews` reports. */
export type JournalRefreshOutcome = 'applied' | 'deferred' | 'failed'

/**
 * `seen` is the stamp whose data the feeds are showing; `pending` a stamp that
 * was fetched and not yet applied — kept for the record, since the retry is
 * decided against `seen` alone.
 */
export interface PollState {
  seen: string | null
  pending: string | null
}

/**
 * What a fetched stamp asks for.
 *
 *   'adopt'   the first answer since mount. It describes the pages the feeds
 *             have just read for themselves, so it is recorded, not acted on.
 *   'skip'    the feeds already show this stamp.
 *   'refresh' anything else — INCLUDING a stamp equal to the one fetched last
 *             time, when that one was deferred or failed. Comparing with the
 *             last fetch instead of with `seen` is how a change that arrived
 *             while somebody typed was consumed and never shown.
 */
export function pollAction(seen: string | null, fetched: string): 'adopt' | 'skip' | 'refresh' {
  if (seen === null) return 'adopt'
  if (fetched === seen) return 'skip'
  return 'refresh'
}

/** Where the poller stands after a refresh attempt. `seen` advances ONLY on
 *  'applied'. */
export function nextPollState(seen: string | null, fetched: string, outcome: JournalRefreshOutcome): PollState {
  if (outcome === 'applied') return { seen: fetched, pending: null }
  return { seen, pending: fetched }
}
