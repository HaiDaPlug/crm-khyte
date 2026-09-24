import { CONTEXT_MISMATCH, UNAUTHORIZED } from '@/lib/actions/scope'
import type { JournalKind } from './contracts'
import type { JournalDraft } from './drafts'

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
 *
 * The stored-draft functions decide what happens to storage; they never touch
 * it. The composer reads the draft, asks, and carries the answer out.
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
export { UNAUTHORIZED }

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
  /**
   * With `clear: false`: what the box should now hold. When the writer simply
   * kept typing after Save — the box begins with exactly the words that were
   * sent — the saved words leave the box and only what came after them stays,
   * the same as a save whose answer arrived before the next keystroke. When
   * the sent words were edited rather than continued, they cannot be told
   * apart from the newer ones and the whole text stays.
   */
  text?: string
  announce: SaveAnnouncement
}

/**
 * The words typed after the sent ones, or null when the sent words were
 * edited rather than continued. Whitespace and sentence punctuation typed
 * right after the sent words belong to the saved sentence, not to the new one
 * ("Called Elena" + ". Budget locked in." leaves "Budget locked in."); a
 * remainder that is only that is nothing.
 */
export function typedSince(sent: string, current: string): string | null {
  if (!current.startsWith(sent)) return null
  return current.slice(sent.length).replace(/^[\s.,;:!?]+/, '')
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
  // Kept typing, same kind and date: the saved sentence leaves the box and
  // what followed it stays — at any network speed, so a fast answer and a
  // slow one end in the same box. Nothing left after the sentence is a
  // settled save.
  const sameShape = current.kind === snapshot.kind && current.occurredOn === snapshot.occurredOn
  const remainder = sameShape ? typedSince(snapshot.text, current.text) : null
  if (remainder === '') {
    return { clear: true, mintNewKey: false, announce: 'saved' }
  }
  const ownKey =
    current.requestKey !== undefined &&
    current.requestKey !== null &&
    current.requestKey !== snapshot.requestKey
  return {
    clear: false,
    mintNewKey: !ownKey,
    ...(remainder !== null ? { text: remainder } : {}),
    announce: 'savedKeptNewer',
  }
}

/* ———— the stored draft two tabs share ———— */

/** The fields of a stored draft that a tab settles against and adopts. */
export type StoredDraft = Pick<JournalDraft, 'text' | 'kind' | 'occurredOn' | 'requestKey'>

/** The same words as a saved entry would read them: trimmed text, kind, date. */
function sameWords(
  a: { text: string; kind: JournalKind; occurredOn: string | null },
  b: { text: string; kind: JournalKind; occurredOn: string | null }
): boolean {
  return a.text.trim() === b.text.trim() && a.kind === b.kind && (a.occurredOn ?? '') === (b.occurredOn ?? '')
}

export interface StoredDraftSettlement {
  /**
   *   'clear'  empty the box — it says what was sent, or nothing.
   *   'adopt'  put the stored draft in the box, key and all: another tab
   *            wrote newer words into it while this box sat unchanged.
   *   'keep'   this box holds newer words of its own; they stay.
   *   'ignore' the box is on another surface now (see `settleSave`).
   */
  box: 'clear' | 'adopt' | 'keep' | 'ignore'
  /** With `box: 'keep'`: the box's words need a key of their own. */
  mintNewKey: boolean
  /** With `box: 'keep'`: what the box should hold — see `SaveSettlement.text`. */
  text?: string
  /**
   *   'clear'  forget it — it is exactly what the save sent, key included.
   *   'write'  file the box's draft over it (under the fresh key, if one was
   *            minted); what it held was this box's own words, the sent ones,
   *            or nothing.
   *   'rekey'  keep its words under a fresh key (another surface's draft,
   *            typed on under the key the save just used up).
   *   'keep'   leave it alone — it holds words this tab does not have.
   */
  stored: 'clear' | 'write' | 'rekey' | 'keep'
  announce: SaveAnnouncement
}

/**
 * What an `{ ok: true }` may do to the box AND to the stored draft.
 *
 * `settleSave` weighs the answer against the box, and that is not enough: the
 * stored draft is shared. Two tabs on one surface read and write the same key.
 * Tab A saves; tab B types newer words into the stored draft; A's answer finds
 * A's own box unchanged — and, settled against the box alone, cleared storage
 * and B's words with it, so a reload of B found nothing. The stored draft is
 * therefore re-read when the answer arrives and weighed as well:
 *
 *   stored draft is what was sent (same key, same words) → cleared.
 *   stored draft moved on, this box did not              → storage kept, and
 *                                                          the box adopts it,
 *                                                          so both tabs agree
 *                                                          with storage.
 *   stored draft moved on, and so did this box           → storage kept; the
 *                                                          box keeps its words
 *                                                          under a fresh key.
 *   stored draft is this box's own newer words           → rewritten under the
 *                                                          fresh key (R1).
 *   no stored draft (none, or storage refuses access)    → R1 exactly.
 *
 * An adopted draft keeps ITS request key. When that is the key this save just
 * used, the next save of the adopted words answers `request_key_conflict`, and
 * the composer's conflict strip offers them as a new entry — never a silent
 * duplicate, never a silent loss.
 */
