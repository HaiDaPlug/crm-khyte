import type {
  Company,
  Contact,
  Note,
  Opportunity,
  StrategyCard,
  Task,
} from '@/lib/types'
import type {
  CompanyRow,
  ContactRow,
  NoteRow,
  OpportunityRow,
  StrategyCardRow,
  TaskRow,
} from './rows'

/**
 * Translation between database rows (snake_case, nullable) and the domain
 * types the UI already speaks (camelCase, mostly non-optional).
 *
 * Two directions:
 *   fromXRow  — read path, used when hydrating the store
 *   toXInsert — write path for new records
 *   toXUpdate — write path for partial edits; only touches keys actually passed
 */

// --- helpers ---------------------------------------------------------------

/** timestamptz comes back as `+00:00`; normalise to the `Z` form the UI uses. */
const isoOrEmpty = (value: string | null): string =>
  value ? new Date(value).toISOString() : ''

/** `date` columns are already `YYYY-MM-DD`; null becomes '' for the UI. */
const dateOrEmpty = (value: string | null): string => value ?? ''

/** Empty strings are the UI's "not set"; the DB should hold null instead. */
const nullIfBlank = (value: string | undefined): string | null =>
  value ? value : null

/**
 * Builds an update payload containing only the fields present in `updates`.
 * `undefined` means "not being changed" and is dropped; an explicit value —
 * including null — is kept.
 */
function pickDefined<Row>(entries: Array<[keyof Row, unknown]>): Partial<Row> {
  const out: Partial<Row> = {}
  for (const [key, value] of entries) {
    if (value !== undefined) out[key] = value as Row[keyof Row]
  }
  return out
}

// --- companies -------------------------------------------------------------

export function fromCompanyRow(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    industry: row.industry,
    size: row.size,
    location: row.location,
    tags: row.tags ?? [],
  }
}

export function toCompanyInsert(company: Company) {
  return {
    id: company.id,
    name: company.name,
    domain: company.domain,
    industry: company.industry,
    size: company.size,
    location: company.location,
    tags: company.tags,
  }
}

export function toCompanyUpdate(updates: Partial<Company>) {
  return pickDefined<CompanyRow>([
    ['name', updates.name],
    ['domain', updates.domain],
    ['industry', updates.industry],
    ['size', updates.size],
    ['location', updates.location],
    ['tags', updates.tags],
  ])
}

// --- contacts --------------------------------------------------------------

export function fromContactRow(row: ContactRow): Contact {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    role: row.role,
    email: row.email,
    ...(row.linkedin ? { linkedin: row.linkedin } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
  }
}

export function toContactInsert(contact: Contact) {
  return {
    id: contact.id,
    company_id: contact.companyId,
    name: contact.name,
    role: contact.role,
    email: contact.email,
    linkedin: nullIfBlank(contact.linkedin),
    phone: nullIfBlank(contact.phone),
  }
}

export function toContactUpdate(updates: Partial<Contact>) {
  return pickDefined<ContactRow>([
    ['company_id', updates.companyId],
    ['name', updates.name],
    ['role', updates.role],
    ['email', updates.email],
    ['linkedin', updates.linkedin === undefined ? undefined : nullIfBlank(updates.linkedin)],
    ['phone', updates.phone === undefined ? undefined : nullIfBlank(updates.phone)],
  ])
}

// --- opportunities ---------------------------------------------------------

export function fromOpportunityRow(row: OpportunityRow): Opportunity {
  return {
    id: row.id,
    companyId: row.company_id,
    contactId: row.contact_id,
    stage: row.stage,
    priority: row.priority,
    inPipeline: row.in_pipeline,
    // numeric(14,2) can arrive as a string; the UI does arithmetic on it
    ...(row.deal_value === null ? {} : { dealValue: Number(row.deal_value) }),
    nextStep: row.next_step,
    followUpDate: dateOrEmpty(row.follow_up_date),
    lastInteraction: dateOrEmpty(row.last_interaction),
    tags: row.tags ?? [],
    notes: row.notes,
  }
}

export function toOpportunityInsert(opportunity: Opportunity) {
  return {
    id: opportunity.id,
    company_id: opportunity.companyId,
    contact_id: opportunity.contactId,
    stage: opportunity.stage,
    priority: opportunity.priority,
    in_pipeline: opportunity.inPipeline,
    deal_value: opportunity.dealValue ?? null,
    next_step: opportunity.nextStep,
    follow_up_date: nullIfBlank(opportunity.followUpDate),
    last_interaction: nullIfBlank(opportunity.lastInteraction),
    tags: opportunity.tags,
    notes: opportunity.notes,
  }
}

