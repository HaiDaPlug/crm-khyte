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
 *
 * A DRAFT IS IDENTIFIED BY ITS OWNER, NOT BY ITS TEXT. Every draft has its own
 * storage slot, named by its request key, and every tab remembers the key its
 * box holds (lib/journal/drafts.ts). The two bugs of Astra's third review were
 * both a rule comparing text across different drafts: an old save's answer
 * cut the sent words off the front of a new draft that merely began with them,
 * and two tabs' different words fought over one slot. So every rule below that
 * weighs one draft against another asks first whether they are the same draft
 * — the same request key — and only then compares words.
 *
 * THE INVARIANT every function below keeps, and tests/store.test.ts checks:
 * no rule ever removes from the box, or from storage, words that were typed in
 * this tab and not saved. Where a rule cannot tell, it keeps the words — back
 * under their own key when another tab removed the slot, under a fresh key
 * when another tab wrote different words into it — and accepts that a
 * near-duplicate draft is possible. Divergent drafts in two tabs end in two
 * slots, each owned by one tab.
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
   * The key the current draft carries — null only for an empty box. Required,
   * because it is what says whether the box still holds the draft a save sent
   * or another one: the box emptied and a sentence begun again while the save
   * was in flight, or a draft taken up from another tab.
   */
  requestKey: string | null
}

export type SaveAnnouncement = 'saved' | 'savedKeptNewer' | 'ignored'

