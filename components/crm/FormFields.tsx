'use client'

import {
  memo,
  ReactNode,
  Ref,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Check, Plus, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

export const inputClass = cn(
  'w-full h-10 px-3 bg-background-raised border border-border-subtle rounded-lg',
  'text-[15px] text-foreground placeholder:text-foreground/50 outline-none',
  // Only border-color actually changes on hover/focus. Transitioning just that
  // property (rather than every color) keeps the response crisp instead of
  // retargeting a 150ms multi-property tween on each pointer move.
  'hover:border-border focus:border-accent/50',
  'transition-[border-color] duration-100 ease-out'
)

/**
 * A labelled form row.
 *
 * Only the mandatory fields carry a marker. Tagging every other field
 * "optional" was the noisier half of the same information, and in a two-column
 * grid the suffix wrapped onto a second line in the narrow columns — which
 * pushed one column's input below the other's.
 */
export function Field({
  label,
  required,
  hint,
  htmlFor,
  children,
}: {
  label: string
  required?: boolean
  /** Status shown at the right end of the label row, e.g. a combobox's <ComboHint>. */
  hint?: ReactNode
  htmlFor?: string
  children: ReactNode
}) {
  const { t } = useTranslations()
  return (
    <div>
      <label htmlFor={htmlFor} className="label-mono mb-2 flex items-center gap-1 whitespace-nowrap">
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="text-accent">*</span>
            <span className="sr-only">{t.common.required}</span>
          </>
        )}
        {/* Inherits the label's mono/uppercase/tracking, a step smaller — the
            status reads as part of the label row rather than prose beside it. */}
        {hint && <span className="ml-auto text-[11px]">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

export type ComboStatus = 'idle' | 'linked' | 'creating'

/**
 * What the combobox will do with the current query: link the record the user
 * picked, create a new one from what they typed, or nothing yet.
 *
 * Exported so a caller can render the same status next to the field label. It
 * used to sit under the input, which put a line of prose between a field and
 * the ones below it and left the two columns of a grid out of step.
 */
export function comboStatus(
  query: string,
  options: ComboOption[],
  selectedId: string | null
): ComboStatus {
  if (selectedId && options.some((o) => o.id === selectedId)) return 'linked'
  const q = query.trim().toLowerCase()
  if (!q) return 'idle'
  return options.some((o) => o.label.toLowerCase() === q) ? 'idle' : 'creating'
}

/** The compact form of `comboStatus`, for a Field's `hint` slot. */
export function ComboHint({ status }: { status: ComboStatus }) {
  const { t } = useTranslations()
  if (status === 'idle') return null
  const linked = status === 'linked'
  return (
    <span className="flex items-center gap-1.5 text-accent">
      {linked ? <Sparkles size={11} /> : <Plus size={11} />}
      {linked ? t.common.autofilled : t.common.willBeCreated}
    </span>
  )
}

interface ColorSliderProps<T extends string> {
  /** Ordered low→high; index in this array is the slider position. */
  steps: readonly T[]
  value: T
  onChange: (next: T) => void
  /** Step → gradient stops. Drives the fill and the thumb. */
  colors: Record<T, { from: string; to: string }>
  label: string
  valueLabels?: Record<T, string>
}

/**
 * A discrete slider that communicates its value through color and position
 * rather than a text label. Drag the thumb, click anywhere on the track, or use
 * arrow keys / Home / End.
 */
/** Thumb diameter in px. */
const THUMB = 20
/** Breathing room between the pill's inner edge and the thumb at either end. */
const INSET = 5

export function ColorSlider<T extends string>({
  steps,
  value,
  onChange,
  colors,
  label,
  valueLabels,
}: ColorSliderProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const index = Math.max(0, steps.indexOf(value))
  const lastIndex = steps.length - 1
  const ratio = lastIndex === 0 ? 0 : index / lastIndex

  const activeColor = colors[value]

  // A single-hue wash of the active colour. Blending across the full ramp was
  // tried and looked muddy: interpolating green→gold passes through olive, and
  // gold→red through brown, so the middle of the bar turned to sludge. One hue,
  // dark to light, keeps the fill clean and still shifts colour per step.
  const fillGradient = useMemo(
    () => `linear-gradient(90deg, ${colors[value].from} 0%, ${colors[value].to} 100%)`,
    [colors, value]
  )

  // Map a clientX to the nearest step. Measured against the same element the
  // thumb is positioned within, and over the thumb's actual travel range, so
  // the pointer lands exactly where the thumb ends up.
  const applyFromClientX = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect) return
      // Travel is inset at both ends, so the thumb never touches the pill edge.
      const travel = rect.width - THUMB - INSET * 2
      if (travel <= 0) return
      const r = Math.min(
        1,
        Math.max(0, (clientX - rect.left - INSET - THUMB / 2) / travel)
      )
      const next = steps[Math.round(r * lastIndex)]
      if (next && next !== value) onChange(next)
    },
    [steps, lastIndex, onChange, value]
  )

  // Pointer capture keeps the drag alive even when the cursor leaves the track.
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    applyFromClientX(e.clientX)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    applyFromClientX(e.clientX)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setDragging(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = index + 1
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = index - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = lastIndex
    if (next === null) return
    e.preventDefault()
    const clamped = Math.min(lastIndex, Math.max(0, next))
    if (steps[clamped] !== value) onChange(steps[clamped])
  }

  const glide = !dragging && 'transition-[left,background-color] duration-150 ease-out'

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={lastIndex}
      aria-valuenow={index}
      aria-valuetext={valueLabels?.[value] ?? value}
      aria-orientation="horizontal"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      className={cn(
        // A single contained pill: the thumb rides inside it, never past its edge.
        'group relative h-10 w-full rounded-full cursor-pointer select-none touch-none overflow-hidden',
        'bg-background-raised border border-border-subtle outline-none',
        'shadow-[inset_0_1px_3px_rgba(0,0,0,0.35)]',
        'hover:border-border focus-visible:border-accent/50',
        'transition-[border-color] duration-100 ease-out'
      )}
    >
      {/* Gradient fill — flush left edge to the thumb's trailing edge, with a
          rounded cap so it wraps the thumb instead of cutting off square. The
          left end stays flush because the parent pill clips it. Ending at the
          thumb's centre left a dark crescent at the last step, so the fill runs
          the full width there. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-0 rounded-full pointer-events-none',
          !dragging && 'transition-[width] duration-150 ease-out'
        )}
        // `background` can't tween between gradients, so the colour swap is a
        // hard cut hidden under the thumb's own movement.
        style={{
          width:
            index === lastIndex
              ? '100%'
              : `calc(${INSET + THUMB}px + ${ratio} * (100% - ${THUMB + INSET * 2}px))`,
          background: fillGradient,
        }}
      />

      {/* Step markers — the discrete stops. Sit above the fill; the one under
          the thumb hides as it arrives. */}
      {steps.map((s, i) => {
        const dotRatio = lastIndex === 0 ? 0 : i / lastIndex
        return (
          <span
            key={s}
            aria-hidden="true"
            className={cn(
              'absolute top-1/2 w-[3px] h-[3px] rounded-full -translate-y-1/2 -translate-x-1/2 pointer-events-none',
              'transition-opacity duration-150'
            )}
            style={{
              left: `calc(${INSET + THUMB / 2}px + ${dotRatio} * (100% - ${THUMB + INSET * 2}px))`,
              // Dots on the filled side read as light-on-colour; those ahead of
              // the thumb sit on the bare track and need the neutral treatment.
              background: i < index ? 'rgba(255,255,255,0.4)' : 'var(--border)',
              opacity: i === index ? 0 : 1,
            }}
          />
        )
      })}

      {/* Thumb */}
      <span
        className={cn(
          'absolute top-1/2 rounded-full -translate-y-1/2 pointer-events-none',
          'shadow-[0_2px_8px_rgba(0,0,0,0.5)]',
          glide
        )}
        style={{
          width: THUMB,
          height: THUMB,
          left: `calc(${INSET}px + ${ratio} * (100% - ${THUMB + INSET * 2}px))`,
          background: `linear-gradient(160deg, ${activeColor.to}, ${activeColor.from})`,
          boxShadow: `0 2px 8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.22)`,
        }}
      />
    </div>
  )
}

