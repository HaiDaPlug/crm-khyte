'use client'

import { useEffect } from 'react'

/**
 * Pulls fresh data into the wallpaper on a timer.
 *
 * A full `location.reload()` rather than `router.refresh()`, deliberately.
 * The board keeps no client state worth preserving, and a hard reload is the
 * only thing that reliably survives Lively's Chromium embed being suspended
 * and resumed when the desktop is hidden behind a fullscreen window — a
 * router refresh depends on a live React tree and an open RSC connection,
 * both of which that suspend/resume cycle can quietly break, leaving the
 * wallpaper frozen on a stale board with nothing to indicate it.
 *
 * A `<meta http-equiv="refresh">` would do the same with no JavaScript, but
 * Next strips unknown meta from the App Router's head, and this way the
 * interval is a prop rather than a magic string.
 */
export function BoardRefresh({ seconds }: { seconds: number }) {
  useEffect(() => {
    const id = setInterval(() => {
      // Preserves the query string, so the display token survives the reload.
      // Without this the wallpaper would bounce to /login on its first refresh.
      window.location.reload()
    }, seconds * 1000)

    return () => clearInterval(id)
  }, [seconds])

  return null
}