export function settleStoredDraft(
  snapshot: SaveSnapshot,
  current: ComposerNow,
  stored: StoredDraft | null
): StoredDraftSettlement {
  const storedIsSent = stored !== null && stored.requestKey === snapshot.requestKey && sameWords(stored, snapshot)

  if (current.surface !== snapshot.surface) {
    // Nothing on screen is this answer's; the draft it came from is settled
    // on its own, as R1 did — but cleared only while it is still, exactly,
    // what was sent.
    const onSentKey = stored !== null && stored.requestKey === snapshot.requestKey
    return {
      box: 'ignore',
      mintNewKey: false,
      stored: storedIsSent ? 'clear' : onSentKey ? 'rekey' : 'keep',
      announce: 'ignored',
    }
  }

  const box = settleSave(snapshot, current)

  if (box.clear) {
    if (stored === null || storedIsSent) {
      return { box: 'clear', mintNewKey: false, stored: storedIsSent ? 'clear' : 'keep', announce: 'saved' }
    }
    // Storage moved on while this box did not: another tab's words. A box
    // that was emptied here stays empty, and the words stay in storage.
    if (current.text.trim() === '') {
      return { box: 'clear', mintNewKey: false, stored: 'keep', announce: 'saved' }
    }
    return { box: 'adopt', mintNewKey: false, stored: 'keep', announce: 'savedKeptNewer' }
  }

  const storedIsAnotherTabs = stored !== null && !storedIsSent && !sameWords(stored, current)
  return {
    box: 'keep',
    mintNewKey: box.mintNewKey,
    ...(box.text !== undefined ? { text: box.text } : {}),
    stored: storedIsAnotherTabs ? 'keep' : 'write',
    announce: 'savedKeptNewer',
  }
}

/**
 * The box after adopting a stored draft. `null` is "another tab emptied it,
 * or saved it": the box empties the way a save empties it. Otherwise every
 * field comes across — the request key included: a draft adopted without its
 * key would mint a new one on the next keystroke, and a retry of a save that
 * had landed would become a second entry.
 */
export function adoptDraft(stored: StoredDraft | null, current: ComposerNow): ComposerNow {
  if (stored === null) return { ...current, text: '', occurredOn: '', requestKey: null }
  return {
    text: stored.text,
    kind: stored.kind,
    occurredOn: stored.occurredOn ?? '',
    requestKey: stored.requestKey,
    surface: current.surface,
  }
}

/**
 * Does this tab take what another tab just wrote to this surface's draft?
 *
 * `focused` is somebody writing in THIS tab's box right now — the document
 * has focus and the textarea is its active element. Their own text wins, and
 * is written on their next keystroke. Otherwise the tab is idle and follows
 * storage, unless its box holds words storage did not have when the other tab
 * wrote over it (`previous`, the event's old value): adopting then would erase
 * the only copy of those words, so the box keeps them. An empty box has
 * nothing to lose.
 */
export function shouldAdoptStored(current: ComposerNow, focused: boolean, previous: StoredDraft | null): boolean {
  if (focused) return false
  if (current.text.trim() === '') return true
  return previous !== null && sameWords(current, previous)
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
  | { type: 'saved'; revision: number }
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

/**
 * This editor's own save landed as `revision` while the writer kept typing:
 * the words still in the editor are a further edit OF that revision, so the
 * base moves to it — to it and no further. Unlike `rebase`, a newer revision
 * the card has already been shown stays `latest`, so a colleague's edit that
 * arrived in the meantime still holds Save instead of being written over.
 */
export function savedAt(session: EditSession, revision: number): EditSession {
  return { base: revision, latest: Math.max(session.latest, revision), conflict: false }
}

/** Has the entry moved under this editor, as far as the card knows? */
export function isStale(session: EditSession): boolean {
  return session.conflict || session.latest > session.base
}

/** The same transitions, as a reducer for `useReducer`. `null` is "no editor
 *  open". */
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
      if (action.type === 'saved') return savedAt(state, action.revision)
      return rebase(state, action.revision)
  }
}

/* ———— an edit that comes back after the writer kept typing ———— */

/** What an entry editor holds: the fields its save sends. */
export interface EditDraft {
  title: string
  body: string
  kind: JournalKind
}

export interface EditSaveSettlement {
  /** Close the editor: it says what was saved. */
  close: boolean
  /** With `close: false`: the revision the editor's words now build on. */
  newBase?: number
  announce: 'saved' | 'savedKeptNewer'
}

/**
 * What an edit's `{ ok: true }` may do to the editor it came back to.
 *
 * The card's editor stays writable while Save is pending, like the composer's
 * box, and success used to close it — discarding every word typed after the
 * press. Now, as `settleSave` does for the composer:
 *
 *   the editor still says what was sent → close it ('saved').
 *   it says something newer             → keep it open with those words, on
 *                                         the revision the save produced — the
 *                                         save landed, and what is in the
 *                                         editor is a further edit of it
 *                                         ('savedKeptNewer').
 *
 * "The same" is what the save would write: the title and body trimmed (an
 * empty title is no title), and the kind.
 */
export function settleEditSave(snapshot: EditDraft, current: EditDraft, savedRevision: number): EditSaveSettlement {
  const unchanged =
    current.title.trim() === snapshot.title.trim() &&
    current.body.trim() === snapshot.body.trim() &&
    current.kind === snapshot.kind
  if (unchanged) return { close: true, announce: 'saved' }
  return { close: false, newBase: savedRevision, announce: 'savedKeptNewer' }
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
