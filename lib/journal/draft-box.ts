import type { JournalEntryView, JournalKind } from './contracts'
import {
  adoptDraft,
  followStorage,
  reconcileOnMount,
  settleSave,
  settleSentSlot,
  typedSince,
  type ComposerNow,
  type SaveSnapshot,
} from './composer-state'
import {
  forgetOwnDraft,
  loadDraftFor,
  newRequestKey,
  ownDraft,
  ownDraftKey,
  parseDraft,
  readDraftSlot,
  rememberOwnDraft,
  removeDraftSlot,
  slotOf,
  sweepForeignDrafts,
  writeDraftSlot,
  type DraftStorage,
} from './drafts'

/**
 * One composer's draft, from mount to unmount: what the box holds, what it
 * writes to storage, and what it does with another tab's writes and with its
 * own save's answer.
 *
 * NO REACT, NO DOM — the same reasoning as ./drafts.ts. The rules are in
 * ./composer-state.ts; this is the choreography that carries them out against
 * storage, in the order that makes them lossless. It lived inside
 * components/journal/JournalComposer.tsx, where no test could run it, and the
 * suite drove a hand copy instead that had already drifted from it. Here the
 * suite drives this module itself, against fake storages, and the component
 * only renders what it answers and reads the DOM (focus) for it.
 *
 * ONE INSTANCE PER (organization, viewer, surface) ON SCREEN. The drawer
 * swapping from one prospect to another makes a new one and unmounts the old.
 * A save's answer that reaches an unmounted instance goes to the instance now
 * live for the same surface in this tab, when that box still holds the sent
 * draft (the drawer went away and came back mid-save): it settles there, and
 * tells its component through `listen`. Otherwise it settles only the slots
 * the save came from.
 *
 * WHAT IT REMEMBERS, and why each is state here rather than in React:
 *
 *   box        what the textarea shows, the key it holds, `typedHere`, and
 *              `typedText` (see `FollowBox`). Code after an await, and the
 *              `storage` listener between two renders, must see the box as
 *              it is now, not as a render last saw it (R1) — and the
 *              listener can re-key it (a fork).
 *   letGo      the keys this box has finished with since it mounted (see
 *              `FollowBox.letGo`): an empty box never takes one up again, so
 *              a draft it saved or emptied cannot come back to it.
 *   forkedFrom the key the box's words were forked from. A fork moves words off
 *              a key that the same words may already be, or later become,
 *              filed under; every Save of them goes to THAT key, edited or
 *              not, so the service replays the entry, files it once, or
 *              answers with the conflict strip — never files it twice under a
 *              key nobody else knew. Written into the slot with the words
 *              (`JournalDraft.forkedFrom`), so a reload, the drawer coming
 *              back, or another tab mirroring the slot sends it too. Kept
 *              across a refusal (the answer may be lost, not the write);
 *              dropped when the words are filed, emptied, or saved as a new
 *              entry. A later fork keeps the first origin.
 *   inFlight   the key of the save in flight. One save at a time.
 *   alias      the save in flight is about the box under another key: a fork
 *              re-keyed it mid-flight, or the save was sent under the fork's
 *              old key. The answer settles the box as the sent draft.
 *   alive      false after unmount.
 *
 * Every move of a draft to a new key writes the new slot first and releases
 * the old one only when that write went through; every removal is a release,
 * which takes a slot only while it still holds exactly the words being let go
 * (`settleSentSlot`).
 */

/** What the component renders. */
export interface BoxView {
  text: string
  kind: JournalKind
  occurredOn: string
}

export interface DraftBoxOptions {
  organizationId: string
  userId: string
  surface: string
  /** `localStorage` when omitted. */
  storage?: DraftStorage
  /** `sessionStorage` when omitted. */
  session?: DraftStorage
  /** The `updatedAt` stamp of each write. Real time unless a test says otherwise. */
  now?: () => string
}

