'use client'

import { RefObject, useEffect, useRef, useState } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Nested dialogs each add a lock; the scroll only unlocks when the last one goes. */
let scrollLocks = 0

function lockScroll() {
  if (scrollLocks++ > 0) return
  const { body, documentElement } = document
  // Compensate for the vanishing scrollbar so the page behind doesn't shift.
  const gap = window.innerWidth - documentElement.clientWidth
  body.dataset.prevOverflow = body.style.overflow
  body.dataset.prevPadding = body.style.paddingRight
  body.style.overflow = 'hidden'
  if (gap > 0) body.style.paddingRight = `${gap}px`
}

function unlockScroll() {
  if (--scrollLocks > 0) return
  scrollLocks = 0
  const { body } = document
  body.style.overflow = body.dataset.prevOverflow ?? ''
  body.style.paddingRight = body.dataset.prevPadding ?? ''
  delete body.dataset.prevOverflow
  delete body.dataset.prevPadding
}

/** Portals need a DOM target, which only exists after mount. */
export function useMounted() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}

interface DialogBehaviorOptions {
  open: boolean
  onClose: () => void
  panelRef: RefObject<HTMLElement | null>
  /**
   * Return true to let a nested editor consume Escape instead of closing the
   * dialog. The keydown listener is registered in capture phase, so an inner
   * handler's `stopPropagation` can never pre-empt it — the dialog has to ask.
   */
  shouldIgnoreEscape?: () => boolean
  /**
   * Return true while a dialog stacked above this one owns the keyboard. Both
   * dialogs listen on the document in capture phase and the outer one is always
   * registered first, so it has to stand down deliberately — otherwise Escape
   * would close the whole modal out from under a confirmation, and Tab would
   * yank focus back into the panel underneath.
   */
  suspended?: () => boolean
}

/**
 * The behaviour every modal surface owes the user: Escape closes, Tab stays
 * inside the panel, the page behind doesn't scroll or shift, and focus returns
 * to whatever opened it. Shared so the modal and the drawer can't drift apart —
 * in particular so they lock the page scroll through one counter instead of two.
 */
export function useDialogBehavior({
  open,
  onClose,
  panelRef,
  shouldIgnoreEscape,
  suspended,
}: DialogBehaviorOptions) {
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  // `onClose` is read inside a document-level listener; a ref keeps that handler
  // stable so it isn't torn down and rebuilt on every parent render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const ignoreEscapeRef = useRef(shouldIgnoreEscape)
  useEffect(() => {
    ignoreEscapeRef.current = shouldIgnoreEscape
  }, [shouldIgnoreEscape])

  const suspendedRef = useRef(suspended)
  useEffect(() => {
    suspendedRef.current = suspended
  }, [suspended])

  useEffect(() => {
    if (!open) return

    restoreFocusRef.current = document.activeElement as HTMLElement | null
    lockScroll()

    const handleKeyDown = (e: KeyboardEvent) => {
      // A dialog above this one is driving; let its own listener have the key.
      if (suspendedRef.current?.()) return

      if (e.key === 'Escape') {
        // A nested editor gets first refusal — it handles its own cancel.
        if (ignoreEscapeRef.current?.()) return
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return

      const panel = panelRef.current
      if (!panel) return
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      )
      if (nodes.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }

      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement

      // Wrap at both ends, and pull focus back in if it ever escaped the panel.
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      unlockScroll()
      // Hand focus back to whatever opened the dialog.
      restoreFocusRef.current?.focus?.()
    }
  }, [open, panelRef])
}
