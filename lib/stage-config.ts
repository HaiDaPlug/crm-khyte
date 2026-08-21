import { Stage, Priority } from '@/lib/types'

export const STAGES: Stage[] = [
  'New', 'Researched', 'Contacted', 'Warm',
  'Meeting Booked', 'Proposal Sent', 'Negotiation', 'Won', 'Lost',
]

export const stageColors: Record<Stage, string> = {
  'New':            'bg-surface-raised text-foreground-dim',
  'Researched':     'bg-blue-500/10 text-blue-400',
  'Contacted':      'bg-sky-500/10 text-sky-400',
  'Warm':           'bg-orange-500/10 text-orange-400',
  'Meeting Booked': 'bg-violet-500/10 text-violet-400',
  'Proposal Sent':  'bg-amber-500/10 text-amber-400',
  'Negotiation':    'bg-yellow-500/10 text-yellow-400',
  'Won':            'bg-success-muted text-success',
  'Lost':           'bg-danger-muted text-danger',
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
