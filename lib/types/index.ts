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

export interface StrategyCard {
  id: string
  opportunityId: string
  column: StrategyColumn
  content: string
  order: number
}

export type StrategyColumn =
  | 'Pain Points'
  | 'Stakeholders'
  | 'Objections'
  | 'Offer Angle'
  | 'Proof'
  | 'Next Actions'

export type PipelineStage = Stage

export interface Task {
  id: string
  title: string
  description?: string
  relatedOpportunityId?: string
  relatedCompanyId?: string
  dueDate: string
  completed: boolean
  priority: Priority
  createdAt: string
}

/**
 * The full working set the client store is built with on boot.
 * Produced server-side by lib/db/queries.loadSnapshot().
 */
export interface CRMSnapshot {
  companies: Company[]
  contacts: Contact[]
  opportunities: Opportunity[]
  notes: Note[]
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
}
