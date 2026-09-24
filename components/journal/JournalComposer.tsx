'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/crm/Button'
import { useCRMStore } from '@/lib/store'
import { useTranslations } from '@/lib/hooks/useTranslations'
import { cn } from '@/lib/utils'
import { useJournalTyping } from './JournalSync'
import {
  JOURNAL_KINDS,
  MAX_TEXT_LENGTH,
  type CreateEntryInput,
  type JournalEntryView,
  type JournalKind,
  type LinkTarget,
} from '@/lib/journal/contracts'
import {
  clearDraft,
  draftKey,
  newRequestKey,
  parseDraft,
  readDraft,
  sweepForeignDrafts,
  writeDraft,
  type JournalSurface,
} from '@/lib/journal/drafts'
import {
  adoptDraft,
  isIdentityRefusal,
  settleStoredDraft,
  shouldAdoptStored,
  type ComposerNow,
  type SaveSnapshot,
} from '@/lib/journal/composer-state'

interface JournalComposerProps {
  /** Which draft this box owns. One per place a composer appears. */
  surface: JournalSurface
  /**
   * What this box is writing about, when it is not the whole organization:
   * the links every entry from here carries, and the name to say so with.
   */
  context?: { links: LinkTarget[]; label: string }
  /** Name the organization in the header — the two global surfaces do. */
  showOrganization?: boolean
  /** The feed this box sits above, so a new entry lands in it immediately. */
  viewKey?: string
  className?: string
}

/**
 * The box somebody writes in.
 *
 * ITS ONE PROMISE: text that has been typed is not lost. Not by a failed save,
 * not by a reload, not by closing the tab, and not by a save that succeeds
 * while the writer is still typing. Every branch below is that promise — the
 * draft is written to storage on each keystroke, the request key is minted
 * once and reused so a retry cannot become a second entry, and the draft is
 * cleared on exactly one result, `{ ok: true }`, and then only when the stored
 * draft still holds exactly what was sent. A save that fails, is refused, or
 * collides keeps the words on screen and in storage.
 *
 * THE STORED DRAFT IS SHARED by every tab open on the same surface (see
 * lib/journal/drafts.ts). So a save's answer is settled against storage as
 * well as against this box — another tab may have written newer words into
 * the draft meanwhile — and a tab nobody is writing in follows what the others
 * write, through the `storage` event, rather than sitting on the words it
 * loaded with.
 *
 * THE TEXTAREA STAYS WRITABLE DURING A SAVE, deliberately — a thought does not
 * wait for a round-trip. So what was sent is frozen at the press (a
 * `SaveSnapshot`) and the answer is weighed against what the box holds when
 * it arrives, never against the closure's copy (`settleSave` in
 * lib/journal/composer-state.ts decides; this file only carries it out).
 *
 * THE FIVE ANSWERS a save can come back with, and what each looks like here:
 *
 *   ok                   the entry is filed. If the box still says what was
 *                        sent, it empties and the status line says "Saved" —
 *                        unless another tab has written newer words into the
 *                        stored draft, which the box then takes up instead.
 *                        If the box says something newer, the newer words
 *                        stay, get a key of their own, and the line says the
 *                        earlier text was saved. If the drawer has moved on
 *                        to another prospect, the box is left alone and only
 *                        the draft the save came from is settled.
 *   request_key_conflict this key already belongs to different text — the save
 *                        did land once, and then the text changed. The entry
 *                        it produced comes back so the box can point at it,
 *                        and "save as a new entry" mints a fresh key for what
 *                        is in the box now. Never silently duplicated.
 *   unavailable          there is no database (decision 12). Said plainly,
 *                        with the text kept, rather than a cheerful "Saved".
 *   context_mismatch     the cookie now names somebody else — or, answered as
 *   / unauthorized       `unauthorized`, the session or membership ended. The
 *                        ONE answer that does not keep the text: the store
 *                        has already dropped this identity's drafts and the
 *                        page is reloading. A sentence, and no Retry to press.
 *   anything else        inline error and Retry, text kept — including a
 *                        Server Action that REJECTED rather than answering,
 *                        which the store hands over in this same shape. The
 *                        same key is reused, so a retry of a save that
 *                        actually landed comes back as the original entry.
 *
 * `journalTyping` is set while this box has focus or within five seconds of a
 * keystroke, which is what keeps the twelve-second poller from re-rendering
 * the feed underneath a half-written sentence. It does NOT pause the CRM
 * snapshot sync — see the store.
 */