/** A save, begun: what to send, and what the answer will be about. */
export interface SaveStart {
  key: string
  body: string
  sent: SaveSnapshot
}

/** A save's `{ ok: true }`, settled: what to show and what to announce. */
export interface SaveResult {
  view: BoxView
  status: 'saved' | 'savedKeptNewer'
}

/** Any other answer: the error, and the entry a `request_key_conflict` names. */
export interface Refusal {
  error: string
  existing: JournalEntryView | null
}

/**
 * An answer handed to the box on screen by an instance unmounted mid-save —
 * what the component shows exactly as it shows its own box's answers.
 */
export type HandedOver = { saved: SaveResult } | { refused: Refusal }

type Box = ComposerNow & { typedHere: boolean; typedText: string }

const EMPTY: BoxView = { text: '', kind: 'update', occurredOn: '' }

/**
 * The instance on screen for each (organization, viewer, surface), per tab.
 * A tab is its sessionStorage: in a browser there is one per module instance
 * anyway, and a test that drives several tabs in one process hands each its
 * own session, so one tab's answer never reaches another tab's box.
 */
const onScreen = new WeakMap<object, Map<string, DraftBox>>()
const DEFAULT_SESSION = {}

function screenOf(session: DraftStorage | undefined): Map<string, DraftBox> {
  const tab = session ?? DEFAULT_SESSION
  let screen = onScreen.get(tab)
  if (!screen) {
    screen = new Map()
    onScreen.set(tab, screen)
  }
  return screen
}

export class DraftBox {
  private readonly org: string
  private readonly user: string
  private readonly surface: string
  private readonly storage?: DraftStorage
  private readonly session?: DraftStorage
  private readonly now: () => string
  private current: Box
  private readonly letGo = new Set<string>()
  /** The key the box's words were forked from — see `JournalDraft.forkedFrom`. */
  private forkedFrom: string | null = null
  private inFlight: string | null = null
  private alias: { from: string; to: string } | null = null
  private isAlive = false
  private listener: ((handedOver: HandedOver) => void) | null = null

  constructor(options: DraftBoxOptions) {
    this.org = options.organizationId
    this.user = options.userId
    this.surface = options.surface
    this.storage = options.storage
    this.session = options.session
    this.now = options.now ?? (() => new Date().toISOString())
    this.current = { ...EMPTY, surface: options.surface, requestKey: null, typedHere: false, typedText: '' }
  }

  /**
   * Hears an answer handed to this box by an instance that was unmounted
   * mid-save (see the header). Returns the unsubscribe.
   */
  listen(listener: (handedOver: HandedOver) => void): () => void {
    this.listener = listener
    return () => {
      if (this.listener === listener) this.listener = null
    }
  }

  private get screenKey(): string {
    return `${this.org}:${this.user}:${this.surface}`
  }

  /** The box as it is now. */
  get box(): Readonly<Box> {
    return this.current
  }

  /** Whether this instance is still the one on screen. */
  get alive(): boolean {
    return this.isAlive
  }

