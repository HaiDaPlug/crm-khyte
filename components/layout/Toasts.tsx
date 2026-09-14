'use client'

import { useEffect } from 'react'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { useCRMStore } from '@/lib/store'
import type { Toast } from '@/lib/store'
import { useTranslations } from '@/lib/hooks/useTranslations'
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
 */
export function Toasts() {
  const { t } = useTranslations()
  const toasts = useCRMStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-col gap-2 sm:bottom-6 sm:left-auto sm:right-6 sm:translate-x-0">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} saveFailedLabel={t.common.saveFailed} />
      ))}
    </div>
  )
}

function ToastRow({ toast, saveFailedLabel }: { toast: Toast; saveFailedLabel: string }) {
  const { t } = useTranslations()
  const dismissToast = useCRMStore((s) => s.dismissToast)
  const isError = toast.kind === 'error'

  useEffect(() => {
    if (isError) return
    const id = setTimeout(() => dismissToast(toast.id), SUCCESS_AUTO_DISMISS_MS)
    return () => clearTimeout(id)
  }, [isError, toast.id, dismissToast])

  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-lg backdrop-blur-sm',
        isError ? 'border-danger/45 bg-danger-muted' : 'border-success/40 bg-success-muted'
      )}
    >
      {isError ? (
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />
      ) : (
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
      )}
      <div className="min-w-0 flex-1">
        {isError && <p className="text-[13px] font-medium text-danger">{saveFailedLabel}</p>}
        <p
          className={cn(
            'text-[13px]',
            isError ? 'mt-0.5 truncate text-[12px] text-danger/80' : 'font-medium text-success'
          )}
          title={isError ? toast.message : undefined}
        >
          {toast.message}
        </p>
      </div>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        aria-label={t.common.dismiss}
        className={cn(
          'shrink-0 rounded-md p-1 transition-colors',
          isError
            ? 'text-danger/70 hover:bg-danger/10 hover:text-danger'
            : 'text-success/70 hover:bg-success/10 hover:text-success'
        )}
      >
        <X size={14} />
      </button>
    </div>
  )
}