export interface ComboOption {
  id: string
  label: string
  meta?: string
}

interface ComboboxProps {
  icon?: ReactNode
  placeholder: string
  query: string
  onQueryChange: (q: string) => void
  options: ComboOption[]
  selectedId: string | null
  onSelect: (id: string) => void
  inputRef?: Ref<HTMLInputElement>
  id?: string
}

function ComboboxImpl({
  icon,
  placeholder,
  query,
  onQueryChange,
  options,
  selectedId,
  onSelect,
  inputRef,
  id,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const generatedId = useId()
  const inputId = id ?? generatedId
  const listId = `${inputId}-listbox`

  const q = query.trim().toLowerCase()

  const filtered = useMemo(
    () => (q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options),
    [options, q]
  )

  const selected = useMemo(
    () => (selectedId ? options.find((o) => o.id === selectedId) ?? null : null),
    [options, selectedId]
  )

  const showList = open && !selected && filtered.length > 0

  // A changing filter can strand the highlight past the end of the list.
  useEffect(() => {
    setActiveIndex((i) => (i >= filtered.length ? 0 : i))
  }, [filtered.length])

  // Keep the highlighted row in view during keyboard traversal.
  useEffect(() => {
    if (!showList) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, showList])

  // Each direct child of `.grain-modal` is its own stacking context, so an open
  // list would otherwise paint behind later sections. Flag the section we live
  // in while the list is open and let CSS raise it, then clean up on close.
  useEffect(() => {
    const section = wrapRef.current?.closest<HTMLElement>('.grain-modal > *')
    if (!section) return
    if (!showList) return
    section.dataset.layerRaised = 'true'
    return () => {
      delete section.dataset.layerRaised
    }
  }, [showList])

  // Close on any click outside — lets the user drag-scroll the list without
  // it collapsing, which a plain `onBlur` would have broken.
  useEffect(() => {
    if (!open) return
    const handlePointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const commit = useCallback(
    (optionId: string) => {
      onSelect(optionId)
      setOpen(false)
      setActiveIndex(0)
    },
    [onSelect]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Re-open a list the user dismissed, without needing to retype.
      if (!showList) {
        if (!selected && filtered.length > 0) {
          e.preventDefault()
          setOpen(true)
          setActiveIndex(0)
        }
        return
      }
      e.preventDefault()
      const delta = e.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((i) => (i + delta + filtered.length) % filtered.length)
      return
    }

    if (e.key === 'Home' && showList) {
      e.preventDefault()
      setActiveIndex(0)
      return
    }

    if (e.key === 'End' && showList) {
      e.preventDefault()
      setActiveIndex(filtered.length - 1)
      return
    }

    if (e.key === 'Enter') {
      if (showList && filtered[activeIndex]) {
        // Only swallow Enter when it's actually picking an option, so the
        // modal's ⌘↵ submit still works from this input.
        e.preventDefault()
        commit(filtered[activeIndex].id)
      }
      return
    }

    if (e.key === 'Escape' && showList) {
      // Dismiss the list first; a second Escape reaches the modal.
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      return
    }

    if (e.key === 'Tab' && showList) setOpen(false)
  }

  const activeId = showList && filtered[activeIndex] ? `${listId}-${filtered[activeIndex].id}` : undefined

  return (
    <div className="relative" ref={wrapRef}>
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/70 pointer-events-none">
            {icon}
          </span>
        )}
        <input
          id={inputId}
          ref={inputRef}
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value)
            setOpen(true)
            setActiveIndex(0)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          autoComplete="off"
          className={cn(inputClass, icon && 'pl-9', selected && 'pr-8 border-accent/40')}
        />
        {selected && (
          <Check
            size={15}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-accent pointer-events-none"
          />
        )}
      </div>

      {showList && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-20 bg-surface-raised border border-border rounded-lg shadow-[0_12px_32px_-8px_rgba(0,0,0,0.75)] overflow-hidden animate-popover-in">
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            className="max-h-[216px] overflow-y-auto overscroll-contain p-1"
          >
            {filtered.map((o, i) => (
              <button
                key={o.id}
                id={`${listId}-${o.id}`}
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                data-index={i}
                tabIndex={-1}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => {
                  // Keep focus in the input so the field doesn't flicker.
                  e.preventDefault()
                  commit(o.id)
                }}
                className={cn(
                  // No transition: the highlight tracks the cursor and arrow
                  // keys, so any tween reads as the list lagging behind input.
                  'w-full text-left px-2.5 py-2 rounded-md',
                  i === activeIndex && 'bg-accent/15'
                )}
              >
                <p className="text-[14.5px] text-foreground">{o.label}</p>
                {o.meta && <p className="text-[12.5px] text-foreground/70 truncate">{o.meta}</p>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* Memoized so typing in an unrelated field (deal value, notes, tags) doesn't
   re-render the comboboxes and their option lists. Callers must pass stable
   `options` / `onSelect` / `onQueryChange` references for this to bite. */
export const Combobox = memo(ComboboxImpl)