  /**
   * On mount, and on StrictMode's second mount: drop any other identity's
   * leftovers and load this tab's own draft for the surface. What this tab
   * remembers of it (`ownDraft`, with its own copy of the words) is weighed
   * against the shared slot by `reconcileOnMount` — the rules the live
   * listener applies, for whatever happened while this composer was not
   * mounted. A tab that owns nothing takes the newest slot as a mirror. The
   * box is reset whether or not a draft is found: a prospect with nothing
   * written about it must not inherit the sentence somebody was mid-way
   * through on the previous one.
   */
  mount(): BoxView {
    this.isAlive = true
    screenOf(this.session).set(this.screenKey, this)
    this.letGo.clear()
    this.inFlight = null
    this.alias = null
    sweepForeignDrafts(this.org, this.user, this.storage, this.session)
    const owned = ownDraft(this.org, this.user, this.surface, this.session)
    const slot = owned ? readDraftSlot(this.org, this.user, this.surface, owned.requestKey, this.storage) : null
    const decision = reconcileOnMount(owned, slot)

    if (decision.do === 'fallback' || owned === null) {
      const draft = loadDraftFor(this.org, this.user, this.surface, this.storage, this.session)
      this.forkedFrom = draft?.forkedFrom ?? null
      return this.show(
        {
          text: draft?.text ?? '',
          kind: draft?.kind ?? 'update',
          occurredOn: draft?.occurredOn ?? '',
          surface: this.surface,
          requestKey: draft?.requestKey ?? null,
        },
        false
      )
    }

    if (decision.do === 'show' && slot !== null) {
      // The fork origin travels with the words, whoever holds them now.
      this.forkedFrom = slot.forkedFrom ?? null
      const view = this.show(
        { text: slot.text, kind: slot.kind, occurredOn: slot.occurredOn ?? '', surface: this.surface, requestKey: slot.requestKey },
        decision.typedHere,
        decision.typedHere ? owned.typedText : ''
      )
      this.claim()
      return view
    }

    // Restore or fork: the tab's own copy comes back, typed, with its kind,
    // date and origin — under its own key when the slot is gone, under a fresh
    // one (the old key its origin) when another tab wrote other words there.
    const copy = owned.snapshot!
    const fork = decision.do === 'fork'
    const key = fork ? newRequestKey() : owned.requestKey
    this.forkedFrom = copy.forkedFrom ?? (fork ? owned.requestKey : null)
    if (fork) this.letGo.add(owned.requestKey)
    const view = this.show(
      { text: copy.text, kind: copy.kind, occurredOn: copy.occurredOn ?? '', surface: this.surface, requestKey: key },
      true,
      owned.typedText
    )
    this.file(this.current)
    this.claim()
    return view
  }

  unmount(): void {
    this.isAlive = false
    const screen = screenOf(this.session)
    if (screen.get(this.screenKey) === this) screen.delete(this.screenKey)
  }

  /** A keystroke, or a new kind or date. */
  change(next: { text?: string; kind?: JournalKind; occurredOn?: string }): BoxView {
    const before = this.current
    const text = next.text ?? before.text
    const kind = next.kind ?? before.kind
    const occurredOn = next.occurredOn ?? before.occurredOn

    if (!text.trim()) {
      // An emptied box has no draft to keep. The key goes with it — the next
      // sentence is a different entry and deserves its own — and so does its
      // slot, while it holds what this box held: a tab that typed on under
      // the same key keeps its words.
      if (before.requestKey) {
        this.release({ ...before, requestKey: before.requestKey })
        this.letGo.add(before.requestKey)
      }
      this.forkedFrom = null
      forgetOwnDraft(this.org, this.user, this.surface, this.session)
      return this.show({ text, kind, occurredOn, surface: this.surface, requestKey: null }, false)
    }

    const key = before.requestKey ?? newRequestKey()
    const view = this.show({ text, kind, occurredOn, surface: this.surface, requestKey: key }, true)
    this.claim()
    this.file(this.current)
    return view
  }

