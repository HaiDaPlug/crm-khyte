import { Stage, Priority } from '@/lib/types'

export const STAGES: Stage[] = [
  'New', 'Ongoing', 'Contacted', 'Warm',
  'Meeting Booked', 'Proposal Sent', 'Negotiation', 'Won', 'Lost',
]

/**
 * The nine stages are a sequence, not nine unrelated labels, so the tag encodes
 * progression rather than just picking a hue per stage: neutral at the top of the
 * funnel, warming through the middle, resolved at the end. Every entry carries a
 * visible border and a text color a full step darker/brighter than the fill —
 * at 10% tint alone the middle stages collapsed into one pastel wash, and
 * Contacted/Ongoing and Proposal Sent/Negotiation were near-indistinguishable.
 *
 * Colors come from `--stage-*` tokens in globals.css, defined per theme, rather
 * than Tailwind's stock palette: a `sky-400` chip that reads clearly on the dark
 * `#242220` surface washes out on the light theme's warm `#E8E3DB`. Tokens also
 * avoid Tailwind's `dark:` variant, which follows prefers-color-scheme and would
 * fight this app's own `[data-theme]` toggle. See `stageDot` for the companion
 * marker that keeps stages distinguishable without relying on hue.
 */
export const stageColors: Record<Stage, string> = {
  'New':            'bg-surface-raised text-foreground-dim border border-border-subtle',
  'Ongoing':        'bg-stage-ongoing-fill text-stage-ongoing-text border border-stage-ongoing-edge',
  'Contacted':      'bg-stage-contacted-fill text-stage-contacted-text border border-stage-contacted-edge',
  'Warm':           'bg-stage-warm-fill text-stage-warm-text border border-stage-warm-edge',
  'Meeting Booked': 'bg-stage-meeting-fill text-stage-meeting-text border border-stage-meeting-edge',
  'Proposal Sent':  'bg-stage-proposal-fill text-stage-proposal-text border border-stage-proposal-edge',
  'Negotiation':    'bg-stage-negotiation-fill text-stage-negotiation-text border border-stage-negotiation-edge',
  // The two terminal states are the only ones that break the tinted-chip pattern
  // — a closed deal should be findable in a dense table without reading labels.
  'Won':            'bg-success text-background border border-success font-semibold',
  'Lost':           'bg-danger-muted text-danger border border-danger/45 line-through decoration-danger/40',
}

/**
 * Companion dot for the stage tag, so the stage survives being skimmed at a
 * glance and doesn't rely on hue alone (color-blind readers, grayscale printing).
 * Same fixed-hex rationale as `priorityDot`.
 */
export const stageDot: Record<Stage, string> = {
  'New':            '#9A938A',
  'Ongoing':        '#64748B',
  'Contacted':      '#0EA5E9',
  'Warm':           '#F97316',
  'Meeting Booked': '#8B5CF6',
  'Proposal Sent':  '#F59E0B',
  'Negotiation':    '#D946EF',
  'Won':            '#4CAF72',
  'Lost':           '#E05252',
}

// Fixed hex values (not theme tokens) — a priority dot must read as the same
// color in light and dark mode, so it can't ride on --accent/--muted, which
// are intentionally different per theme.
export const priorityDot: Record<Priority, string> = {
  critical: '#E05252',
  high:     '#E09040',
  medium:   '#D4943C',
  low:      '#4CAF72',
}

/**
 * Richer, more saturated ramp for the priority slider. Kept separate from
 * `priorityDot` (which stays flat and legible at 6px) because a large fill
 * needs deeper, less washed-out color to read as premium rather than pastel.
 * Runs cool teal → gold → amber → deep crimson.
 */
export const priorityRamp: Record<Priority, { from: string; to: string }> = {
  low:      { from: '#219E72', to: '#3FBF8F' },
  medium:   { from: '#C9922F', to: '#E8B455' },
  high:     { from: '#D97430', to: '#F0954A' },
  critical: { from: '#C63F3F', to: '#E86767' },
}
