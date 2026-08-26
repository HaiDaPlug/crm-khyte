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
      {/*
        Purely the scrim. The scroll container below is positioned and painted
        over this, so it — not this element — is what a pointer actually hits;
        the close-on-press lives there.
      */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[3px] animate-fade-in"
        aria-hidden="true"
      />

      {/*
        The scroll container.

        `pointer-events` stays on here rather than being switched off and
        re-enabled on the panel. Touch scrolling is hit-test driven: a finger
        drag scrolls the nearest scrollable ancestor *of the element under the
        finger*, so with pointer-events:none on this element a drag starting
        over the panel found no scrollable ancestor and did nothing. A wheel
        works either way, which is why this only ever showed up on mobile.

        Click-outside-to-close is handled by the backdrop sibling above, so
        nothing here needs to be transparent to the pointer.

        Height is 100dvh, not h-full: `height:100%` against a fixed inset-0
        parent resolves to the layout viewport, which on mobile sits behind the
        browser's collapsing URL bar and cut off the bottom of a tall form.
      */}
      <div
        className={cn(
          'relative flex h-[100dvh] overflow-y-auto overscroll-contain py-2',
          '[padding-left:max(0.5rem,env(safe-area-inset-left))] [padding-right:max(0.5rem,env(safe-area-inset-right))]',
          '[padding-top:max(0.5rem,env(safe-area-inset-top))] [padding-bottom:max(0.5rem,env(safe-area-inset-bottom))]',
          'sm:py-6 sm:[padding-top:1.5rem] sm:[padding-bottom:1.5rem]',
          'sm:[padding-left:max(1rem,env(safe-area-inset-left))] sm:[padding-right:max(1rem,env(safe-area-inset-right))]'
        )}
        onMouseDown={(e) => {
          // The panel no longer shields this element from the pointer, so a
          // press landing on the padding around it still has to close — that
          // gap used to belong to the backdrop underneath.
          if (!suspended && e.target === e.currentTarget) onClose()
        }}
      >
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
            'grain-modal m-auto max-w-full outline-none',
            'animate-modal-in',
            width
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-4 pb-4 pt-5 sm:px-7 sm:pb-5 sm:pt-6">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[20px] font-jakarta font-semibold text-foreground tracking-[-0.02em] leading-tight sm:text-[22px] sm:leading-none"
              >
                {title}
              </h2>
              {subtitle && (
                <p id={subtitleId} className="mt-1.5 text-[14px] leading-relaxed text-foreground/65 sm:text-[14.5px]">
                  {subtitle}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.crm.modal.closeDialog}
              className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg text-foreground/60 transition-colors hover:bg-surface-raised hover:text-foreground sm:mr-0 sm:mt-0 sm:h-9 sm:w-9"
            >
              <X size={17} />
            </button>
          </div>

          {children}

          {footer && (
            <div className="flex flex-col items-stretch gap-3 border-t border-border-subtle px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-5">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