  /**
   * Another tab wrote or removed a key. Returns the box to show when it
   * adopted a draft, or null when what is on screen did not change.
   *
   * `followStorage` decides; here it is carried out. A restore writes the
   * box's words back under the same key. A fork moves them to a fresh key and
   * a slot of their own, written at once because until then the other tab's
   * write has left them in this tab's memory alone — and, when the key it
   * leaves is the one a save in flight sent, records the alias the answer
   * will need (`settleOk`).
   */
  onStorage(key: string | null, oldValue: string | null, newValue: string | null, focused: boolean): BoxView | null {
    if (!this.isAlive || key === null) return null
    const requestKey = slotOf(key, this.org, this.user, this.surface)
    if (requestKey === null) return null
    const next = parseDraft(newValue)
    // A value that is there but is not a draft is nothing to adopt.
    if (newValue !== null && next === null) return null

    const now = this.current
    const action = followStorage({ ...now, letGo: this.letGo }, focused, {
      requestKey,
      previous: parseDraft(oldValue),
      next,
    })

    if (action.do === 'ignore') return null

    if (action.do === 'adopt') {
      const adopted = adoptDraft(action.draft, now)
      // The fork origin travels with the words: the adopted draft's, or this
      // box's own when the draft only carries this box's words on.
      this.forkedFrom = action.draft === null ? null : next?.forkedFrom ?? (action.typedHere ? this.forkedFrom : null)
      // Still typed here: the words typed here are unchanged, and still the
      // start of the box.
      const view = this.show(adopted, action.typedHere, action.typedHere ? now.typedText : '')
      if (adopted.requestKey) this.claim()
      else forgetOwnDraft(this.org, this.user, this.surface, this.session)
      return view
    }

    if (action.do === 'restore') {
      // Written back, the whole box is this tab's to answer for now: the tab
      // whose continuation it took up has let go of it.
      this.show(now, now.typedHere)
      this.file(this.current)
      this.claim()
      return null
    }

    // Fork. The origin is recorded BEFORE the fork slot is written, so the
    // slot carries it and every later holder of these words — this tab after
    // a reload, another tab mirroring the slot — sends its Save to the key
    // they left. A first record is kept: the key the words came from first is
    // the one they may be filed under.
    const left = now.requestKey
    const fresh = newRequestKey()
    if (left && this.forkedFrom === null) this.forkedFrom = left
    this.show({ ...now, requestKey: fresh }, now.typedHere)
    this.file(this.current)
    this.claim()
    if (left) {
      this.letGo.add(left)
      if (this.inFlight !== null && (left === this.inFlight || this.alias?.to === left)) {
        this.alias = { from: this.inFlight, to: fresh }
      }
    }
    return null
  }

  /**
   * Save pressed. Null when there is nothing to send, this instance is gone,
   * or a save is already in flight.
   *
   * The key is part of the draft, not of this attempt, and it names the
   * draft's slot. "Save as a new entry" (`freshKey`) therefore MOVES the
   * draft: written to its new slot before the await, because the await is
   * where the tab can be lost; the old slot released only once that write
   * went through, and only while it still holds these words; the new key
   * remembered as this tab's own. Minting a key and leaving the stored draft
   * on the old one would bring a reload back to the key that already
   * collided — and it would collide again, for ever.
   */
  beginSave(options: { freshKey?: boolean } = {}): SaveStart | null {
    if (!this.isAlive || this.inFlight !== null) return null
    const before = this.current
    const body = before.text.trim()
    if (!body) return null

    // Words a fork moved: EVERY Save goes to the key they left, edited or not,
    // with the box and its slot staying where they are (the alias). Unchanged
    // words are then replayed or filed once; edited ones meet the conflict
    // strip if that key already holds an entry — the worst case is a question,
    // never the sentence filed a second time under a key nobody else knew.
    const origin = this.forkedFrom
    if (!options.freshKey && origin !== null && before.requestKey !== null && origin !== before.requestKey) {
      this.inFlight = origin
      this.alias = { from: origin, to: before.requestKey }
      return {
        key: origin,
        body,
        sent: { text: before.text, kind: before.kind, occurredOn: before.occurredOn, requestKey: origin, surface: this.surface },
      }
    }

    // "Save as a new entry" is a decision to leave the origin behind; the
    // slot written for it carries none. On forked words the new entry's key
    // is the fork's own, which every holder of those words shares: the first
    // to press it files them there, and the others' "save as new" replays that
    // entry or meets the strip — only then minting a truly fresh key. Each
    // minting its own would file the same words once per holder.
    const sharedFork =
      options.freshKey === true && this.forkedFrom !== null && before.requestKey !== null && this.forkedFrom !== before.requestKey
    if (options.freshKey) this.forkedFrom = null
    if (sharedFork) {
      // The key stays, so nothing below re-claims it: the tab's own copy must
      // drop the origin too, or a later mount would restore it.
      this.file(before)
      this.claim()
    }
    const key = sharedFork ? before.requestKey! : options.freshKey ? newRequestKey() : before.requestKey ?? newRequestKey()
    if (key !== before.requestKey) {
      const filed = this.file({ ...before, requestKey: key })
      if (before.requestKey) {
        if (filed) this.release({ ...before, requestKey: before.requestKey })
        this.letGo.add(before.requestKey)
      }
      this.show({ ...before, requestKey: key }, before.typedHere, before.typedText)
      this.claim()
    }

    this.inFlight = key
    this.alias = null
    return {
      key,
      body,
      // Frozen here: what the answer is an answer ABOUT.
      sent: { text: before.text, kind: before.kind, occurredOn: before.occurredOn, requestKey: key, surface: this.surface },
    }
  }