export function JournalComposer({
  surface,
  context,
  showOrganization,
  viewKey,
  className,
}: JournalComposerProps) {
  const { t } = useTranslations()
  const copy = t.crm.journal

  const submitCapture = useCRMStore((s) => s.submitCapture)
  const organizationId = useCRMStore((s) => s.workspace.organization.id)
  const organizationName = useCRMStore((s) => s.workspace.organization.name)
  const userId = useCRMStore((s) => s.workspace.viewer.userId)

  const fieldId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [text, setText] = useState('')
  const [kind, setKind] = useState<JournalKind>('update')
  const [occurredOn, setOccurredOn] = useState('')
  /** Minted on the first keystroke, kept until a save succeeds. */
  const [requestKey, setRequestKey] = useState<string | null>(null)
  const [status, setStatus] = useState<
    'idle' | 'saving' | 'saved' | 'savedKeptNewer' | 'error' | 'unavailable' | 'conflict' | 'signedOut'
  >('idle')
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<JournalEntryView | null>(null)

  /**
   * What the box holds right now, for code that runs after an await.
   *
   * `save` is a closure over the render it started in, so after the network
   * its `text` is the text at the press, and its `surface` is the prospect the
   * drawer showed then. The answer has to be weighed against the box as it is
   * when the answer arrives — that is the whole of R1 — so every write to the
   * box writes here too, and the surface flips in the same effect that swaps
   * the draft on screen.
   */
  const live = useRef<ComposerNow>({ text: '', kind: 'update', occurredOn: '', surface, requestKey: null })

  /* ———— the draft ———— */

  // On mount, and whenever the surface changes underneath this box — the
  // drawer swapping from one prospect to another reuses the same component —
  // drop any other identity's leftovers and load this surface's own draft.
  //
  // The box is reset unconditionally, not only when a draft is found: a
  // prospect with nothing written about it must not inherit the sentence
  // somebody was mid-way through on the previous one. The sweep is keyed by
  // organization and viewer, so it can only ever remove somebody else's keys.
  useEffect(() => {
    sweepForeignDrafts(organizationId, userId)
    const draft = readDraft(organizationId, userId, surface)
    setText(draft?.text ?? '')
    setKind(draft?.kind ?? 'update')
    setOccurredOn(draft?.occurredOn ?? '')
    setRequestKey(draft?.requestKey ?? null)
    live.current = {
      text: draft?.text ?? '',
      kind: draft?.kind ?? 'update',
      occurredOn: draft?.occurredOn ?? '',
      surface,
      requestKey: draft?.requestKey ?? null,
    }
    setStatus('idle')
    setError(null)
    setConflict(null)
  }, [organizationId, userId, surface])

  /** Puts a whole draft in the box — and in `live` — in one step. */
  const show = useCallback((draft: ComposerNow) => {
    setText(draft.text)
    setKind(draft.kind)
    setOccurredOn(draft.occurredOn)
    setRequestKey(draft.requestKey ?? null)
    live.current = draft
  }, [])

  // Another tab on this surface writes the same stored draft. While nobody is
  // writing in this box, it follows along — text, kind, date and request key —
  // so a tab left open shows what was typed elsewhere instead of the words it
  // loaded with, which a Save or a keystroke from here would otherwise write
  // back over the newer ones. A box somebody is writing in ignores the event:
  // their own text wins, and is written on their next keystroke. "Writing in"
  // is the document having focus AND the textarea being its active element; a
  // background tab keeps its active element, and would otherwise never follow.
  // `storage` fires only in the OTHER tabs of this origin, never the writer.
  useEffect(() => {
    const key = draftKey(organizationId, userId, surface)
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return
      const next = parseDraft(event.newValue)
      // A value that is there but is not a draft is nothing to adopt.
      if (event.newValue !== null && next === null) return
      const focused = document.hasFocus() && document.activeElement === textareaRef.current
      if (!shouldAdoptStored(live.current, focused, parseDraft(event.oldValue))) return
      show(adoptDraft(next, live.current))
      setStatus((current) => (current === 'saved' || current === 'savedKeptNewer' ? 'idle' : current))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [organizationId, userId, surface, show])

  const grow = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [])

  useEffect(grow, [grow, text])

  /* ———— typing ———— */

  // Shared with the card's inline editor — see components/journal/JournalSync.
  const { hold: holdPoller, release: releasePoller } = useJournalTyping()

  /* ———— writing ———— */

  const change = (next: { text?: string; kind?: JournalKind; occurredOn?: string }) => {
    const value = next.text ?? text
    const nextKind = next.kind ?? kind
    const nextOn = next.occurredOn ?? occurredOn
    if (next.text !== undefined) setText(next.text)
    if (next.kind !== undefined) setKind(next.kind)
    if (next.occurredOn !== undefined) setOccurredOn(next.occurredOn)
    holdPoller()
    // The status line stops claiming "Saved" the moment the box is not empty
    // again, so a fresh sentence is never sitting under somebody else's
    // confirmation.
    if (status === 'saved' || status === 'savedKeptNewer') setStatus('idle')

    if (!value.trim()) {
      // An emptied box has no draft to keep. The key goes with it: the next
      // sentence is a different entry and deserves its own.
      clearDraft(organizationId, userId, surface)
      setRequestKey(null)
      live.current = { text: value, kind: nextKind, occurredOn: nextOn, surface, requestKey: null }
      return
    }
    const key = requestKey ?? newRequestKey()
    if (!requestKey) setRequestKey(key)
    live.current = { text: value, kind: nextKind, occurredOn: nextOn, surface, requestKey: key }
    writeDraft(organizationId, userId, surface, {
      text: value,
      requestKey: key,
      kind: nextKind,
      occurredOn: nextOn || null,
    })
  }

  const save = async (options: { freshKey?: boolean } = {}) => {
    const body = text.trim()
    if (!body || status === 'saving') return

    const key = options.freshKey ? newRequestKey() : requestKey ?? newRequestKey()
    setRequestKey(key)
    live.current = { ...live.current, requestKey: key }
    if (key !== requestKey) {
      // The key is part of the draft, not of this attempt. Minting one into
      // component state and leaving the stored draft on the old one means a
      // reload after a failed "save as a new entry" comes back holding the
      // key that already collided — and collides again, for ever. Written
      // before the await, because the await is where the tab can be lost.
      writeDraft(organizationId, userId, surface, {
        text: body,
        requestKey: key,
        kind,
        occurredOn: occurredOn || null,
      })
    }
    setStatus('saving')
    setError(null)
    setConflict(null)

    // Frozen here: what the answer below is an answer ABOUT.
    const sent: SaveSnapshot = { text, kind, occurredOn, requestKey: key, surface }

    const input: CreateEntryInput = {
      requestKey: key,
      text: body,
      kind,
      links: context?.links ?? [],
      // A picked date is a day and nothing more: the writer said when it
      // happened, not at what minute, and inventing one would be a precision
      // they never claimed. No date at all means now, and the service stamps
      // the instant — its clock, not this browser's.
      ...(occurredOn ? { occurredPrecision: 'day' as const, occurredOn } : {}),
    }

    // The store files the new entry into every view its links satisfy, plus
    // the one named here — so the writer sees their own sentence appear in
    // the feed they typed above. That is the feed's key, which is the draft's
    // surface on all three surfaces today; `viewKey` exists so a surface whose
    // feed is keyed differently can say so rather than silently not updating.
    //
    // The store turns a rejected Server Action into `{ ok: false, error }`
    // before it gets here, so this catch is the second line of the same
    // defence rather than the first — and it is not optional: `saving`
    // disables Save, makes the status line announce "Saving…" for ever and
    // makes `save()` return immediately, so a throw that escaped would leave
    // the box permanently unable to submit the words sitting in it.
    let result: Awaited<ReturnType<typeof submitCapture>>
    try {
      result = await submitCapture(input, {
        surface: (viewKey ?? surface) as JournalSurface,
        context,
      })
    } catch (cause: unknown) {
      console.error('[khyte] journal save failed:', cause)
      result = { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
    }

    const now = live.current

    if (result.ok) {
      // Settled against the stored draft as well as the box. Storage is shared
      // by every tab on this surface, and another one may have written newer
      // words into it while this was in flight: clearing it because THIS box
      // is unchanged would erase them, and a reload would find nothing.
      const stored = readDraft(organizationId, userId, sent.surface)
      const settled = settleStoredDraft(sent, now, stored)

      // The one place a draft is ever cleared: storage still holds exactly
      // what was saved, key and all.
      if (settled.stored === 'clear') clearDraft(organizationId, userId, sent.surface)
      // Another surface's draft, typed on under the key this save used up.
      else if (settled.stored === 'rekey' && stored) {
        writeDraft(organizationId, userId, sent.surface, { ...stored, requestKey: newRequestKey() })
      }

      // The drawer moved to another prospect while this was in flight. The
      // box now belongs to that prospect and is none of this answer's
      // business; the draft this save came from was settled just above.
      if (settled.box === 'ignore') return

      if (settled.box === 'clear') {
        show({ ...now, text: '', occurredOn: '', requestKey: null })
        setStatus('saved')
        return
      }

      if (settled.box === 'adopt' && stored) {
        // This box sat unchanged while another tab kept writing the draft. The
        // box takes the stored words — with their key, never dropped — so both
        // tabs agree with storage, and the line says the earlier text was saved.
        show(adoptDraft(stored, now))
        setStatus('savedKeptNewer')
        return
      }

      // The writer kept going. What they sent is an entry now; what they have
      // written since is still theirs. It keeps its kind and its date, and it
      // gets its own key — the old one belongs to the saved entry, and a Save
      // on it would come back as a collision. Storage takes it too, unless
      // storage holds another tab's words, which are not this tab's to erase;
      // this box's words are written on its next keystroke as ever.
      // When the writer simply kept typing, the sentence that is now an entry
      // leaves the box and only the words after it stay (`settled.text`); an
      // edited sentence stays whole, because the saved and the newer words
      // can no longer be told apart.
      const key = settled.mintNewKey || !now.requestKey ? newRequestKey() : now.requestKey
      const kept = settled.text ?? now.text
      if (key !== now.requestKey || kept !== now.text) show({ ...now, text: kept, requestKey: key })
      if (settled.stored === 'write') {
        writeDraft(organizationId, userId, sent.surface, {
          text: kept,
          requestKey: key,
          kind: now.kind,
          occurredOn: now.occurredOn || null,
        })
      }
      setStatus('savedKeptNewer')
      return
    }

    // A refusal for a draft that is no longer on screen. Its words and its
    // key are still in storage under its own surface, exactly as they were,
    // and saying "could not save" over a different prospect's box would be a
    // sentence about the wrong thing. The store has already acted on an
    // identity refusal.
    if (now.surface !== sent.surface) return

    if (result.error === 'request_key_conflict') {
      setConflict(result.existing ?? null)
      setStatus('conflict')
      return
    }
    if (result.error === 'unavailable') {
      setStatus('unavailable')
      return
    }
    if (isIdentityRefusal(result.error)) {
      // This tab is finished. The store has already dropped this draft and
      // SnapshotSync is reloading the page as whoever the cookie now names
      // (or to the sign-in page, for an ended session), so a Retry would
      // submit from a tab that is going away — and the generic failure
      // sentence would promise the text is still here when it is not. One
      // line saying what is happening, and nothing to press.
      setStatus('signedOut')
      return
    }
    setError(result.error)
    setStatus('error')
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void save()
    }
  }

  /** One sentence, announced politely — never more than one at a time. */
  const statusLine =
    status === 'saving'
      ? copy.saving
      : status === 'saved'
        ? copy.saved
        : status === 'savedKeptNewer'
          ? copy.savedKeptNewer
          : status === 'unavailable'
            ? copy.unavailable
            : status === 'conflict'
              ? copy.alreadySaved
              : status === 'signedOut'
                ? copy.signingBackIn
                : status === 'error' && error
                  ? copy.failed(error)
                  : ''

  return (
    <section
      className={cn('rounded-2xl border border-border-subtle bg-surface p-4 sm:p-5', className)}
      aria-label={copy.title}
    >
      {showOrganization && (
        <p className="label-mono mb-3">
          {copy.title} · {organizationName}
        </p>
      )}

      <textarea
        id={fieldId}
        ref={textareaRef}
        value={text}
        onChange={(e) => change({ text: e.target.value })}
        onKeyDown={onKeyDown}
        onFocus={holdPoller}
        onBlur={releasePoller}
        rows={3}
        maxLength={MAX_TEXT_LENGTH}
        aria-label={copy.title}
        placeholder={context ? copy.placeholderFor(context.label) : copy.placeholder}
        className={cn(
          'w-full resize-none rounded-lg border border-border-subtle bg-background-raised px-4 py-3',
          // 16px below sm: anything smaller makes iOS zoom the whole page on
          // focus, which on a drawer means the panel jumps out of view.
          'text-[16px] leading-relaxed text-foreground outline-none sm:text-[14.5px]',
          'placeholder:text-foreground/45 focus:border-accent/50 transition-[border-color] duration-100 ease-out'
        )}
      />

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`${fieldId}-kind`}>
          {copy.kind}
        </label>
        <select
          id={`${fieldId}-kind`}
          value={kind}
          onChange={(e) => change({ kind: e.target.value as JournalKind })}
          className={cn(
            'h-11 rounded-lg border border-border-subtle bg-background-raised px-2.5 sm:h-9',
            'text-[16px] text-foreground outline-none focus:border-accent/50 sm:text-[13.5px]'
          )}
        >
          {JOURNAL_KINDS.map((option) => (
            <option key={option} value={option}>
              {copy.kinds[option]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor={`${fieldId}-date`}>
          {copy.date}
        </label>
        <input
          id={`${fieldId}-date`}
          type="date"
          value={occurredOn}
          onChange={(e) => change({ occurredOn: e.target.value })}
          title={copy.dateHint}
          className={cn(
            'h-11 rounded-lg border border-border-subtle bg-background-raised px-2.5 font-mono sm:h-9',
            'text-[16px] text-foreground outline-none focus:border-accent/50 sm:text-[13px]'
          )}
        />

        <span className="ml-auto hidden font-mono text-[11px] text-foreground/50 sm:inline">
          {copy.saveHint}
        </span>
        <Button size="sm" onClick={() => void save()} disabled={!text.trim() || status === 'saving'}>
          {copy.save}
        </Button>
      </div>

      {/* One polite status line. Never `assertive`: nothing here interrupts
          what somebody is in the middle of typing. */}
      <p
        aria-live="polite"
        className={cn(
          'mt-2 min-h-[18px] text-[12.5px]',
          status === 'error' || status === 'unavailable' || status === 'conflict'
            ? 'text-danger'
            : 'text-foreground/60'
        )}
      >
        {statusLine}
      </p>

      {status === 'error' && (
        <div className="mt-1">
          <Button size="sm" variant="secondary" onClick={() => void save()}>
            {copy.retry}
          </Button>
        </div>
      )}

      {status === 'conflict' && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {conflict && (
            <a
              href={`/journal#entry-${conflict.id}`}
              className="inline-flex min-h-11 items-center rounded-lg px-2 text-[13px] font-medium text-accent underline underline-offset-2 sm:min-h-9"
            >
              {copy.openEntry}
            </a>
          )}
          {/* A fresh key, so what is in the box now becomes its own entry
              rather than colliding with the one that already exists. */}
          <Button size="sm" variant="secondary" onClick={() => void save({ freshKey: true })}>
            {copy.saveAsNew}
          </Button>
        </div>
      )}

    </section>
  )
}
