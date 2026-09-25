'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
import type { JournalSurface } from '@/lib/journal/drafts'
import { isIdentityRefusal } from '@/lib/journal/composer-state'
import { DraftBox, type BoxView, type Refusal } from '@/lib/journal/draft-box'

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
 * not by a reload, not by closing the tab, not by a save that succeeds while
 * the writer is still typing, and not by another tab. Every branch below is
 * that promise — the draft is written to its slot on each keystroke, the
 * request key is kept across retries so a retry cannot become a second entry,
 * and a slot is removed only by whoever is letting go of its words and only
 * while it still holds exactly them (`settleSentSlot`): the save whose words
 * landed, the box that was emptied, the draft that moved to a fresh key. A
 * save that fails, is refused, or collides keeps the words on screen and in
 * storage.
 *
 * THIS FILE RENDERS; lib/journal/draft-box.ts DOES THE REST. What the box
 * holds, what reaches storage, what another tab's writes do to it, and what a
 * save's answer does, are one `DraftBox` per surface — a plain module the
 * store suite drives against fake storages — carrying out the rules of
 * lib/journal/composer-state.ts. This component feeds it events, reads the
 * one thing it cannot (whether this textarea has focus), and shows what it
 * answers.
 *
 * EVERY DRAFT HAS AN OWNER. Each draft sits in its own slot, named by its
 * request key, and this tab remembers in sessionStorage which key its box
 * holds (see lib/journal/drafts.ts), so a reload gets this tab's words back
 * whatever other tabs wrote. A draft is told from another by its key, never
 * by its text: an old save's answer cannot shorten a new draft that merely
 * begins with the sent words (`settleSave`), and another tab's writes reach
 * this box only through `followStorage` — a mirror follows its source, an
 * idle box takes words that continue its own, a box whose typed words lose
 * their slot writes them back under the same key, and one whose key another
 * tab writes different words into keeps its own under a fresh key (a fork).
 * Divergent drafts in two tabs end in two slots, each owned by one tab.
 *
 * THE TEXTAREA STAYS WRITABLE DURING A SAVE, deliberately — a thought does not
 * wait for a round-trip. So what was sent is frozen at the press (a
 * `SaveSnapshot`) and the answer is weighed against what the box holds when
 * it arrives, never against a render's copy (`DraftBox.settleOk`).
 *
 * THE FIVE ANSWERS a save can come back with, and what each looks like here:
 *
 *   ok                   the entry is filed. The slot under the sent key goes
 *                        if it still holds the sent words, and stays if
 *                        somebody typed on under that key (another tab's
 *                        words; saving them later meets the conflict strip
 *                        below). If the box still holds the sent draft,
 *                        unchanged — or with only a full stop or a space
 *                        typed after it — it empties, its slot goes too, and
 *                        the status line says "Saved". If it holds the sent draft typed on or
 *                        edited, the newer words stay under a key of their
 *                        own — the saved sentence leaves the box when it was
 *                        only continued — and the line says the earlier text
 *                        was saved. If it holds another draft altogether
 *                        (emptied and begun again, or taken up from another
 *                        tab), that draft is left whole, under its own key.
 *                        If the drawer has moved on to another prospect, the
 *                        box is left alone and only the sent slot is settled.
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
  const [status, setStatus] = useState<
    'idle' | 'saving' | 'saved' | 'savedKeptNewer' | 'error' | 'unavailable' | 'conflict' | 'signedOut'
  >('idle')
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<JournalEntryView | null>(null)

  /**
   * This surface's draft: the box as it is right now, for code that runs
   * after an await or in the `storage` listener between two renders. `save`
   * is a closure over the render it started in, and the answer has to be
   * weighed against the box as it is when the answer arrives — that is the
   * whole of R1. The request key lives only in there, never in React state:
   * nothing renders it, and a fork can re-key the box between two renders.
   *
   * One instance per surface, so the drawer swapping prospects makes a new
   * one; the old one is unmounted, and a save's answer that reaches it
   * settles only the slot the save came from.
   */
  const draftBox = useMemo(
    () => new DraftBox({ organizationId, userId, surface }),
    [organizationId, userId, surface]
  )

  /** Shows what the draft box answered. */
  const render = useCallback((view: BoxView) => {
    setText(view.text)
    setKind(view.kind)
    setOccurredOn(view.occurredOn)
  }, [])

  /**
   * Shows a save's refusal — this box's own, or one handed to it by a draft
   * box unmounted mid-save (the drawer went away and came back). The words
   * and the slot are untouched either way; only the status line changes.
   */
  const showRefusal = useCallback(({ error: refused, existing }: Refusal) => {
    if (refused === 'request_key_conflict') {
      setConflict(existing)
      setStatus('conflict')
      return
    }
    if (refused === 'unavailable') {
      setStatus('unavailable')
      return
    }
    if (isIdentityRefusal(refused)) {
      // This tab is finished. The store has already dropped this draft and
      // SnapshotSync is reloading the page as whoever the cookie now names
      // (or to the sign-in page, for an ended session), so a Retry would
      // submit from a tab that is going away — and the generic failure
      // sentence would promise the text is still here when it is not. One
      // line saying what is happening, and nothing to press.
      setStatus('signedOut')
      return
    }
    setError(refused)
    setStatus('error')
  }, [])

  /* ———— the draft ———— */

  // On mount, and whenever the surface changes underneath this box — the
  // drawer swapping from one prospect to another reuses the same component
  // with a new draft box — load this tab's own draft for the surface
  // (`DraftBox.mount`). The cleanup marks the old draft box gone. A save's
  // answer that arrives after the swap, or after unmount, is then settled by
  // whichever draft box is on screen for that surface and still holds the
  // sent draft — the drawer went away and came back — which tells this
  // component through `listen`; with none, only the slots the save came from
  // are settled, and this tab's own copy of the draft is forgotten when it is
  // exactly the acknowledged words, so the next mount does not bring them back.
  useEffect(() => {
    render(draftBox.mount())
    setStatus('idle')
    setError(null)
    setConflict(null)
    const stopListening = draftBox.listen((handedOver) => {
      if ('saved' in handedOver) {
        render(handedOver.saved.view)
        setStatus(handedOver.saved.status)
      } else {
        showRefusal(handedOver.refused)
      }
    })
    return () => {
      stopListening()
      draftBox.unmount()
    }
  }, [draftBox, render, showRefusal])

  // Another tab wrote or removed a key of this origin; `storage` fires only in
  // the OTHER tabs, never the writer. The draft box decides what it means for
  // this surface (`followStorage`); this listener supplies the one thing only
  // the DOM knows — whether somebody is writing here: the document has focus
  // AND the textarea is its active element (a background tab keeps its active
  // element). A box that adopted a draft shows it, and stops claiming "Saved".
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      const focused = document.hasFocus() && document.activeElement === textareaRef.current
      const adopted = draftBox.onStorage(event.key, event.oldValue, event.newValue, focused)
      if (!adopted) return
      render(adopted)
      setStatus((current) => (current === 'saved' || current === 'savedKeptNewer' ? 'idle' : current))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [draftBox, render])

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
    // Written to the draft box first, which files the slot (or, emptied,
    // releases it) — see `DraftBox.change`.
    render(draftBox.change(next))
    holdPoller()
    // The status line stops claiming "Saved" the moment the box is not empty
    // again, so a fresh sentence is never sitting under somebody else's
    // confirmation.
    if (status === 'saved' || status === 'savedKeptNewer') setStatus('idle')
  }

  const save = async (options: { freshKey?: boolean } = {}) => {
    if (status === 'saving') return
    // The draft box this save belongs to: the one on screen at the press. The
    // answer goes back to it even if the drawer has moved on since.
    const box = draftBox
    // Moves the draft to a fresh key first for "save as a new entry", and
    // freezes what the answer below is an answer ABOUT (`sent`).
    const start = box.beginSave(options)
    if (!start) return
    const { key, body, sent } = start
    setStatus('saving')
    setError(null)
    setConflict(null)

    const input: CreateEntryInput = {
      requestKey: key,
      text: body,
      kind: sent.kind,
      links: context?.links ?? [],
      // A picked date is a day and nothing more: the writer said when it
      // happened, not at what minute, and inventing one would be a precision
      // they never claimed. No date at all means now, and the service stamps
      // the instant — its clock, not this browser's.
      ...(sent.occurredOn ? { occurredPrecision: 'day' as const, occurredOn: sent.occurredOn } : {}),
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

    if (result.ok) {
      // The draft box weighs the answer against the box as it is NOW — and
      // settles the sent slot, the box's own slot, and its key. Null when the
      // drawer moved to another prospect, or the composer unmounted, while
      // this was in flight: only the slot the save came from was settled, and
      // nothing on screen is this answer's business.
      const settled = box.settleOk(sent)
      if (!settled) return
      render(settled.view)
      setStatus(settled.status)
      return
    }

    // A refusal for a draft that is no longer on screen. Its words and its
    // key are still in storage under its own surface, exactly as they were,
    // and saying "could not save" over a different prospect's box would be a
    // sentence about the wrong thing — unless the drawer came back to it, in
    // which case the draft box hands the refusal to the box on screen, and
    // this component hears it through `listen`. The store has already acted
    // on an identity refusal.
    const refusal: Refusal = {
      error: result.error,
      existing: result.error === 'request_key_conflict' ? result.existing ?? null : null,
    }
    if (!box.settleRefused(sent, refusal)) return
    showRefusal(refusal)
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
