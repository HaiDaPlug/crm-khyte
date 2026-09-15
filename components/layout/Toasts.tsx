'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, X } from 'lucide-react'
import { useCRMStore } from '@/lib/store'
import type { Toast } from '@/lib/store'
import { useTranslations } from '@/lib/hooks/useTranslations'
import type { Dictionary } from '@/lib/i18n/translations'
import { cn } from '@/lib/utils'

/** How long a success toast stays up before it clears itself. Errors persist
 *  until dismissed — a save failure is worth making someone deal with. */
const SUCCESS_AUTO_DISMISS_MS = 3_500

/**
 * Feedback for writes with no other visible confirmation.
 *
 * `syncError` used to be set and never read — a failed save was visible only
 * in the console, so an optimistic row that never made it to the server would
 * sit on screen looking saved until the next snapshot poll quietly removed it
 * with nothing to explain why. This makes that failure loud at the moment it
 * happens. Success toasts close the other half of the gap: a create or a
 * delete has no animation of its own, so without one there was no way to
 * tell "saved" apart from "still saving" apart from "silently lost."
 *
 * Loud, not obstructive: the stack is `pointer-events-none` so it never eats a
 * click meant for the board underneath — only the cards themselves take the
 * pointer, and only to be read or dismissed.
 */
export function Toasts() {
  const { t } = useTranslations()
  const toasts = useCRMStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2 sm:bottom-6 sm:left-auto sm:right-6 sm:translate-x-0">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} copy={t.common} />
      ))}
    </div>
  )
}

function ToastRow({ toast, copy }: { toast: Toast; copy: Dictionary['common'] }) {
  const dismissToast = useCRMStore((s) => s.dismissToast)
  const isError = toast.kind === 'error'
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    if (isError) return
    const id = setTimeout(() => dismissToast(toast.id), SUCCESS_AUTO_DISMISS_MS)
    return () => clearTimeout(id)
  }, [isError, toast.id, dismissToast])

  return (
    <div
      role={isError ? 'alert' : 'status'}
      style={{ '--toast-duration': `${SUCCESS_AUTO_DISMISS_MS}ms` } as React.CSSProperties}
      className={cn(
        // One neutral ground for both kinds — near-black on the dark theme,
        // white on the light one. Only the edge, the icon and the timer carry
        // the status colour, so an error reads as serious without the whole
        // card turning red.
        'toast-shell animate-toast-in pointer-events-auto relative overflow-hidden rounded-xl',
        'border bg-toast-surface backdrop-blur-xl',
        isError ? 'border-danger/35' : 'border-success/30'
      )}
    >
      {/* The status rail. Carries the colour at full strength in the one place
          it costs no legibility. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-0 w-[3px]',
          isError ? 'bg-danger' : 'bg-success'
        )}
      />

      <div className="flex items-start gap-3 py-3 pl-4 pr-2.5">
        <span
          className={cn(
            'mt-px flex size-6 shrink-0 items-center justify-center rounded-lg',
            isError ? 'bg-danger/12 text-danger' : 'bg-success/12 text-success'
          )}
        >
          {isError ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
        </span>

        <div className="min-w-0 flex-1">
          {/* Same face as modal titles — a toast is the other thing that opens
              on top of the app, and it should sound like it. */}
          <p className="font-jakarta text-[13.5px] font-semibold leading-5 tracking-[-0.01em] text-foreground">
            {isError ? copy.saveFailed : toast.message}
          </p>

          {isError && (
            <>
              {/* Plain language first: what it means for the thing they were
                  just doing. The server's own words are a click away rather
                  than in their face — most of the time "try again" is the
                  whole answer, and when it isn't, the detail is verbatim and
                  selectable for a bug report. */}
              <p className="mt-1 text-[12.5px] leading-[1.45] text-muted-foreground">
                {copy.saveFailedHint}
              </p>
              <button
                type="button"
                onClick={() => setShowDetails((open) => !open)}
                aria-expanded={showDetails}
                className="mt-1.5 -ml-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-[11.5px] font-medium text-muted transition-colors hover:text-foreground"
              >
                <ChevronDown
                  size={12}
                  className={cn('transition-transform duration-150', showDetails && 'rotate-180')}
                />
                {showDetails ? copy.hideDetails : copy.showDetails}
              </button>
              {showDetails && (
                <p className="mt-1.5 max-h-28 overflow-y-auto rounded-lg bg-surface-raised/60 px-2.5 py-2 font-mono text-[11.5px] leading-[1.5] break-words text-foreground-dim">
                  {toast.message}
                </p>
              )}
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => dismissToast(toast.id)}
          aria-label={copy.dismiss}
          className="-mr-0.5 shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>

      {/* Only the self-dismissing kind gets a countdown; an error sits there
          until someone deals with it, and a draining bar would promise
          otherwise. */}
      {!isError && (
        <span
          aria-hidden="true"
          className="toast-timer absolute inset-x-0 bottom-0 h-px bg-success/50"
        />
      )}
    </div>
  )
}