export interface SaveSettlement {
  /**
   * Empty the box. The sent slot goes by `settleSentSlot`, and the box's own
   * slot with it while it holds exactly the box's words — never another tab's.
   */
  clear: boolean
  /** Keep the box, and give what is in it a key of its own. */
  mintNewKey: boolean
  /**
   * With `clear: false`: what the box should now hold. When the writer simply
   * kept typing after Save — the box still holds the sent draft, under the
   * sent key, and begins with exactly the words that were sent — the saved
   * words leave the box and only what came after them stays, the same as a
   * save whose answer arrived before the next keystroke. Absent, the whole
   * text stays: the sent words were edited rather than continued, or the box
   * holds another draft altogether.
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
 * between Save and the answer was erased by the answer. The cases now:
 *
 *   the box is on another surface now      → nothing on screen is this save's
 *                                            to touch ('ignored'); the caller
 *                                            settles only the slot the save
 *                                            came from (`settleSentSlot`).
 *   the box is empty                       → nothing in it to keep ('saved').
 *   the box holds ANOTHER draft — a key    → it is not this save's at all: its
 *   other than the one sent                  whole text stays, under its own
 *                                            key, whatever it begins with
 *                                            ('savedKeptNewer').
 *   the same draft, still what was sent    → it was saved; empty it ('saved').
 *   the same draft, typed on               → the sent words leave the box, the
 *                                            ones after them stay, and they get
 *                                            a new request key: the old key now
 *                                            belongs to a saved entry, and a
 *                                            retry on it would collide
 *                                            ('savedKeptNewer').
 *   the same draft, edited or reshaped     → kept whole, under a new key.
 *
 * THE KEY IS ASKED BEFORE THE TEXT. Round 2 compared words alone, so a box
 * that was emptied after Save and begun again with a sentence that happened
 * to start with the sent one ("Call Erik" sent; "Call Erik tomorrow" typed
 * fresh) was taken for a continuation, and the answer cut "Call Erik" off the
 * new draft — in the box and, on the next write, in storage. A draft with a
 * key of its own is somebody's new draft, and nothing about the old save may
 * shorten it.
 *
 * "The same words" is the text, trimmed — the saved entry is the trimmed
 * text, so a trailing space is not a newer draft — plus the kind and the
 * date.
 */
export function settleSave(snapshot: SaveSnapshot, current: ComposerNow): SaveSettlement {
  if (current.surface !== snapshot.surface) {
    return { clear: false, mintNewKey: false, announce: 'ignored' }
  }
  const text = current.text.trim()
  if (text === '') {
    return { clear: true, mintNewKey: false, announce: 'saved' }
  }
  if (current.requestKey !== snapshot.requestKey) {
    // Another draft. It keeps its key — a box that somehow has words and no
    // key is given one, since it cannot keep what it does not have.
    return { clear: false, mintNewKey: current.requestKey === null, announce: 'savedKeptNewer' }
  }
  const sameShape = current.kind === snapshot.kind && current.occurredOn === snapshot.occurredOn
  if (sameShape && text === snapshot.text.trim()) {
    return { clear: true, mintNewKey: false, announce: 'saved' }
  }
  // Kept typing, same kind and date: the saved sentence leaves the box and
  // what followed it stays — at any network speed, so a fast answer and a
  // slow one end in the same box. Nothing left after the sentence is a
  // settled save.
  const remainder = sameShape ? typedSince(snapshot.text, current.text) : null
  if (remainder === '') {
    return { clear: true, mintNewKey: false, announce: 'saved' }
  }
  return {
    clear: false,
    mintNewKey: true,
    ...(remainder !== null ? { text: remainder } : {}),
    announce: 'savedKeptNewer',
  }
}

/* ———— drafts in several tabs: one slot per draft, one owner per tab ———— */

/** The fields of a stored draft that a tab settles against and adopts. */
export type StoredDraft = Pick<JournalDraft, 'text' | 'kind' | 'occurredOn' | 'requestKey'>

/** The same words as a saved entry would read them: trimmed text, kind, date. */
function sameWords(
  a: { text: string; kind: JournalKind; occurredOn: string | null },
  b: { text: string; kind: JournalKind; occurredOn: string | null }
): boolean {
  return a.text.trim() === b.text.trim() && a.kind === b.kind && (a.occurredOn ?? '') === (b.occurredOn ?? '')
}

/**
 * What a save's `{ ok: true }` does to the slot under the key it SENT.
 *
 *   'clear'  the slot still holds the sent words under the sent key — they are
 *            an entry now — or it is already gone (nothing to do; a caller may
 *            treat 'clear' on a missing slot as a no-op).
 *   'keep'   it holds anything else. Somebody typed on under this key after
 *            the words left: another tab that shares it, or this box before
 *            its own settlement moves them. Those words are not the save's to
 *            erase. A later save of them on this consumed key answers
 *            `request_key_conflict`, and the composer's existing strip offers
 *            them as a new entry — never a silent duplicate, never a loss.
 *
 * The box is settled separately (`settleSave`). Round 2 also let the box take
 * over another tab's newer words here ('adopt'); that is gone. With a slot per
 * draft, the words belong to the tab that typed them, and the box that saved
 * simply clears.
 *
 * The same question answers any other letting-go of a slot — a box that was
 * emptied, a draft moved to a fresh key: pass what the box held under the old
 * key as the snapshot, and the slot is released only while it still holds
 * exactly that.
 */
export function settleSentSlot(snapshot: SaveSnapshot, stored: StoredDraft | null): 'clear' | 'keep' {
  if (stored === null) return 'clear'
  return stored.requestKey === snapshot.requestKey && sameWords(stored, snapshot) ? 'clear' : 'keep'
}

/**
 * The box after adopting a stored draft. `null` is "another tab emptied it,
 * or saved it": the box empties the way a save empties it. Otherwise every
 * field comes across — the request key included: a draft adopted without its
 * key would mint a new one on the next keystroke, and a retry of a save that
 * had landed would become a second entry. Whether the adopted box still holds
 * words typed in this tab is `followStorage`'s answer, not this function's.
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

/** A `storage` event on one of this surface's slots, resolved by `slotOf`. */
export interface StorageChange {
  /** The slot the other tab wrote or removed. */
  requestKey: string
  /** What the slot held before — the event's `oldValue`. */
  previous: StoredDraft | null
  /** What it holds now; null when the other tab removed it. */
  next: StoredDraft | null
}

/** The box as `followStorage` weighs it. */
export type FollowBox = ComposerNow & {
  /** The words include keystrokes made in THIS tab that no save has settled. */
  typedHere: boolean
  /**
   * With `typedHere`: the words this tab answers for — the box's text after
   * its last keystroke here, or after it last wrote its words back (a restore
   * or a fork). Not the box's text: after taking up another tab's
   * continuation, the box also holds that tab's words, which that tab may
   * still take back (a backspace) without this tab losing anything.
   */
  typedText: string
  /**
   * Request keys this box has finished with since it mounted on the surface:
   * the key a save sent once the answer came back, the key of a box that was
   * emptied, the old key of "save as a new entry" and of a fork. An empty box
   * never takes up a draft under one of them again — see `followStorage`.
   */
  letGo: ReadonlySet<string>
}

export type FollowAction =
  | { do: 'ignore' }
  /**
   * Put this draft in the box (null: empty it), key and all, with this
   * `typedHere`: false for a mirror or an empty box, true when the box's own
   * typed words are the start of the draft it takes — they are still in it.
   */
  | { do: 'adopt'; draft: StoredDraft | null; typedHere: boolean }
  /**
   * The box's own slot was removed, and its words stay: write them back under
   * the SAME key, `typedHere` unchanged. Same key, so a later Save of the same
   * words replays the entry the other tab filed instead of filing it twice,
   * and a Save of different words meets `request_key_conflict` and the strip.
   */
  | { do: 'restore' }
  /** Another tab wrote different words under the box's key: keep every word in
   *  the box, under a FRESH key, in a slot of its own. */
  | { do: 'fork' }

/**
 * What this tab does when another tab writes one of this surface's slots.
 *
 * `box.typedHere` is true when the words in the box include keystrokes made in
 * THIS tab that no save has settled — false for a mirror of storage.
 * `focused` is somebody writing in this box right now: the document has focus
 * AND the textarea is its active element (a background tab keeps its active
 * element).
 *
 * Round 2 had one slot per surface and one question — adopt or not — and both
 * answers could lose words: adopting over a box that had typed on wrote over
 * the only copy of its words, and not adopting left them in memory alone,
 * with storage holding the other tab's, so a reload lost them. Now the box
 * can also keep its words in storage itself: restored under its own key when
 * the slot is removed, forked to a fresh one when it is written with other
 * words. The rules, in order:
 *
 *   another slot, empty box, words in it,
 *   and not a key this box let go of        → adopt: an empty tab follows what
 *                                             another tab starts (a mirror).
 *   another slot, anything else             → ignore: another draft.
 *   this box's slot, removed (saved or
 *   emptied elsewhere):
 *     box empty                             → adopt nothing.
 *     a mirror, in step with the slot       → adopt nothing: its owner is
 *                                             finished with it.
 *     otherwise                             → restore, under the same key: the
 *                                             words were typed here, or storage
 *                                             never had them, and may be unsaved.
 *   this box's slot, written:
 *     box empty, or a mirror                → adopt: a mirror follows its source.
 *     idle, and the new words continue the
 *     words TYPED here (same kind and date,
 *     beginning with `typedText`)           → adopt, still typed here: nothing
 *                                             typed here is lost, and it is still
 *                                             in the box.
 *     otherwise                             → fork: this tab's words move to a
 *                                             fresh key, the other tab keeps the
 *                                             old one, and both survive a reload.
 *
 * WHY THE TYPED WORDS AND NOT THE BOX. A types "Call"; B types on to "Call
 * Erik", and A takes each keystroke up. Compared with A's box, B's backspace
 * ("Call Eri") no longer continued it, A forked "Call Erik" to a key the
 * server had never seen, and a Save there filed the entry B saved a second
 * time. Compared with what A typed, "Call Eri" still carries A's "Call" on:
 * B may take back its own words, and A just follows.
 *
 * WHY A REMOVAL RESTORES RATHER THAN FORKS, and why a let-go key is never
 * adopted. Tab A types "Call Erik"; tab B mirrors it and saves it; B's box
 * empties and B's save removes the slot. Forking kept A's words under a key
 * the server had never seen — and B, empty, adopted that fresh key as a new
 * draft: B showed "Call Erik" again, and every later Save in either tab filed
 * an identical entry. Emptying a mirror refilled it the same way. Restored
 * under the SAME key, A's words replay the filed entry when saved again, or
 * meet the conflict strip if edited; and B, having let that key go, does not
 * take it up again.
 *
 * A mirror "in step" is one whose words are the slot's old value — equal words
 * are not enough when they were typed here: another tab saving them is no
 * proof that this tab's copy was the one saved, and Astra's review named that
 * exact adoption as the listener erasing the last copy of a tab's words.
 */
export function followStorage(box: FollowBox, focused: boolean, change: StorageChange): FollowAction {
  const empty = box.text.trim() === ''
  const { next, previous } = change

  if (change.requestKey !== box.requestKey) {
    const followable = empty && next !== null && !box.letGo.has(change.requestKey)
    return followable ? { do: 'adopt', draft: next, typedHere: false } : { do: 'ignore' }
  }

  if (next === null) {
    if (empty) return { do: 'adopt', draft: null, typedHere: false }
    if (!box.typedHere && previous !== null && sameWords(box, previous)) {
      return { do: 'adopt', draft: null, typedHere: false }
    }
    return { do: 'restore' }
  }

  if (empty || !box.typedHere) return { do: 'adopt', draft: next, typedHere: false }
  if (!focused && continuesTyped(box, next)) return { do: 'adopt', draft: next, typedHere: true }
  return { do: 'fork' }
}

/**
 * Do the stored words carry on from the words typed in this tab — same kind
 * and date as the box, and beginning with `typedText`, compared trimmed the
 * way `settleSave` reads them? Adopting them then drops nothing typed here.
 * A typed box with no typed text recorded is judged by its whole text, the
 * stricter reading.
 */
function continuesTyped(box: FollowBox, next: StoredDraft): boolean {
  const mine = box.typedText.trim() !== '' ? box.typedText : box.text
  return (
    box.kind === next.kind &&
    box.occurredOn === (next.occurredOn ?? '') &&
    typedSince(mine.trim(), next.text.trim()) !== null
  )
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
