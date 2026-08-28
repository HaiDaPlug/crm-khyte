'use client'

import { useEffect, useRef } from 'react'

/**
 * Keeps the wallpaper current.
 *
 * Two loops, doing different jobs.
 *
 * The fast one asks ./version whether anything on the board has changed and
 * reloads only when the stamp differs from the one this page was rendered with.
 * That is what makes an edit in /goals appear on the desktop in seconds rather
 * than at the mercy of a five-minute timer, without re-rendering the page over
 * and over to find out nothing moved.
 *
 * The slow one reloads unconditionally, and it is not redundant: it is the
 * backstop for everything the stamp cannot see — a deploy that changed the
 * board's own markup, a version request that has been quietly failing, a
 * machine that slept through several intervals. Cheap insurance at this period.
 *
 * A full `location.reload()` rather than `router.refresh()`, deliberately. The
 * board keeps no client state worth preserving, and a hard reload is the only
 * thing that reliably survives Lively's Chromium embed being suspended and
 * resumed when the desktop is hidden behind a fullscreen window — a router
 * refresh depends on a live React tree and an open RSC connection, both of
 * which that cycle can quietly break, leaving the wallpaper frozen on a stale
 * board with nothing to indicate it.
 *
 * Note this polls rather than subscribing to Supabase Realtime. The reason is
 * RLS, and it is documented on loadGoalsVersion() in lib/db/queries.ts.
 */
export function BoardRefresh({
  seconds,
  checkSeconds,
  version,
}: {
  /** Unconditional reload period — the backstop. */
  seconds: number
  /** How often to ask whether anything changed. */
  checkSeconds: number
  /** The stamp this page was rendered with. A change means reload. */
  version: string
}) {
  // Held in a ref so the polling effect does not re-subscribe when it changes,
  // and so a reload already in flight cannot be triggered twice.
  const reloading = useRef(false)

  useEffect(() => {
    const id = setInterval(() => {
      window.location.reload()
    }, seconds * 1000)

    return () => clearInterval(id)
  }, [seconds])

  useEffect(() => {
    // 'demo' means there is no database behind this board, so the stamp can
    // never change — polling would be pure noise.
    if (version === 'demo') return

    const controller = new AbortController()

    async function check() {
      if (reloading.current) return

      try {
        // Same-origin and relative, so the colleague segment and the display
        // token in the query string both carry over untouched — the endpoint
        // needs the token, and hardcoding a path here would drop it.
        const response = await fetch(`./version${window.location.search}`, {
          signal: controller.signal,
          cache: 'no-store',
        })

        // A 401 here means the token stopped being valid (DISPLAY_SECRET was
        // rotated). Reloading would land on /login and replace the board with a
        // password form; leaving the last good board up is the better failure
        // for a wallpaper, and the slow loop will surface it eventually.
        if (!response.ok) return

        const data: unknown = await response.json()
        const next =
          typeof data === 'object' && data !== null && 'version' in data
            ? String((data as { version: unknown }).version)
            : null

        if (next && next !== version) {
          reloading.current = true
          window.location.reload()
        }
      } catch {
        // Offline, aborted, or a malformed response. Silence is right: the
        // board keeps showing the last good render and the next tick retries.
      }
    }

    const id = setInterval(check, checkSeconds * 1000)

    return () => {
      controller.abort()
      clearInterval(id)
    }
  }, [checkSeconds, version])

  return null
}