  /**
   * The save's `{ ok: true }`: the box to show and the status to announce.
   *
   * Null when this instance is gone. The box now on screen for the surface in
   * this tab settles the answer instead when it still holds the sent draft
   * (`heirFor`), and tells its component through `listen`. Otherwise only the
   * slots the save came from are settled — the sent one, and the fork's while
   * it holds exactly the sent words — and this tab's own copy of the draft is
   * forgotten, its slot with it, when it is exactly the acknowledged words.
   */
  settleOk(sent: SaveSnapshot): SaveResult | null {
    const alias = this.alias
    this.inFlight = null
    this.alias = null
    if (this.isAlive) return this.settle(sent, alias)

    const found = this.heirFor(sent, alias)
    if (found) {
      const result = found.heir.settle(sent, found.alias)
      if (result) found.heir.listener?.({ saved: result })
      return null
    }

    const aliasTo = alias !== null && alias.from === sent.requestKey ? alias.to : null
    this.release(sent)
    if (aliasTo !== null) this.release({ ...sent, requestKey: aliasTo })

    // This tab's own copy of the draft, which the next mount would restore —
    // under the sent key, the fork's in flight, or a key the mount forked it
    // to from the sent one. When it holds the words just acknowledged, perhaps
    // with a full stop or a space after them (the rule `settle` applies to a
    // live box), its slot is released while it holds exactly them and the
    // record forgotten, so a saved sentence does not come back. A copy that
    // carries on past them is kept — on return it restores or forks, and its
    // Save meets the origin, replay and strip rules. A record from an earlier
    // build, with no copy, goes when its slot went.
    const owned = ownDraft(this.org, this.user, this.surface, this.session)
    const copy = owned?.snapshot ?? null
    const matches =
      owned !== null &&
      (owned.requestKey === sent.requestKey || owned.requestKey === aliasTo || copy?.forkedFrom === sent.requestKey)
    if (owned !== null && matches) {
      const words =
        copy === null
          ? null
          : { ...sent, text: copy.text, kind: copy.kind, occurredOn: copy.occurredOn ?? '', requestKey: owned.requestKey }
      const acknowledged =
        words === null
          ? readDraftSlot(this.org, this.user, this.surface, owned.requestKey, this.storage) === null
          : words.kind === sent.kind &&
            words.occurredOn === sent.occurredOn &&
            typedSince(sent.text.trim(), words.text.trim()) === ''
      if (acknowledged) {
        if (words !== null) this.release(words)
        forgetOwnDraft(this.org, this.user, this.surface, this.session)
      }
    }
    return null
  }

