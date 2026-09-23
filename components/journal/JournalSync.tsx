'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useCRMStore } from '@/lib/store'
import { nextPollState, pollAction } from '@/lib/journal/composer-state'

/** How often to ask whether anything in the Journal changed. */
const CHECK_SECONDS = 12

/** How long after the last keystroke the poller is still held off. */
const TYPING_GRACE_MS = 5000

/**
 * The other half of "will not re-read a feed under somebody's hands".
 *
 * Every box somebody can be part-way through typing into holds the poller
 * while it is being used and releases it a few seconds after — the composer,
 * and since this round the card's inline editor, which the dashboard's
 * five-entry cap makes especially easy for a refresh to unmount mid-sentence.
 *
 * It lives beside the poller rather than in either component because it is a
 * statement about the poller, and because two copies of a timer that gates the
 * same flag is exactly how the two drift apart.
 *
 * `holding` is per instance and is what keeps one box from speaking for
 * another: a card unmounting while nobody was editing it must not clear the
 * hold a composer two elements up is relying on. The flag itself is a single
 * boolean by design (see the store) — good enough for one person typing in
 * one place, which is the only case there is.
 */
export function useJournalTyping(): { hold: () => void; release: () => void } {
  const setJournalTyping = useCRMStore((s) => s.setJournalTyping)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holding = useRef(false)

  /** Focused, or still inside the grace window after a keystroke. */
  const hold = useCallback(() => {
    holding.current = true
    setJournalTyping(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [setJournalTyping])

  /** Released on a delay, so a refresh does not land the instant focus moves
   *  to the Save button beside the box. */
  const release = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      holding.current = false
      setJournalTyping(false)
    }, TYPING_GRACE_MS)
  }, [setJournalTyping])

  // Release the flag if the box is unmounted mid-sentence — a drawer closed
  // while typing would otherwise leave every feed frozen for the session.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (holding.current) setJournalTyping(false)
    },
    [setJournalTyping]
  )

  return { hold, release }
}

/**
 * Keeps the Journal feeds on this screen current with everyone else's writing.
 *
 * SnapshotSync's shape, aimed at the half of the data the snapshot does not
 * carry. Journal entries are history and are read a page at a time per
 * surface, so they are not in the working set and the snapshot stamp says
 * nothing about them — /api/journal/version is their own signal, moved by a
 * capture, an entry or a link in this organization and by nothing else.
 *
 * Mounted BY THE SURFACES rather than by AppShell, deliberately. A poller in
 * the shell would ask on every page in the app, including the eight that show
 * no entries at all. It costs one aggregate per twelve seconds and only while
 * somebody is actually looking at a feed.
 *
 * FOUR THINGS IT WILL NOT DO:
 *   - poll a hidden tab. Nobody is looking; the visibility listener asks the
 *     moment it comes back, which is sooner than the interval would have.
 *   - poll when the Journal is unavailable. Demo mode has no database, the
 *     stamp is the constant 'demo', and asking would be pure noise.
 *   - re-read a feed under somebody's hands. `refreshJournalViews` stands down
 *     while `journalTyping` is set and says so ('deferred'); the stamp stays
 *     pending, and it is asked for again the moment the typing stops.
 *   - re-read a feed nobody is looking at. The store outlives navigation, so
 *     it refreshes only the views a mounted feed is holding a reference to
 *     (`acquireJournalView`), and it refreshes them in parallel.
 *
 * The first answer is recorded without refreshing: the feeds were read moments
 * ago by their own components, so the stamp that comes back describes what is
 * already on screen.
 *
 * A STAMP IS ONLY SEEN ONCE IT IS SHOWN. `seen` advances when the refresh it
 * asked for reports 'applied', and at no other time. A refresh that was
 * deferred (somebody typing) or failed (a read that did not come back) leaves
 * `seen` where it was, so the next tick fetches the same stamp, finds it still
 * differs from `seen`, and asks again. Marking the stamp seen the moment it
 * was fetched, before the refresh had shown anything — which is what this did
 * before — is how a colleague's line written while somebody typed was consumed
 * and never shown. The decision is
 * `pollAction` / `nextPollState` in lib/journal/composer-state.ts.
 */
export function JournalSync() {
  const refreshJournalViews = useCRMStore((s) => s.refreshJournalViews)
  const typing = useCRMStore((s) => s.journalTyping)
  // Any loaded view whose coverage says there is no database. One is enough:
  // the answer is a property of the deployment, not of the view.
  const unavailable = useCRMStore((s) =>
    Object.values(s.journal.views).some((view) => view.coverage?.unavailable === true)
  )

  /** The stamp whose data the feeds are currently showing. */
  const seen = useRef<string | null>(null)
  /** A stamp fetched and not yet applied — deferred or failed. */
  const pending = useRef<string | null>(null)
  /** Guards against a slow check overlapping the next tick. */
  const checking = useRef(false)
  /** The running poll's signal, for the check the end of typing triggers. */
  const pollSignal = useRef<AbortSignal | null>(null)

  const check = useCallback(
    async (signal: AbortSignal) => {
      if (document.hidden || checking.current) return

      checking.current = true
      try {
        const stamp = await fetch('/api/journal/version', { signal, cache: 'no-store' })
        // Most likely a 401: the session expired or the membership was
        // revoked. Leaving the last good feed up beats replacing it with
        // nothing; the next navigation meets the gate anyway.
        if (!stamp.ok) return

        const { version } = (await stamp.json()) as { version?: unknown }
        if (typeof version !== 'string') return

        // No database behind this deployment: the stamp can never move.
        if (version === 'demo') {
          seen.current = version
          return
        }

        const action = pollAction(seen.current, version)
        if (action === 'adopt') {
          // The first answer describes the pages the feeds just read.
          seen.current = version
          return
        }
        if (action === 'skip') {
          pending.current = null
          return
        }

        const outcome = await refreshJournalViews()
        const next = nextPollState(seen.current, version, outcome)
        seen.current = next.seen
        pending.current = next.pending
      } catch {
        // Offline, aborted, or a malformed response. The feeds keep the last
        // good page and the next tick retries.
      } finally {
        checking.current = false
      }
    },
    [refreshJournalViews]
  )

  useEffect(() => {
    if (unavailable) return

    const controller = new AbortController()
    pollSignal.current = controller.signal
    void check(controller.signal)
    const id = setInterval(() => void check(controller.signal), CHECK_SECONDS * 1000)

    const onVisible = () => {
      if (!document.hidden) void check(controller.signal)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      controller.abort()
      pollSignal.current = null
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [check, unavailable])

  // The typing stopped with a change still waiting for it: ask now rather
  // than at the next tick, up to twelve seconds after the writer looked up.
  useEffect(() => {
    if (typing || pending.current === null || !pollSignal.current) return
    void check(pollSignal.current)
  }, [typing, check])

  return null
}
