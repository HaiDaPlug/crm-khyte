import { useEffect } from 'react'

interface UseBoardPanOptions {
  /** Passed while something else owns the pointer (e.g. a dnd-kit drag in flight). */
  disabled?: boolean
  /**
   * Extra selector added to the default press-through list (interactive
   * controls, and anything dnd-kit marks as sortable) for click-drag panning.
   * A data grid passes `tr, th` — grab-to-pan over a clickable/sortable row
   * would otherwise fight the row's own click.
   */
  panExcludeSelector?: string
  /**
   * Selector the wheel-to-horizontal conversion below won't fire over — e.g.
   * `[aria-roledescription="sortable"]` for a kanban board, so a normal
   * two-finger scroll over a card still scrolls the page instead of panning
   * the whole board sideways. Unset by default: nothing is excluded, since a
   * plain data grid has no content that a vertical scroll should reach past.
   */
  wheelExcludeSelector?: string
}

/**
 * Pan a horizontally-scrolling container by dragging its background, or by
 * rolling a wheel over it.
 *
 * `overflow-x: auto` already answers a trackpad's sideways gesture, but a
 * plain vertical wheel is the only gesture a mouse has, and over a board with
 * no vertical overflow it did nothing at all. There was also no way to simply
 * grab the board and throw it sideways.
 *
 * Both listeners are bound to `ref`'s own element, not `window` — this never
 * reaches outside the scrolling container (the sidebar, other panels, etc.
 * are untouched regardless of where the pointer is).
 *
 * Extracted from the pipeline board, where it runs alongside dnd-kit.
 */
export function useBoardPan(
  ref: React.RefObject<HTMLDivElement | null>,
  options: UseBoardPanOptions = {}
) {
  const { disabled = false, panExcludeSelector, wheelExcludeSelector } = options

  useEffect(() => {
    const el = ref.current
    if (!el || disabled) return

    const maxScroll = () => el.scrollWidth - el.clientWidth

    // A vertical wheel becomes horizontal travel — but only while the board
    // still has somewhere to go, and not over content a normal scroll should
    // still reach (a card's own text, say). At either end, or over excluded
    // content, the event is left alone so the page keeps scrolling normally
    // instead of the board swallowing it.
    const onWheel = (event: WheelEvent) => {
      if (event.shiftKey || event.ctrlKey) return // shift/zoom are the browser's
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return // already sideways
      if (wheelExcludeSelector) {
        const target = event.target as HTMLElement | null
        if (target?.closest(wheelExcludeSelector)) return
      }
      const max = maxScroll()
      if (max <= 0) return
      const next = Math.max(0, Math.min(max, el.scrollLeft + event.deltaY))
      if (next === el.scrollLeft) return
      event.preventDefault()
      el.scrollLeft = next
    }

    const panExcluded = panExcludeSelector
      ? `[aria-roledescription="sortable"], button, a, input, textarea, ${panExcludeSelector}`
      : '[aria-roledescription="sortable"], button, a, input, textarea'

    let panFrom = 0
    let scrollFrom = 0
    let panning = false

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || maxScroll() <= 0) return
      const target = event.target as HTMLElement | null
      // A press on a card belongs to dnd-kit (which marks its draggables with
      // aria-roledescription), and a press on a control belongs to the control.
      if (target?.closest(panExcluded)) return

      panning = true
      panFrom = event.clientX
      scrollFrom = el.scrollLeft
      el.setPointerCapture(event.pointerId)
      el.style.cursor = 'grabbing'
      el.style.userSelect = 'none'
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!panning) return
      el.scrollLeft = scrollFrom - (event.clientX - panFrom)
    }

    const endPan = (event: PointerEvent) => {
      if (!panning) return
      panning = false
      el.style.cursor = ''
      el.style.userSelect = ''
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', endPan)
    el.addEventListener('pointercancel', endPan)

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', endPan)
      el.removeEventListener('pointercancel', endPan)
      el.style.cursor = ''
      el.style.userSelect = ''
    }
  }, [ref, disabled, panExcludeSelector, wheelExcludeSelector])
}