  /**
   * The box on screen for this surface in this tab that an answer reaching
   * this unmounted instance belongs to, and the alias to settle it with — or
   * null. It must hold the sent draft under the sent key, the key a fork in
   * flight moved it to, or a key forked from the sent one (the mount forked
   * this tab's copy away from a slot another tab rewrote), AND its words must
   * be the sent words or carry them on (same kind and date). The key alone is
   * not enough: another tab may have rewritten the slot while the drawer was
   * away, and settling the answer against those words would take them for
   * this tab's own edit.
   */
  private heirFor(
    sent: SaveSnapshot,
    alias: { from: string; to: string } | null
  ): { heir: DraftBox; alias: { from: string; to: string } | null } | null {
    const heir = screenOf(this.session).get(this.screenKey)
    if (!heir || heir === this || !heir.isAlive) return null
    const box = heir.current
    const aliasTo = alias !== null && alias.from === sent.requestKey ? alias.to : null
    const forkedFromSent = heir.forkedFrom === sent.requestKey
    if (box.requestKey === null) return null
    if (box.requestKey !== sent.requestKey && box.requestKey !== aliasTo && !forkedFromSent) return null
    const carriesOn =
      box.kind === sent.kind &&
      box.occurredOn === sent.occurredOn &&
      typedSince(sent.text.trim(), box.text.trim()) !== null
    if (!carriesOn) return null
    return { heir, alias: box.requestKey === sent.requestKey ? alias : { from: sent.requestKey, to: box.requestKey } }
  }

  private settle(sent: SaveSnapshot, alias: { from: string; to: string } | null): SaveResult | null {
    // The sent slot first, whatever the box shows now: it goes only while it
    // holds the sent words, which are an entry. Anything else in it was typed
    // on under that key after they left — by another tab, whose words they
    // are, or by this box, whose own words are moved below.
    this.release(sent)
    this.letGo.add(sent.requestKey)

    const now = this.current
    // The save is about the box under another key — a fork re-keyed it in
    // flight, or it was sent under the key a fork left: the box is still the
    // draft that was sent, and settles as it.
    const aliased = alias !== null && alias.from === sent.requestKey && now.requestKey === alias.to
    const settled = settleSave(sent, aliased ? { ...now, requestKey: sent.requestKey } : now)
    if (settled.announce === 'ignored') return null

    // Words after (or instead of) the sent ones become this box's own draft
    // only when they were typed HERE. A box that mirrors, or took up, what
    // another tab typed after the sent sentence has nothing of its own left:
    // it clears as saved, and those words stay with the tab that typed them,
    // in that tab's slot, where its own Save meets the strip — never copied
    // into a second draft here that a Save would file without a question.
    const typedOnHere =
      now.typedHere && (settled.text === undefined || Boolean(typedSince(sent.text.trim(), now.typedText.trim())))
    const othersOnly = !settled.clear && settled.mintNewKey && now.requestKey !== null && !typedOnHere

    if (settled.clear || othersOnly) {
      // The box's own slot goes as well, while it holds exactly the box's
      // words: they are the sent words, perhaps with a full stop or a space
      // typed after them (`typedSince`), perhaps under the alias key. Left,
      // a reload would bring the saved sentence back under a used key. Not
      // when the rest is another tab's: that slot is theirs.
      if (now.requestKey) {
        if (settled.clear) this.release({ ...now, requestKey: now.requestKey })
        this.letGo.add(now.requestKey)
      }
      const own = ownDraftKey(this.org, this.user, this.surface, this.session)
      if (own !== null && (own === sent.requestKey || own === now.requestKey)) {
        forgetOwnDraft(this.org, this.user, this.surface, this.session)
      }
      // Filed: no fork origin can send these words anywhere again.
      this.forkedFrom = null
      return { view: this.show({ ...now, text: '', occurredOn: '', requestKey: null }, false), status: 'saved' }
    }

    if (settled.mintNewKey || !now.requestKey) {
      // The writer kept going on the draft they sent. What they sent is an
      // entry now; what they wrote since is still theirs, with its kind and
      // date, under a key and slot of its own — the old key belongs to the
      // saved entry. When they simply kept typing, the saved sentence leaves
      // the box (`settled.text`); an edited one stays whole. Still typed here
      // and unsaved, so `typedHere` stays: nothing may adopt over them. The
      // fork origin went with the filed words; the new slot carries none.
      this.forkedFrom = null
      const fresh = newRequestKey()
      const kept: ComposerNow = { ...now, text: settled.text ?? now.text, requestKey: fresh }
      const filed = this.file(kept)
      if (now.requestKey) {
        if (filed) this.release({ ...now, requestKey: now.requestKey })
        this.letGo.add(now.requestKey)
      }
      const view = this.show(kept, now.typedHere)
      this.claim()
      return { view, status: 'savedKeptNewer' }
    }

    // Another draft altogether — emptied and begun again, or taken up from
    // another tab. Nothing of it was sent: it stays whole, under its own key,
    // in its own slot as it already is, with its own fork origin, if any.
    const view = this.show(now, now.typedHere, now.typedText)
    this.claim()
    return { view, status: 'savedKeptNewer' }
  }

