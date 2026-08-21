'use client'

import { ReactNode, useCallback, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useDialogBehavior, useMounted } from '@/lib/hooks/useDialog'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  footer?: ReactNode
  width?: string
  children: ReactNode
  onSubmitShortcut?: () => void
  /** True while a dialog stacked above owns the keyboard (see ConfirmDialog). */
  suspended?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  footer,
  width = 'w-[600px]',
  children,
  onSubmitShortcut,
  suspended = false,
}: ModalProps) {
  const { t } = useTranslations()
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const subtitleId = useId()
  const mounted = useMounted()

  const isSuspended = useCallback(() => suspended, [suspended])
  useDialogBehavior({ open, onClose, panelRef, suspended: isSuspended })

  const handlePanelKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (suspended) return
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onSubmitShortcut?.()
      }
    },
    [onSubmitShortcut, suspended]
  )

  if (!mounted || !open) return null

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[3px] animate-fade-in"
        onMouseDown={suspended ? undefined : onClose}
        aria-hidden="true"
      />

      <div className="relative h-full overflow-y-auto overscroll-contain flex py-6 px-4 pointer-events-none">
        <div
          ref={panelRef}
          data-theme="dark"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={subtitle ? subtitleId : undefined}
          tabIndex={-1}
          onKeyDown={handlePanelKeyDown}
          className={cn(
            'grain-modal m-auto max-w-full pointer-events-auto outline-none',
            'animate-modal-in',
            width
          )}
        >
          <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border-subtle">
            <div>
              <h2
                id={titleId}
                className="text-[20px] font-jakarta font-semibold text-foreground tracking-[-0.02em]"
              >
                {title}
              </h2>
              {subtitle && (
                <p id={subtitleId} className="text-[14px] text-foreground/80 mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.crm.modal.closeDialog}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-raised text-foreground/70 hover:text-foreground transition-colors shrink-0"
            >
              <X size={17} />
            </button>
          </div>

          {children}

          {footer && (
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border-subtle">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
