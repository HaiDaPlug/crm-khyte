export type Priority = 'low' | 'medium' | 'high' | 'critical'

export type Stage =
  | 'New'
  | 'Ongoing'
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
  /** Base-currency (SEK) figure, same convention as Opportunity.dealValue —
   *  convert at the display/input boundary via useFormat(), never store a
   *  display-currency amount. Prep for a future auto-scraping enrichment
   *  pass; unset until then or until someone fills it in by hand. */
  revenue?: number
  /** Plain headcount — no currency conversion involved. */
  employeeCount?: number
  /** Free-text company description, e.g. pulled from a future scrape. */
  about?: string
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
  /** Position within its stage's column on the pipeline board. */
  order: number
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
 *
 * `annual` and `quarter` used to be separate bands, each with its own fixed
 * cadence. They are now one `goal` family carrying an optional `targetDate`
 * instead — a free date sorts and groups the same information without forcing
 * every goal into exactly a year or exactly a quarter. See
 * supabase/migrations/20260830120000_goal_target_date.sql.
 */
export type GoalSection =
  | 'north_star'
  | 'goal'
  | 'weekly'
  | 'principle'
  | 'not_now'

/**
 * A CRM action worth counting. Recorded server-side when it happens — see
 * lib/db/events.ts for why the log exists and why it is not derived.
 */
export type CrmEventKind =
  | 'prospect_contacted'
  | 'meeting_booked'
  | 'lead_added'
  | 'deal_won'

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
  /**
   * `YYYY-MM-DD`, `goal`-section only. Same convention as
   * `PersonalGoal.targetDate`. Absent means "no deadline yet" — every goal
   * migrated from the old `annual`/`quarter` split starts this way, since
   * neither had a date to preserve.
   */
  targetDate?: string
  /**
   * When set, this goal's number is counted from CRM activity of this kind for
   * the current week rather than read from `progress`. That is what makes a
   * weekly non-negotiable unable to drift from reality.
   */
  metricKind?: CrmEventKind
  /** The week's target for a counted goal, e.g. 15 meetings. */
  metricTarget?: number
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

/**
 * One person's own goal — the private layer of the board.
 *
 * Deliberately not linked to a company `Goal`. This is the operator's own life
 * ("Flytta ut i december"), shown on their wallpaper and nobody else's; the two
 * tracks share a screen without sharing a hierarchy. Privacy is by URL rather
 * than enforced in the database — see the migration.
 *
 * Both measurements are optional and independent, which is what lets one row
 * type carry a deadline goal, a measurable one, or a plain line of intent.
 */
export interface PersonalGoal {
  id: string
  colleague: ColleagueId
  title: string
  /** `YYYY-MM-DD`. The board renders it as a countdown, not a date. */
  targetDate?: string
  /** 0–100, or undefined for "no bar" — same contract as `Goal.progress`. */
  progress?: number
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
  personalGoals: PersonalGoal[]
  /**
   * Live counts for the current week, keyed by event kind. Computed on read
   * rather than stored, so a counted goal cannot go stale.
   */
  weeklyCounts: Record<string, number>
  /** Revenue, customers and open pipeline, recomputed from the deals as they
   *  currently stand — see lib/db/board-metrics.ts. */
  totals: { revenue: number; customers: number; pipeline: number }
}

/**
 * The weekly non-negotiables and this week's counts, for the small progress
 * cards on the CRM pages.
 *
 * A narrow slice of GoalsSnapshot rather than a second source: the cards resolve
 * a goal's number exactly as GoalsEditor and DisplayBoard do, so /leads,
 * /prospects, /goals and the wallpaper cannot disagree about the same week.
 */
export interface WeeklyProgress {
  /** `weekly`-section goals only, in the editor's own order. */
  goals: Goal[]
  /** This week's event counts, keyed by `CrmEventKind`. */
  counts: Record<string, number>
  /**
   * Today's event counts, same keys, from local midnight.
   *
   * Deliberately has no target beside it. A weekly non-negotiable divided into
   * five is a number nobody agreed to, and a day you happen to start slowly is
   * not a day you are failing — this is the tally, not a verdict.
   */
  today: Record<string, number>
  /**
   * This week's counts split by who did the work — `counts[kind][colleagueId]`,
   * with events carrying no colleague under the `unassigned` key.
   *
   * Attributed from the event log, not from an opportunity's current owner, so
   * reassigning a prospect cannot move past activity between people.
   */
  byColleague: Record<string, Record<string, number>>
  /** Today's equivalent of `byColleague`, from local midnight. */
  todayByColleague: Record<string, Record<string, number>>
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
