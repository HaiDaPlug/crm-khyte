import type { FocusItem, Goal, GoalMetric } from '@/lib/types'

/**
 * Demo direction board, served when there are no Supabase credentials — same
 * contract as the other mock-data modules. Enough content in every section
 * that the wallpaper layout can be judged before a single real row exists.
 */

export const mockGoals: Goal[] = [
  {
    id: 'goal-north',
    section: 'north_star',
    title: 'Bli den självklara operativa partnern för svenska tjänsteföretag',
    detail: 'Vi bygger systemet de driver bolaget i — inte ännu ett verktyg de loggar in i.',
    status: 'on_track',
    order: 0,
  },

  {
    id: 'goal-annual-1',
    section: 'annual',
    title: '1 000 000 SEK i årlig återkommande intäkt',
    detail: '',
    status: 'on_track',
    progress: 18,
    order: 0,
  },
  {
    id: 'goal-annual-2',
    section: 'annual',
    title: '12 betalande kunder på workflow-abonnemang',
    detail: '',
    status: 'on_track',
    progress: 33,
    order: 1,
  },
  {
    id: 'goal-annual-3',
    section: 'annual',
    title: 'Intenti i drift hos tre externa bolag',
    detail: 'Khyte är labbet — men det räknas först när någon annan kör det.',
    status: 'at_risk',
    progress: 0,
    order: 2,
  },

  {
    id: 'goal-q-1',
    section: 'quarter',
    title: 'Stäng tre städbolag på workflow-paketet',
    detail: '',
    status: 'on_track',
    progress: 33,
    order: 0,
  },
  {
    id: 'goal-q-2',
    section: 'quarter',
    title: 'Bygg utgående systemet — 50 kontakter i veckan',
    detail: '',
    status: 'at_risk',
    progress: 60,
    order: 1,
  },
  {
    id: 'goal-q-3',
    section: 'quarter',
    title: 'Intenti kör hela Khytes egen försäljning',
    detail: '',
    status: 'on_track',
    progress: 75,
    order: 2,
  },

  {
    id: 'goal-principle-1',
    section: 'principle',
    title: 'Sälj resultatet, inte systemet.',
    detail: '',
    status: 'on_track',
    order: 0,
  },
  {
    id: 'goal-principle-2',
    section: 'principle',
    title: 'Om det inte syns i pipelinen hände det inte.',
    detail: '',
    status: 'on_track',
    order: 1,
  },

  {
    id: 'goal-notnow-1',
    section: 'not_now',
    title: 'Egen mobilapp',
    detail: '',
    status: 'on_track',
    order: 0,
  },
  {
    id: 'goal-notnow-2',
    section: 'not_now',
    title: 'Expandera utanför Sverige',
    detail: '',
    status: 'on_track',
    order: 1,
  },
  {
    id: 'goal-notnow-3',
    section: 'not_now',
    title: 'Anställa säljare',
    detail: '',
    status: 'on_track',
    order: 2,
  },
]

export const mockGoalMetrics: GoalMetric[] = [
  {
    id: 'metric-revenue',
    label: 'Intäkt',
    currentValue: 182000,
    targetValue: 1000000,
    unit: 'currency',
    order: 0,
  },
  {
    id: 'metric-pipeline',
    label: 'Pipeline',
    currentValue: 340000,
    unit: 'currency',
    order: 1,
  },
  {
    id: 'metric-customers',
    label: 'Kunder',
    currentValue: 4,
    targetValue: 12,
    unit: 'number',
    order: 2,
  },
  {
    id: 'metric-outreach',
    label: 'Kontakter denna vecka',
    currentValue: 31,
    targetValue: 50,
    unit: 'number',
    order: 3,
  },
]

export const mockFocusItems: FocusItem[] = [
  { id: 'focus-hai-1', colleague: 'hai', title: '50 utgående kontakter', done: false, order: 0 },
  { id: 'focus-hai-2', colleague: 'hai', title: 'Stäng PR Städservice', done: false, order: 1 },
  { id: 'focus-hai-3', colleague: 'hai', title: 'Färdigställ Intenti goals-vyn', done: true, order: 2 },

  { id: 'focus-erik-1', colleague: 'erik', title: 'Leverera Nordvik-workflow', done: false, order: 0 },
  { id: 'focus-erik-2', colleague: 'erik', title: 'Sätt upp onboarding-mallen', done: false, order: 1 },

  { id: 'focus-abdi-1', colleague: 'abdi', title: 'Boka fem möten', done: false, order: 0 },
  { id: 'focus-abdi-2', colleague: 'abdi', title: 'Följ upp Sable-offerten', done: false, order: 1 },
]
