'use client'

import { useEffect, useMemo } from 'react'
import { RotateCw } from 'lucide-react'
import { useCRMStore } from '@/lib/store'
import { useTranslations } from '@/lib/hooks/useTranslations'
import { cn } from '@/lib/utils'
import { formatJournalTime } from '@/lib/journal/format'
import type { LinkTarget } from '@/lib/journal/contracts'
import { JournalEntryCard } from './JournalEntryCard'

interface JournalFeedProps {
  /** `dashboard`, `journal`, or `prospect:<opportunityId>`. */
  viewKey: string
  /** The any-of filter this feed reads with. Omitted = the whole Journal. */
  targets?: LinkTarget[]
  limit?: number
  className?: string
}

/**
 * One list of entries, and an honest account of how much of the Journal it is.
 *
 * THE COVERAGE LINE IS THE POINT. A feed that quietly shows the thirty newest
 * of two hundred entries is a feed that lies by omission — somebody reads it,
 * sees nothing about the meeting in March, and concludes nothing was written.
 * `JournalCoverage` comes back from the same read that produced the entries,
 * and this says what it says: how many are shown, whether there are older
 * ones, and when the list was read. "Loaded 14:03 · Refresh" exists because a
 * feed sitting open for an hour looks exactly like a feed read a second ago.
 *
 * `unavailable` is its own state, distinct from empty (decision 12). No
 * database means "we cannot tell you", which is not the same sentence as
 * "nobody has written anything".
 *
 * THE COUNT IS COUNTED HERE, off the list actually on screen, and only
 * `hasMore` and `loadedAt` are read out of `coverage`. A page's coverage
 * describes that page; this feed shows every page it has loaded plus anything
 * written into it since, so asking the newest page how many entries are on
 * screen is how "Showing 10" ends up printed over seventy cards.
 *
 * The list is never emptied while a refresh is in flight — the previous page
 * stays under the skeleton line. A reader who has scrolled to an entry should
 * not lose it every twelve seconds because the poller saw the stamp move.
 * More than that: once Load more has been pressed, the poller re-reads EVERY
 * page the reader holds and replaces the list with that (see `refreshRange`
 * in the store), so a colleague writing a line cannot cut a reader who asked
 * for three pages back to one, and a colleague deleting or editing an entry on
 * page three is reflected there rather than left standing. Cards keep their
 * ids, so the reader's place survives the swap. Only the Refresh button below,
 * and the first load, read a single page — those are somebody asking for the
 * newest page.
 *
 * The view is reference-counted for as long as this component is mounted. The
 * store outlives navigation, and the poller refreshes only the views a feed is
 * still holding — without the release on unmount, every prospect drawer ever
 * opened would be re-read every twelve seconds for the rest of the session.
 */
export function JournalFeed({ viewKey, targets, limit, className }: JournalFeedProps) {
  const { t } = useTranslations()
  const copy = t.crm.journal

  const loadJournalView = useCRMStore((s) => s.loadJournalView)
  const loadMoreJournal = useCRMStore((s) => s.loadMoreJournal)
  const acquireJournalView = useCRMStore((s) => s.acquireJournalView)
  const releaseJournalView = useCRMStore((s) => s.releaseJournalView)
  const view = useCRMStore((s) => s.journal.views[viewKey])
  const entriesById = useCRMStore((s) => s.journal.entries)
  const timezone = useCRMStore((s) => s.workspace.organization.timezone)
  const locale = useCRMStore((s) => s.settings.locale)

  // Serialized so a caller building the array inline does not re-read the feed
  // on every render — the array is a new object each time, the string is not.
  const targetKey = targets ? JSON.stringify(targets) : ''

  useEffect(() => {
    acquireJournalView(viewKey)
    void loadJournalView(viewKey, {
      targets: targetKey ? (JSON.parse(targetKey) as LinkTarget[]) : undefined,
      limit,
    })
    return () => releaseJournalView(viewKey)
  }, [acquireJournalView, releaseJournalView, loadJournalView, viewKey, targetKey, limit])

  const entries = useMemo(
    () => (view?.ids ?? []).map((id) => entriesById[id]).filter((entry) => entry !== undefined),
    [view?.ids, entriesById]
  )

  const coverage = view?.coverage
  const unavailable = coverage?.unavailable === true
  const loading = view?.status === 'loading'
  const failed = view?.status === 'error'

  /** The explicit ask: the newest page, and only that — unlike the poller,
   *  which re-reads every page held. */
  const refresh = () =>
    void loadJournalView(viewKey, {
      targets: targetKey ? (JSON.parse(targetKey) as LinkTarget[]) : undefined,
      limit,
    })

  return (
    <section className={cn('min-w-0', className)} aria-label={copy.title}>
      {coverage && !unavailable && (
        <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-foreground/55">
          <span className="font-mono tabular-nums">
            {coverage.hasMore ? copy.showingMore(entries.length) : copy.showing(entries.length)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">
            {copy.loadedAt(formatJournalTime(coverage.loadedAt, { timezone, locale }))}
          </span>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="ml-1 inline-flex min-h-11 items-center gap-1 rounded-lg px-1.5 text-[11.5px] text-foreground/60 transition-colors hover:text-foreground disabled:opacity-50 sm:min-h-8"
          >
            <RotateCw size={11} aria-hidden="true" />
            {copy.refresh}
          </button>
        </div>
      )}

      {unavailable ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-foreground/60">
          {copy.feedUnavailable}
        </p>
      ) : failed ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
          <p className="text-[13px] text-danger">{copy.loadFailed(view?.error ?? '')}</p>
          <button
            type="button"
            onClick={refresh}
            className="mt-2 min-h-11 rounded-lg px-4 text-[13.5px] font-medium text-accent transition-colors hover:bg-accent-light"
          >
            {copy.retry}
          </button>
        </div>
      ) : entries.length === 0 && loading ? (
        // A skeleton only when there is nothing to keep on screen. A refresh
        // over an existing list leaves the list alone.
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-[72px] animate-pulse rounded-xl border border-border-subtle bg-surface" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-foreground/60">
          {copy.empty}
        </p>
      ) : (
        <>
          <ol className="space-y-2">
            {entries.map((entry) => (
              <li key={entry.id}>
                <JournalEntryCard entry={entry} />
              </li>
            ))}
          </ol>

          {view?.nextCursor && (
            <button
              type="button"
              onClick={() => void loadMoreJournal(viewKey)}
              disabled={loading}
              className="mt-2.5 flex min-h-11 w-full items-center justify-center rounded-xl border border-border-subtle bg-surface text-[13.5px] font-medium text-foreground/75 transition-colors hover:text-foreground disabled:opacity-50"
            >
              {loading ? copy.loading : copy.loadMore}
            </button>
          )}
        </>
      )}
    </section>
  )
}
