'use client'

import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDialogBehavior, useMounted } from '@/lib/hooks/useDialog'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

/**
 * A solid warning triangle. Lucide only ships the outline, and at badge size a
 * 2px stroke reads as timid next to a filled destructive button.
 *
 * Built as one filled path — stroked in the same colour with a round join so
 * the corners soften — with the exclamation punched out by a mask rather than
 * painted on. The knockout is genuinely transparent, so the badge's tint shows
 * through the mark instead of a near-match colour betraying itself against the
 * grain underneath.
 */
function AlertTriangleFilled({ size = 20, className }: { size?: number; className?: string }) {
  const maskId = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <mask id={maskId}>
        <rect width="24" height="24" fill="white" />
        <rect x="11.05" y="8.4" width="1.9" height="6" rx="0.95" fill="black" />
        <circle cx="12" cy="17.2" r="1.15" fill="black" />
      </mask>
      <path
        d="M12 3.6 L21.2 19.8 L2.8 19.8 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinejoin="round"
        mask={`url(#${maskId})`}
      />
    </svg>
  )
}

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  /** The destructive choice. */
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A confirmation for a destructive, unrecoverable action.
 *
 * Replaces `window.confirm`, which renders in the browser's own chrome — wrong
 * typeface, wrong palette, and it blocks the main thread while it's up. This
 * one stacks above whatever dialog raised it; the surface underneath stands
 * down via `suspended` so Escape lands here and focus stays in this panel.
 *
 * Focus opens on the safe choice: the destructive button should take a
 * deliberate move to reach, never a stray Enter.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslations()
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descId = useId()
  const mounted = useMounted()

  useDialogBehavior({ open, onClose: onCancel, panelRef })

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => cancelRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [open])

  if (!mounted || !open) return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px] animate-fade-in"
        onMouseDown={onCancel}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        data-theme="dark"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className="grain-modal relative w-[440px] max-w-full animate-modal-in outline-none"
      >
        <div className="flex items-center gap-4 px-6 pt-6 pb-5">
          <span className="w-10 h-10 rounded-full bg-danger-muted border border-danger/30 flex items-center justify-center shrink-0">
            <AlertTriangleFilled size={20} className="text-danger" />
          </span>
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-[19px] font-jakarta font-semibold text-foreground tracking-[-0.02em]"
            >
              {title}
            </h2>
            <p id={descId} className="mt-1.5 text-[14px] leading-relaxed text-foreground/80">
              {description}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border-subtle">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className={cn(
              'h-9 px-3.5 rounded-lg text-[14px] font-medium text-foreground',
              'border border-foreground/15 hover:border-foreground/30 hover:bg-surface-raised',
              'transition-colors'
            )}
          >
            {cancelLabel ?? t.common.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              'h-9 px-4 rounded-lg text-[14px] font-medium text-white',
              'bg-danger hover:brightness-110',
              'shadow-[0_0_0_0_var(--danger-muted)] hover:shadow-[0_0_18px_-2px_var(--danger)]',
              'transition-[filter,box-shadow] duration-150'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
