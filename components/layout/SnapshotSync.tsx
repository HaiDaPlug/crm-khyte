'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useCRMStore } from '@/lib/store'
import type { CRMSnapshot } from '@/lib/types'

/** How often to ask whether anything changed. */
const CHECK_SECONDS = 12

/**
 * Keeps this browser's working set current with everyone else's.
 *
 * The store is built once per page load from the server snapshot and is the
 * source of truth for the rest of the session, which is exactly why three
 * colleagues working at once could not see each other: nothing ever re-read.
 * This asks /api/snapshot/version on a short interval and pulls a fresh
 * snapshot only when the stamp differs from the one it is holding.
 *
 * Deliberately NOT the wallpaper's `location.reload()`. BoardRefresh can get
 * away with that because the board keeps no client state worth preserving —
 * this side keeps a great deal of it: an open drawer, a half-typed note, the
 * current filters, sort and page. So the new rows are merged into the store
 * and React re-renders what actually changed.
 *
 * Equally not `router.refresh()`, which looks like the idiomatic answer and
 * does nothing here: it re-runs the layout and hands CRMStoreProvider a new
 * snapshot prop, but the provider built the store in a `useState` initializer
 * and never rebuilds it. The store has to be told directly.
 *
 * Merges can be refused — mid-drag, or while one of this browser's own writes
 * is still in flight. A refusal deliberately leaves the seen-stamp untouched
 * so the next tick tries the same change again rather than dropping it.
 */
export function SnapshotSync({ version }: { version: string }) {
  const applyRemoteSnapshot = useCRMStore((s) => s.applyRemoteSnapshot)

  /** The stamp whose data the store is currently showing. */
  const seen = useRef(version)
  /** Guards against a slow check overlapping the next tick. */
  const checking = useRef(false)

  const check = useCallback(
    async (signal: AbortSignal) => {
      // A hidden tab has nobody looking at it. Whatever changed will still be
      // there when it comes back, and the visibility listener below asks
      // immediately on return — sooner than the interval would have.
      if (document.hidden || checking.current) return

      checking.current = true
      try {
        const stamp = await fetch('/api/snapshot/version', {
          signal,
          cache: 'no-store',
        })

        // Most likely a 401: the shared-password session expired. Reloading
        // would replace a working CRM with a login form mid-edit, so leave the
        // last good data up and let the next tick retry.
        if (!stamp.ok) return

        const { version: next } = (await stamp.json()) as { version?: unknown }
        if (typeof next !== 'string' || next === seen.current) return

        const fresh = await fetch('/api/snapshot', { signal, cache: 'no-store' })
        if (!fresh.ok) return

        const payload = (await fresh.json()) as {
          version?: unknown
          snapshot?: unknown
        }
        if (typeof payload.version !== 'string' || !isSnapshot(payload.snapshot)) return

        // Only mark it seen if it actually went in — see the store action.
        if (applyRemoteSnapshot(payload.snapshot)) {
          seen.current = payload.version
        }
      } catch {
        // Offline, aborted, or a malformed response. Silence is right: the
        // store keeps the last good data and the next tick retries.
      } finally {
        checking.current = false
      }
    },
    [applyRemoteSnapshot]
  )

  useEffect(() => {
    // 'demo' means there is no database behind this store, so the stamp can
    // never move and polling would be pure noise.
    if (version === 'demo') return

    const controller = new AbortController()
    const id = setInterval(() => void check(controller.signal), CHECK_SECONDS * 1000)

    const onVisible = () => {
      if (!document.hidden) void check(controller.signal)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      controller.abort()
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [check, version])

  return null
}

/**
 * Enough of a shape check to refuse a response that is not a working set.
 *
 * The snapshot goes straight into the store, so a login page's HTML or a
 * truncated body arriving here would empty every screen at once. Checking that
 * all eight collections are arrays costs nothing and makes that impossible.
 */
function isSnapshot(value: unknown): value is CRMSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const keys: (keyof CRMSnapshot)[] = [
    'companies',
    'contacts',
    'opportunities',
    'leads',
    'notes',
    'strategyColumns',
    'strategyCards',
    'tasks',
  ]
  return keys.every((key) => Array.isArray((value as Record<string, unknown>)[key]))
}
