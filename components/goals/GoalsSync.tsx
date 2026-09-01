'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/** How often to ask whether anything changed. */
const CHECK_SECONDS = 12

/**
 * Keeps the direction editor's counted numbers current.
 *
 * /goals was the one screen with no refresh loop. The wallpaper has
 * BoardRefresh and the CRM has SnapshotSync; the editor rendered once and then
 * froze, so a week's worth of outreach could land in crm_events without the
 * numbers on this page ever moving. Same stamp, same interval, third consumer.
 *
 * `router.refresh()` rather than the wallpaper's `location.reload()`. The
 * board keeps no client state worth preserving and the editor keeps a great
 * deal of it — a half-typed goal title, an open number field — and a hard
 * reload would eat it. A refresh re-runs the server component and merges the
 * new RSC payload "without losing unaffected client-side React (e.g. useState)"
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md),
 * which is precisely the split GoalsEditor is built around: the counted figures
 * are read straight from props and update, the editable rows live in useState
 * and are left alone.
 *
 * Note this is NOT the `refresh()` exported from next/cache in Next 16 — that
 * one is Server-Action-only and throws anywhere else. This is the client
 * router's method, which is unchanged.
 *
 * Also not SnapshotSync's merge-into-the-store approach: there is no goals
 * slice in the CRM store to merge into (see the header on GoalsEditor), so the
 * server round-trip is the only way these numbers move.
 *
 * Polling rather than Supabase Realtime, for the reason documented at length
 * on loadGoalsVersion() in lib/db/queries.ts: RLS gives an `anon` subscriber
 * nothing, and opening these tables to `anon` would put the company's goals and
 * revenue on the public internet.
 */
export function GoalsSync({ version }: { version: string }) {
  const router = useRouter()

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
        const stamp = await fetch('/api/goals/version', {
          signal,
          cache: 'no-store',
        })

        // Most likely a 401: the shared-password session expired. Refreshing
        // would replace a working editor with a login form mid-edit, so leave
        // the last good render up and let the next tick retry.
        if (!stamp.ok) return

        const { version: next } = (await stamp.json()) as { version?: unknown }

        // Compared against the prop, which is the stamp of what is actually on
        // screen right now, rather than against a stamp this component recorded
        // when it asked for a refresh. If a refresh never lands the prop never
        // moves, so the next tick tries again instead of concluding it is done.
        if (typeof next !== 'string' || next === version) return

        router.refresh()
      } catch {
        // Offline, aborted, or a malformed response. Silence is right: the
        // page keeps the last good numbers and the next tick retries.
      } finally {
        checking.current = false
      }
    },
    [router, version]
  )

  useEffect(() => {
    // 'demo' means there is no database behind this board, so the stamp can
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
