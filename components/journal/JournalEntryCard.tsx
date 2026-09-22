'use client'

import { useId, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/crm/Button'
import { useCRMStore } from '@/lib/store'
import { useFormat } from '@/lib/hooks/useFormat'
import { useTranslations } from '@/lib/hooks/useTranslations'
import { CONTEXT_MISMATCH } from '@/lib/actions/scope'
import { cn } from '@/lib/utils'
import { loadJournalEntry } from '@/app/actions/journal'
import { useJournalTyping } from './JournalSync'
import {
  JOURNAL_KINDS,
  MAX_TEXT_LENGTH,
  type JournalEntryDetail,
  type JournalEntryView,
  type JournalKind,
} from '@/lib/journal/contracts'

/**
 * One entry, as it reads on a feed.
 *
 * WHAT IT REFUSES TO HIDE. The author, or that there is none; the date at the
 * precision it was recorded at; where the text came from (typed here, through
 * MCP, or migrated from the old notes); which records it is about, INCLUDING
 * the ones that have since been deleted — a tombstone link keeps the name the
 * record had and says the record is gone, because "Meridian Labs — removed" is
 * information and a blank chip is not.
 *
 * WHAT IT DOES NOT SHOW. Any AI status: Stage 2 writes `not_requested` and
 * nothing interprets anything, so a "not analysed" badge on every entry would
 * be a promise about Stage 3 dressed up as a state.
 *
 * `origin: 'system'` entries — a next-step change, an outreach line logged
 * through the tool — render compact and without an editor. They are Donna
 * recording something somebody did, not something somebody wrote, and a person
 * editing one would be rewriting the record of an event.
 *
 * Original text and History are read on demand (`loadJournalEntry`) rather
 * than shipped with every feed page: the original only differs from the body
 * once an entry has been edited, and most never are.
 */
export function JournalEntryCard({ entry }: { entry: JournalEntryView }) {
  const { t } = useTranslations()
  const copy = t.crm.journal
  const fmt = useFormat()
  const fieldId = useId()

  const editEntry = useCRMStore((s) => s.editJournalEntry)
  const deleteEntry = useCRMStore((s) => s.deleteJournalEntry)
  const markIdentityChanged = useCRMStore((s) => s.markIdentityChanged)
  const organizationId = useCRMStore((s) => s.workspace.organization.id)
  const userId = useCRMStore((s) => s.workspace.viewer.userId)

  // The editor below holds the poller exactly as the composer does. The
  // dashboard's feed is capped at five entries, so a colleague's line arriving
  // is enough to push this card off the list and unmount a half-typed edit.
  const { hold: holdPoller, release: releasePoller } = useJournalTyping()

  const [editing, setEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [bodyDraft, setBodyDraft] = useState('')
  const [kindDraft, setKindDraft] = useState<JournalKind>(entry.kind)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const [detail, setDetail] = useState<JournalEntryDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const system = entry.origin === 'system'
  const deleted = entry.deletedAt !== null

  /**
   * The words for a refusal — three of them are answers, not faults.
   *
   * Anything else is a code this card has no sentence for: a schema refusal,
   * a missing link target, a network message that came back as the reason a
   * Server Action rejected. It says so in language rather than printing
   * `target_not_found` at somebody, and the raw value goes to the console,
   * which is where whoever is debugging it will look anyway.
   */
  const explain = (error: string) => {
    if (error === 'revision_conflict') return copy.revisionConflict
    if (error === 'deleted') return copy.deletedEntry
    if (error === 'not_found') return copy.notFound
    console.error('[khyte] journal entry action failed:', error)
    return copy.actionFailed
  }

  /** What a rejected promise is, as a string `explain` can take. */
  const reasonOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

  const beginEdit = () => {
    setTitleDraft(entry.title ?? '')
    setBodyDraft(entry.body)
    setKindDraft(entry.kind)
    setProblem(null)
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    releasePoller()
  }

  // `busy` is cleared in a `finally` throughout: it disables Save, Delete and
  // Cancel, so a path that leaves it set locks the card into a state with no
  // way out but a reload. The store already turns a rejected Server Action
  // into `{ ok: false }`, which makes these catches the second line of the
  // same defence rather than the first.
  const saveEdit = async () => {
    const body = bodyDraft.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      const result = await editEntry(entry.id, {
        title: titleDraft.trim() || null,
        body,
        kind: kindDraft,
        // The revision the editor was opened on. A write against a stale one is
        // refused rather than quietly overwriting somebody else's wording.
        expectedRevision: entry.revision,
      })
      if (result.ok) {
        setEditing(false)
        releasePoller()
        setProblem(null)
        // Anything already expanded was read at the old wording.
        setDetail(null)
        return
      }
      setProblem(explain(result.error))
    } catch (cause: unknown) {
      setProblem(explain(reasonOf(cause)))
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    setBusy(true)
    try {
      const result = await deleteEntry(entry.id)
      if (!result.ok) setProblem(explain(result.error))
    } catch (cause: unknown) {
      setProblem(explain(reasonOf(cause)))
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  /** Reads the capture's original text and every past wording, once. */
  const loadDetail = async () => {
    if (detail) return detail
    try {
      const result = await loadJournalEntry(entry.id, { organizationId, userId })
      if (!result.ok) {
        if (result.error === CONTEXT_MISMATCH) {
          // The cookie names somebody else now. This is the one refusal the
          // card says nothing about: the store's own writes reach the same
          // conclusion through the store, this read went straight to the
          // action and would otherwise swallow it, and the page is about to
          // be reloaded as whoever that person is.
          markIdentityChanged()
          return null
        }
        setDetailError(explain(result.error))
        return null
      }
      setDetailError(null)
      setDetail(result.entry)
      return result.entry
    } catch (cause: unknown) {
      setDetailError(explain(reasonOf(cause)))
      return null
    }
  }

  const toggleOriginal = async () => {
    if (showOriginal) {
      setShowOriginal(false)
      return
    }
    const loaded = await loadDetail()
    if (loaded) setShowOriginal(true)
  }

  const toggleHistory = async () => {
    if (showHistory) {
      setShowHistory(false)
      return
    }
    const loaded = await loadDetail()
    if (loaded) setShowHistory(true)
  }

  // Only worth offering once it would say something new. An unedited entry's
  // capture text IS its body, and a button that expands to the same paragraph
  // twice is noise.
  const originalDiffers = detail ? detail.originalText !== entry.body : entry.revision > 1

  const sourceLabel = copy.source[entry.source]

  return (
    <article
      id={`entry-${entry.id}`}
      className={cn(
        'rounded-xl border border-border-subtle bg-surface',
        system ? 'px-3.5 py-2.5' : 'px-4 py-3.5'
      )}
    >
      {/* Metadata first: who, when, and where the text came from. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-foreground/60">
        <span className="font-medium text-foreground/75">
          {entry.authorName ?? copy.unknownAuthor}
        </span>
        <span aria-hidden="true">·</span>
        <span className="font-mono tabular-nums">{fmt.journalDate(entry)}</span>
        <span aria-hidden="true">·</span>
        {/* A word, not a colour: the source has to survive being read in
            greyscale and by a screen reader. */}
        <span className="rounded-md border border-border-subtle px-1.5 py-0.5 font-mono text-[10.5px]">
          {sourceLabel}
        </span>
        {system && (
          <span className="rounded-md border border-border-subtle px-1.5 py-0.5 font-mono text-[10.5px]">
            {copy.systemEntry}
          </span>
        )}
        {!system && <span className="text-foreground/50">{copy.kinds[entry.kind]}</span>}
      </div>

      {deleted ? (
        <p className="mt-2 text-[13.5px] italic text-foreground/55">{copy.deletedEntry}</p>
      ) : editing ? (
        <div className="mt-2.5 space-y-2">
          <input
            aria-label={copy.titlePlaceholder}
            placeholder={copy.titlePlaceholder}
            value={titleDraft}
            onChange={(e) => {
              holdPoller()
              setTitleDraft(e.target.value)
            }}
            onFocus={holdPoller}
            onBlur={releasePoller}
            className="h-11 w-full rounded-lg border border-border-subtle bg-background-raised px-3 text-[16px] text-foreground outline-none focus:border-accent/50 sm:h-9 sm:text-[14px]"
          />
          <textarea
            aria-label={copy.editTitle}
            value={bodyDraft}
            onChange={(e) => {
              holdPoller()
              setBodyDraft(e.target.value)
            }}
            onFocus={holdPoller}
            onBlur={releasePoller}
            rows={4}
            maxLength={MAX_TEXT_LENGTH}
            className="w-full resize-y rounded-lg border border-border-subtle bg-background-raised px-3 py-2.5 text-[16px] leading-relaxed text-foreground outline-none focus:border-accent/50 sm:text-[14px]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`${fieldId}-kind`}>
              {copy.kind}
            </label>
            <select
              id={`${fieldId}-kind`}
              value={kindDraft}
              onChange={(e) => setKindDraft(e.target.value as JournalKind)}
              className="h-11 rounded-lg border border-border-subtle bg-background-raised px-2.5 text-[16px] text-foreground outline-none focus:border-accent/50 sm:h-9 sm:text-[13.5px]"
            >
              {JOURNAL_KINDS.map((option) => (
                <option key={option} value={option}>
                  {copy.kinds[option]}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={() => void saveEdit()} disabled={busy || !bodyDraft.trim()}>
              {t.common.save}
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={busy}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {entry.title && (
            <h3 className="mt-1.5 text-[14.5px] font-semibold leading-snug text-foreground">
              {entry.title}
            </h3>
          )}
          <p
            className={cn(
              'whitespace-pre-wrap break-words leading-relaxed text-foreground',
              system ? 'mt-1 text-[13px] text-foreground/80' : 'mt-1.5 text-[14px]'
            )}
          >
            {entry.body}
          </p>
        </>
      )}

      {entry.links.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {entry.links.map((link) => (
            <li key={link.id}>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px]',
                  link.targetId === null
                    ? 'border-border-subtle bg-surface-raised text-foreground/45'
                    : 'border-border-subtle bg-surface-raised text-foreground/80'
                )}
              >
                {link.targetLabel}
                {/* The record is gone; the name it had is not. Said in words,
                    because a dimmer chip is not a statement. */}
                {link.targetId === null && (
                  <span className="text-foreground/45">· {copy.removedLink}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* One polite live region, like the composer's status line: these two
          sentences are the answer to something somebody just pressed, and a
          plain <p> appearing is silent to a screen reader. Never `assertive`
          — nothing here interrupts what is being typed. */}
      <div role="status" aria-live="polite">
        {problem && <p className="mt-2 text-[12.5px] text-danger">{problem}</p>}
        {detailError && <p className="mt-2 text-[12.5px] text-danger">{detailError}</p>}
      </div>

      {!deleted && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {originalDiffers && (
            <button
              type="button"
              onClick={() => void toggleOriginal()}
              aria-expanded={showOriginal}
              className="min-h-11 text-[12px] text-foreground/60 underline underline-offset-2 transition-colors hover:text-foreground sm:min-h-0"
            >
              {showOriginal ? copy.hideOriginal : copy.showOriginal}
            </button>
          )}
          {entry.revision > 1 && (
            <button
              type="button"
              onClick={() => void toggleHistory()}
              aria-expanded={showHistory}
              className="min-h-11 text-[12px] text-foreground/60 underline underline-offset-2 transition-colors hover:text-foreground sm:min-h-0"
            >
              {showHistory ? copy.hideHistory : copy.showHistory}
            </button>
          )}

          {/* System lines have no editor: they record what happened, and
              rewriting one would be rewriting the event. */}
          {!system && !editing && (
            <button
              type="button"
              onClick={beginEdit}
              aria-label={copy.edit}
              className="ml-auto flex h-11 w-11 items-center justify-center rounded-lg text-foreground/45 transition-colors hover:bg-surface-raised hover:text-foreground sm:h-8 sm:w-8"
            >
              <Pencil size={13} />
            </button>
          )}

          {confirming ? (
            // Confirmed in the card rather than in a modal: the entry the
            // question is about stays on screen while it is being asked.
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] text-foreground/75">{copy.confirmDelete}</span>
              <Button size="sm" variant="danger" onClick={() => void confirmDelete()} disabled={busy}>
                {copy.delete}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                {t.common.cancel}
              </Button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={copy.delete}
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-lg text-foreground/45',
                'transition-colors hover:bg-danger-muted hover:text-danger sm:h-8 sm:w-8',
                system && 'ml-auto'
              )}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      )}

      {showOriginal && detail && (
        <div className="mt-2.5 rounded-lg border border-border-subtle bg-background-raised px-3 py-2.5">
          <p className="label-mono mb-1.5">{copy.originalText}</p>
          <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/80">
            {detail.originalText}
          </p>
        </div>
      )}

      {showHistory && detail && (
        <div className="mt-2 rounded-lg border border-border-subtle bg-background-raised px-3 py-2.5">
          <p className="label-mono mb-1.5">{copy.history}</p>
          <ol className="space-y-2">
            {detail.revisions.map((revision) => (
              <li key={revision.revision}>
                <p className="font-mono text-[10.5px] text-foreground/55">
                  {/* The organization's clock, like the entry's own date
                      above it. `fmt.dateTime` is the browser's, and two
                      clocks in one card is how a revision made at 00:30 in
                      Stockholm reads as the day before the entry it revised. */}
                  {copy.revision(revision.revision)} · {fmt.journalDateTime(revision.changedAt)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/80">
                  {revision.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </article>
  )
}
