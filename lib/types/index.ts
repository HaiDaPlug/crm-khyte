export type Priority = 'low' | 'medium' | 'high' | 'critical'

export type Stage =
  | 'New'
  | 'Researched'
  | 'Contacted'
  | 'Warm'
  | 'Meeting Booked'
  | 'Proposal Sent'
  | 'Negotiation'
  | 'Won'
  | 'Lost'

export interface Company {
  id: string
  name: string
  domain: string
  industry: string
  size: string
  location: string
  tags: string[]
}

export interface Contact {
  id: string
  companyId: string
  name: string
  role: string
  email: string
  linkedin?: string
  phone?: string
}

export interface Opportunity {
  id: string
  companyId: string
  contactId: string
  stage: Stage
  priority: Priority
  /** Leads only appear on the pipeline board once explicitly added */
  inPipeline: boolean
  dealValue?: number
  nextStep: string
  followUpDate: string
  lastInteraction: string
  tags: string[]
  notes: string
  /** Who on the team is following this prospect up, from the fixed colleague roster. */
  followedUpBy?: ColleagueId
}

/**
 * Raw, unqualified interest — a company worth circling back to, dumped in
 * before there's a contact or a deal to track. Deliberately has none of
 * Opportunity's pipeline fields: promoting one to a Prospect is what creates
 * the Company/Contact/Opportunity records and removes the Lead.
 */
export interface Lead {
  id: string
  companyName: string
  /** Free text — no linked Contact record until this is promoted. */
  contactName?: string
  /** Someone in your own network who can vouch for or introduce this contact. */
  connection?: string
  /** Where this lead came from — a trade show, referral, LinkedIn, etc. */
  source?: string
  /** Who on the team owns following up, from the fixed colleague roster. */
  followedUpBy?: ColleagueId
  priority: Priority
  notes: string
  createdAt: string
}

export interface Note {
  id: string
  opportunityId?: string
  companyId?: string
  raw: string
  createdAt: string
  aiExtracted?: {
    company?: string
    contact?: string
    suggestedStage?: Stage
    painPoints?: string[]
    nextStep?: string
    followUpDate?: string
  }
  dismissed?: boolean
  applied?: boolean
}

/**
 * A headline on the strategy board — one lane of cards for one deal.
 *
 * Headlines are user-written and scoped to a single opportunity: two deals
 * never share a lane, and a new deal starts with an empty board. That is why
 * the title is free text rather than a fixed set — what matters about a
 * public-sector tender is not what matters about a renewal.
 */
export interface StrategyColumn {
  id: string
  opportunityId: string
  title: string
  order: number
}

export interface StrategyCard {
  id: string
  opportunityId: string
  columnId: string
  content: string
  order: number
}

export type PipelineStage = Stage

/** Fixed roster — the app has no real accounts/auth yet (see Settings). */
export type ColleagueId = 'erik' | 'abdi' | 'hai'

export interface Task {
  id: string
  title: string
  description?: string
  relatedOpportunityId?: string
  relatedCompanyId?: string
  dueDate: string
  completed: boolean
  priority: Priority
  /** Who it's assigned to, from the fixed colleague roster. Unset = unassigned. */
  assignee?: ColleagueId
  createdAt: string
  /**
   * Set when the task is filed away. Archived tasks are still loaded and
   * still resolve by id for anything referencing them — they are simply
   * hidden from the board.
   */
  archivedAt?: string
}

/* ———— Company direction (Khyte internal) ———— */

/**
 * Which band of the direction board a goal sits in.
 *
 * A closed set rather than free text because the wallpaper layout has fixed
 * regions — a goal in an unknown section has nowhere to be drawn.
 */
export type GoalSection =
  | 'north_star'
  | 'annual'
  | 'quarter'
  | 'principle'
  | 'not_now'

export type GoalStatus = 'on_track' | 'at_risk' | 'off_track' | 'done'

/** One line on the company layer, shared by every colleague's wallpaper. */
export interface Goal {
  id: string
  section: GoalSection
  title: string
  /** Optional supporting line, rendered smaller beneath the title. */
  detail: string
  status: GoalStatus
  /** 0–100, or undefined for "no bar" — a principle has no progress. */
  progress?: number
  order: number
}

/** How a metric's numbers should be rendered, not how they are stored. */
export type MetricUnit = 'currency' | 'number' | 'percent'

/** One row of the scoreboard. */
export interface GoalMetric {
  id: string
  label: string
  currentValue: number
  /** Undefined means "just show the number" — no bar, no percentage. */
  targetValue?: number
  unit: MetricUnit
  order: number
}

/** One line of a single colleague's weekly focus — the personal layer. */
export interface FocusItem {
  id: string
  colleague: ColleagueId
  title: string
  done: boolean
  order: number
}

/**
 * Everything the direction board needs, company layer and all people.
 *
 * Loaded separately from CRMSnapshot: the wallpaper route reads this alone,
 * without dragging the entire pipeline through Postgres on every repaint.
 */
export interface GoalsSnapshot {
  goals: Goal[]
  metrics: GoalMetric[]
  focusItems: FocusItem[]
}

/**
 * The full working set the client store is built with on boot.
 * Produced server-side by lib/db/queries.loadSnapshot().
 */
export interface CRMSnapshot {
  companies: Company[]
  contacts: Contact[]
  opportunities: Opportunity[]
  leads: Lead[]
  notes: Note[]
  strategyColumns: StrategyColumn[]
  strategyCards: StrategyCard[]
  tasks: Task[]
}

/* ———— Display settings ———— */

export type CurrencyCode = 'SEK' | 'EUR' | 'USD' | 'GBP'

export type AppLanguage = 'sv' | 'en'

export type LocaleCode =
  | 'en-US' | 'en-GB' | 'de-DE' | 'fr-FR'
  | 'es-ES' | 'nl-NL' | 'sv-SE' | 'ja-JP'

export type DateFormat = 'locale' | 'iso' | 'us' | 'eu'

/**
 * How the app renders values, not what it stores. Persisted to localStorage
 * per browser rather than to Postgres — these are per-device display choices,
 * and the app is still single-operator.
 */
export interface Settings {
  theme: 'dark' | 'light'
  /** Language used by app-owned interface copy. */
  language: AppLanguage
  currency: CurrencyCode
  locale: LocaleCode
  dateFormat: DateFormat
  /** Collapse large sums to 517K in tiles and totals. */
  compactNumbers: boolean
  /** Play the interface chimes, e.g. checking a task off. */
  sounds: boolean
}