  /**
   * Any other answer. The words and the slot stay exactly as they are, for a
   * Retry or "save as a new entry" — and so does the fork origin: an answer
   * that was lost is not a write that failed, and a Retry must go back to the
   * key the words may already be filed under.
   *
   * True when this instance is on screen: the component shows the refusal.
   * False when it is gone. The box now on screen for the surface then hears
   * the refusal through `listen` when it holds the sent draft (`heirFor`) —
   * the drawer went away and came back, and the error line with its Retry,
   * or the conflict strip, belongs to it. Otherwise nothing is said: a
   * refusal about a draft no longer on screen is not said over another one.
   */
  settleRefused(sent: SaveSnapshot, refusal: Refusal): boolean {
    const alias = this.alias
    this.inFlight = null
    this.alias = null
    if (this.isAlive) return true
    this.heirFor(sent, alias)?.heir.listener?.({ refused: refusal })
    return false
  }

  /** `typedText` defaults to the box's text when typed here — a keystroke, a
   *  fork, a settlement — and to nothing for a mirror. */
  private show(box: ComposerNow, typedHere: boolean, typedText = typedHere ? box.text : ''): BoxView {
    this.current = { ...box, surface: this.surface, typedHere, typedText }
    return { text: box.text, kind: box.kind, occurredOn: box.occurredOn }
  }

  /**
   * Writes the box's words to the slot its key names, with the fork origin
   * while one is recorded; true when it went through.
   */
  private file(box: ComposerNow): boolean {
    if (!box.requestKey) return false
    return writeDraftSlot(
      this.org,
      this.user,
      this.surface,
      {
        text: box.text,
        requestKey: box.requestKey,
        kind: box.kind,
        occurredOn: box.occurredOn || null,
        updatedAt: this.now(),
        ...(this.forkedFrom !== null ? { forkedFrom: this.forkedFrom } : {}),
      },
      this.storage
    )
  }

  /** Removes the slot `words.requestKey` names, only while it holds exactly `words`. */
  private release(words: SaveSnapshot): void {
    const stored = readDraftSlot(this.org, this.user, words.surface, words.requestKey, this.storage)
    if (settleSentSlot(words, stored) === 'clear') {
      removeDraftSlot(this.org, this.user, words.surface, words.requestKey, this.storage)
    }
  }

  /**
   * Records the box's key as this tab's own, with the words typed here — so a
   * reload knows which words are this tab's, and which are a mirror.
   */
  private claim(): void {
    const { requestKey, typedHere, typedText, text, kind, occurredOn } = this.current
    if (!requestKey) return
    // With this tab's own copy of the draft, for a mount that finds the shared
    // slot emptied or rewritten while nothing here was live (`reconcileOnMount`).
    rememberOwnDraft(this.org, this.user, this.surface, requestKey, this.session, typedHere ? typedText : '', {
      text,
      kind,
      occurredOn: occurredOn || null,
      ...(this.forkedFrom !== null ? { forkedFrom: this.forkedFrom } : {}),
    })
  }
}
