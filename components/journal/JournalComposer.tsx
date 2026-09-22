'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/crm/Button'
import { useCRMStore } from '@/lib/store'
import { useTranslations } from '@/lib/hooks/useTranslations'
import { CONTEXT_MISMATCH } from '@/lib/actions/scope'
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
  newRequestKey,
  readDraft,
  sweepForeignDrafts,
  writeDraft,
  type JournalSurface,
} from '@/lib/journal/drafts'

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
 * not by a reload, not by closing the tab. Every branch below is that promise
 * — the draft is written to storage on each keystroke, the request key is
 * minted once and reused so a retry cannot become a second entry, and the
 * draft is cleared on exactly one result, `{ ok: true }`. A save that fails,
 * is refused, or collides keeps the words on screen and in storage.
 *
 * THE FIVE ANSWERS a save can come back with, and what each looks like here:
 *
 *   ok                   the entry is filed, the box empties, the status line
 *                        says so, and a fresh key is minted for the next one.
 *   request_key_conflict this key already belongs to different text — the save
 *                        did land once, and then the text changed. The entry
 *                        it produced comes back so the box can point at it,
 *                        and "save as a new entry" mints a fresh key for what
 *                        is in the box now. Never silently duplicated.
 *   unavailable          there is no database (decision 12). Said plainly,
 *                        with the text kept, rather than a cheerful "Saved".
 *   context_mismatch     the cookie now names somebody else. The ONE answer
 *                        that does not keep the text: the store has already
 *                        dropped this identity's drafts and the page is
 *                        reloading. A sentence, and no Retry to press.
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
    'idle' | 'saving' | 'saved' | 'error' | 'unavailable' | 'conflict' | 'signedOut'
  >('idle')
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<JournalEntryView | null>(null)

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
    setStatus('idle')
    setError(null)
    setConflict(null)
  }, [organizationId, userId, surface])

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
    if (status === 'saved') setStatus('idle')

    if (!value.trim()) {
      // An emptied box has no draft to keep. The key goes with it: the next
      // sentence is a different entry and deserves its own.
      clearDraft(organizationId, userId, surface)
      setRequestKey(null)
      return
    }
    const key = requestKey ?? newRequestKey()
    if (!requestKey) setRequestKey(key)
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

    if (result.ok) {
      // The one place a draft is ever cleared.
      clearDraft(organizationId, userId, surface)
      setText('')
      setOccurredOn('')
      setRequestKey(null)
      setStatus('saved')
      return
    }
    if (result.error === 'request_key_conflict') {
      setConflict(result.existing ?? null)
      setStatus('conflict')
      return
    }
    if (result.error === 'unavailable') {
      setStatus('unavailable')
      return
    }
    if (result.error === CONTEXT_MISMATCH) {
      // This tab is finished. The store has already dropped this draft and
      // SnapshotSync is reloading the page as whoever the cookie now names,
      // so a Retry would submit from a tab that is going away — and the
      // generic failure sentence would promise the text is still here when
      // it is not. One line saying what is happening, and nothing to press.
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
