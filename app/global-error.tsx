'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import './globals.css'
import { getDictionary } from '@/lib/i18n/translations'
import type { AppLanguage } from '@/lib/types'

/**
 * Last-resort error boundary.
 *
 * Segment-level `error.tsx` boundaries do not wrap the layout above them, and
 * `loadSnapshot()` runs in the root layout — so a failed database read has no
 * boundary to catch it and renders a blank page. This is the only file that
 * catches it.
 *
 * It replaces the root layout when active, which means none of the usual chrome
 * exists here: no fonts from `next/font`, no `AppShell`, no store. It declares
 * its own `<html>`/`<body>` and imports the stylesheet itself. Keep the
 * dependency list short — this is the screen that has to work when the rest of
 * the app did not.
 *
 * Forced to the dark palette on purpose: the theme preference lives in
 * localStorage and the store, and neither is reachable from here. Reading
 * localStorage during render would desync the server and client markup, so this
 * follows the sidebar and modals in pinning `data-theme="dark"`.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  /**
   * Re-runs the failed render — for us, calls `loadSnapshot()` again, which is
   * exactly what a transient database fault needs. Optional and guarded: the
   * `unstable_` prefix means the name can change between Next releases, and a
   * renamed prop should degrade to a reload rather than break this page.
   */
  unstable_retry?: () => void
}) {
  const [language, setLanguage] = useState<AppLanguage>('sv')

  useEffect(() => {
    console.error('[khyte] fatal render error:', error)
  }, [error])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('khyte-settings')
      const saved = raw ? (JSON.parse(raw) as { language?: unknown }) : null
      if (saved?.language === 'en' || saved?.language === 'sv') {
        setLanguage(saved.language)
      }
    } catch {
      // The Swedish default remains usable if storage is unavailable or corrupt.
    }
  }, [])

  const t = getDictionary(language).globalError

  const retry = () => {
    if (unstable_retry) unstable_retry()
    else window.location.reload()
  }

  return (
    <html lang={language} data-theme="dark" className="h-full">
      <body className="h-full antialiased">
        <title>{t.pageTitle}</title>

        <main className="min-h-full flex items-center justify-center px-6 py-12">
          <div className="grain-modal w-full max-w-[460px] px-7 py-7">
            <div className="w-10 h-10 rounded-lg bg-danger-muted flex items-center justify-center mb-4">
              <AlertTriangle size={19} className="text-danger" />
            </div>

            <h1 className="text-[22px] font-display text-foreground tracking-tight">
              {t.title}
            </h1>

            <p className="mt-2 text-[14px] text-foreground/80 leading-relaxed">
              {t.message}
            </p>

            <p className="mt-2.5 text-[13px] text-foreground/70 leading-relaxed">
              {t.helpBeforeEnv}{' '}
              <code className="font-mono text-foreground/90">.env.local</code>{' '}
              {t.helpAfterEnv}
            </p>

            {error.digest && (
              <p className="mt-4 text-[12px] font-mono text-muted">
                {t.reference} <span className="text-foreground/80">{error.digest}</span>
              </p>
            )}

            <div className="flex items-center gap-2 mt-6">
              <button
                type="button"
                onClick={retry}
                className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-[14px] font-medium bg-accent text-background hover:bg-accent-hover transition-colors"
              >
                <RotateCcw size={14} />
                {t.retry}
              </button>
              <a
                href="/dashboard"
                className="h-9 px-3.5 flex items-center rounded-lg text-[14px] font-medium text-foreground hover:bg-surface-raised transition-colors"
              >
                {t.dashboard}
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  )
}