export function toOpportunityUpdate(updates: Partial<Opportunity>) {
  return pickDefined<OpportunityRow>([
    ['company_id', updates.companyId],
    ['contact_id', updates.contactId],
    ['stage', updates.stage],
    ['priority', updates.priority],
    ['in_pipeline', updates.inPipeline],
    ['deal_value', updates.dealValue],
    ['next_step', updates.nextStep],
    [
      'follow_up_date',
      updates.followUpDate === undefined ? undefined : nullIfBlank(updates.followUpDate),
    ],
    [
      'last_interaction',
      updates.lastInteraction === undefined ? undefined : nullIfBlank(updates.lastInteraction),
    ],
    ['tags', updates.tags],
    ['notes', updates.notes],
  ])
}

// --- notes -----------------------------------------------------------------

export function fromNoteRow(row: NoteRow): Note {
  return {
    id: row.id,
    ...(row.opportunity_id ? { opportunityId: row.opportunity_id } : {}),
    ...(row.company_id ? { companyId: row.company_id } : {}),
    raw: row.raw,
    createdAt: isoOrEmpty(row.created_at),
    ...(row.ai_extracted
      ? { aiExtracted: row.ai_extracted as Note['aiExtracted'] }
      : {}),
    dismissed: row.dismissed,
    applied: row.applied,
  }
}

export function toNoteInsert(note: Note) {
  return {
    id: note.id,
    opportunity_id: note.opportunityId ?? null,
    company_id: note.companyId ?? null,
    raw: note.raw,
    ai_extracted: note.aiExtracted ?? null,
    dismissed: note.dismissed ?? false,
    applied: note.applied ?? false,
    created_at: note.createdAt,
  }
}

export function toNoteUpdate(updates: Partial<Note>) {
  return pickDefined<NoteRow>([
    ['opportunity_id', updates.opportunityId],
    ['company_id', updates.companyId],
    ['raw', updates.raw],
    ['ai_extracted', updates.aiExtracted],
    ['dismissed', updates.dismissed],
    ['applied', updates.applied],
  ])
}

// --- strategy cards --------------------------------------------------------

export function fromStrategyCardRow(row: StrategyCardRow): StrategyCard {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    column: row.column_name,
    content: row.content,
    order: row.sort_order,
  }
}

export function toStrategyCardInsert(card: StrategyCard) {
  return {
    id: card.id,
    opportunity_id: card.opportunityId,
    column_name: card.column,
    content: card.content,
    sort_order: card.order,
  }
}

export function toStrategyCardUpdate(updates: Partial<StrategyCard>) {
  return pickDefined<StrategyCardRow>([
    ['opportunity_id', updates.opportunityId],
    ['column_name', updates.column],
    ['content', updates.content],
    ['sort_order', updates.order],
  ])
}

// --- tasks -----------------------------------------------------------------

export function fromTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    ...(row.related_opportunity_id
      ? { relatedOpportunityId: row.related_opportunity_id }
      : {}),
    ...(row.related_company_id
      ? { relatedCompanyId: row.related_company_id }
      : {}),
    dueDate: dateOrEmpty(row.due_date),
    completed: row.completed,
    priority: row.priority,
    createdAt: isoOrEmpty(row.created_at),
  }
}

export function toTaskInsert(task: Task) {
  return {
    id: task.id,
    title: task.title,
    description: nullIfBlank(task.description),
    related_opportunity_id: task.relatedOpportunityId ?? null,
    related_company_id: task.relatedCompanyId ?? null,
    due_date: nullIfBlank(task.dueDate),
    completed: task.completed,
    priority: task.priority,
    created_at: task.createdAt,
  }
}

export function toTaskUpdate(updates: Partial<Task>) {
  return pickDefined<TaskRow>([
    ['title', updates.title],
    [
      'description',
      updates.description === undefined ? undefined : nullIfBlank(updates.description),
    ],
    ['related_opportunity_id', updates.relatedOpportunityId],
    ['related_company_id', updates.relatedCompanyId],
    ['due_date', updates.dueDate === undefined ? undefined : nullIfBlank(updates.dueDate)],
    ['completed', updates.completed],
    ['priority', updates.priority],
  ])
}
