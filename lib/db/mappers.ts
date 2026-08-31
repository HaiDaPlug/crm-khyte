import type {
  Company,
  Contact,
  PersonalGoal,
  Goal,
  GoalMetric,
  Lead,
  Note,
  Opportunity,
  StrategyCard,
  StrategyColumn,
  Task,
} from '@/lib/types'
import type {
  CompanyRow,
  ContactRow,
  PersonalGoalRow,
  GoalMetricRow,
  GoalRow,
  LeadRow,
  NoteRow,
  OpportunityRow,
  StrategyCardRow,
  StrategyColumnRow,
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
    // numeric(14,2) can arrive as a string; same handling as Opportunity.dealValue
    ...(row.revenue === null ? {} : { revenue: Number(row.revenue) }),
    ...(row.employee_count === null ? {} : { employeeCount: row.employee_count }),
    ...(row.about ? { about: row.about } : {}),
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
    revenue: company.revenue ?? null,
    employee_count: company.employeeCount ?? null,
    about: nullIfBlank(company.about),
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
    ['revenue', updates.revenue],
    ['employee_count', updates.employeeCount],
    ['about', updates.about === undefined ? undefined : nullIfBlank(updates.about)],
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
    ...(row.followed_up_by ? { followedUpBy: row.followed_up_by } : {}),
    order: row.sort_order,
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
    followed_up_by: opportunity.followedUpBy ?? null,
    sort_order: opportunity.order,
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
    ['followed_up_by', updates.followedUpBy === undefined ? undefined : (updates.followedUpBy ?? null)],
    ['sort_order', updates.order],
  ])
}

// --- leads -------------------------------------------------------------

export function fromLeadRow(row: LeadRow): Lead {
  return {
    id: row.id,
    companyName: row.company_name,
    ...(row.contact_name ? { contactName: row.contact_name } : {}),
    ...(row.connection ? { connection: row.connection } : {}),
    ...(row.source ? { source: row.source } : {}),
    ...(row.followed_up_by ? { followedUpBy: row.followed_up_by } : {}),
    priority: row.priority,
    notes: row.notes,
    createdAt: isoOrEmpty(row.created_at),
  }
}

export function toLeadInsert(lead: Lead) {
  return {
    id: lead.id,
    company_name: lead.companyName,
    contact_name: nullIfBlank(lead.contactName),
    connection: nullIfBlank(lead.connection),
    source: nullIfBlank(lead.source),
    followed_up_by: lead.followedUpBy ?? null,
    priority: lead.priority,
    notes: lead.notes,
    created_at: lead.createdAt,
  }
}

export function toLeadUpdate(updates: Partial<Lead>) {
  return pickDefined<LeadRow>([
    ['company_name', updates.companyName],
    ['contact_name', updates.contactName === undefined ? undefined : nullIfBlank(updates.contactName)],
    ['connection', updates.connection === undefined ? undefined : nullIfBlank(updates.connection)],
    ['source', updates.source === undefined ? undefined : nullIfBlank(updates.source)],
    ['followed_up_by', updates.followedUpBy === undefined ? undefined : (updates.followedUpBy ?? null)],
    ['priority', updates.priority],
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

// --- strategy headlines ----------------------------------------------------

export function fromStrategyColumnRow(row: StrategyColumnRow): StrategyColumn {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    title: row.title,
    order: row.sort_order,
  }
}

export function toStrategyColumnInsert(column: StrategyColumn) {
  return {
    id: column.id,
    opportunity_id: column.opportunityId,
    title: column.title,
    sort_order: column.order,
  }
}

export function toStrategyColumnUpdate(updates: Partial<StrategyColumn>) {
  return pickDefined<StrategyColumnRow>([
    ['title', updates.title],
    ['sort_order', updates.order],
  ])
}

// --- strategy cards --------------------------------------------------------

export function fromStrategyCardRow(row: StrategyCardRow): StrategyCard {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    columnId: row.column_id,
    content: row.content,
    order: row.sort_order,
  }
}

export function toStrategyCardInsert(card: StrategyCard) {
  return {
    id: card.id,
    opportunity_id: card.opportunityId,
    column_id: card.columnId,
    content: card.content,
    sort_order: card.order,
  }
}

export function toStrategyCardUpdate(updates: Partial<StrategyCard>) {
  return pickDefined<StrategyCardRow>([
    ['opportunity_id', updates.opportunityId],
    ['column_id', updates.columnId],
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
    ...(row.assignee ? { assignee: row.assignee } : {}),
    ...(row.archived_at ? { archivedAt: isoOrEmpty(row.archived_at) } : {}),
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
    assignee: task.assignee ?? null,
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
    // `in` rather than `=== undefined`: a caller clearing the assignee passes
    // `{ assignee: undefined }`, which must still reach the DB as `null` —
    // an equality check would read that identically to the key being absent.
    ['assignee', 'assignee' in updates ? (updates.assignee ?? null) : undefined],
    // Same `in` treatment as assignee: un-archiving passes
    // `{ archivedAt: undefined }`, which must still reach the DB as null.
    ['archived_at', 'archivedAt' in updates ? (updates.archivedAt ?? null) : undefined],
  ])
}

// --- goals -----------------------------------------------------------------

export function fromGoalRow(row: GoalRow): Goal {
  return {
    id: row.id,
    section: row.section,
    title: row.title,
    detail: row.detail,
    status: row.status,
    // Null is "no bar at all", which is not the same as 0 — an explicit 0
    // draws an empty bar. Only null collapses to undefined.
    ...(row.progress === null ? {} : { progress: row.progress }),
    ...(row.target_date ? { targetDate: dateOrEmpty(row.target_date) } : {}),
    ...(row.metric_kind === null ? {} : { metricKind: row.metric_kind }),
    ...(row.metric_target === null ? {} : { metricTarget: row.metric_target }),
    order: row.sort_order,
  }
}

export function toGoalInsert(goal: Goal) {
  return {
    id: goal.id,
    section: goal.section,
    title: goal.title,
    detail: goal.detail,
    status: goal.status,
    progress: goal.progress ?? null,
    target_date: nullIfBlank(goal.targetDate),
    metric_kind: goal.metricKind ?? null,
    metric_target: goal.metricTarget ?? null,
    sort_order: goal.order,
  }
}

export function toGoalUpdate(updates: Partial<Goal>) {
  return pickDefined<GoalRow>([
    ['section', updates.section],
    ['title', updates.title],
    ['detail', updates.detail],
    ['status', updates.status],
    // `in` rather than `=== undefined`: clearing a progress bar passes
    // `{ progress: undefined }` and must reach the DB as null.
    ['progress', 'progress' in updates ? (updates.progress ?? null) : undefined],
    // Same `in` treatment: clearing a deadline passes the key with undefined
    // and must reach the DB as null, dropping the goal into "no deadline".
    [
      'target_date',
      'targetDate' in updates ? nullIfBlank(updates.targetDate) : undefined,
    ],
    // Same `in` treatment: clearing a counted metric passes the key undefined
    // and must reach the DB as null, turning the goal back into a manual one.
    ['metric_kind', 'metricKind' in updates ? (updates.metricKind ?? null) : undefined],
    [
      'metric_target',
      'metricTarget' in updates ? (updates.metricTarget ?? null) : undefined,
    ],
    ['sort_order', updates.order],
  ])
}

// --- goal metrics ----------------------------------------------------------

/** `numeric` arrives as a string; the UI wants a number. */
const toNumber = (value: number | string): number =>
  typeof value === 'number' ? value : Number(value)

export function fromGoalMetricRow(row: GoalMetricRow): GoalMetric {
  return {
    id: row.id,
    label: row.label,
    currentValue: toNumber(row.current_value),
    ...(row.target_value === null ? {} : { targetValue: toNumber(row.target_value) }),
    unit: row.unit,
    order: row.sort_order,
  }
}

export function toGoalMetricInsert(metric: GoalMetric) {
  return {
    id: metric.id,
    label: metric.label,
    current_value: metric.currentValue,
    target_value: metric.targetValue ?? null,
    unit: metric.unit,
    sort_order: metric.order,
  }
}

export function toGoalMetricUpdate(updates: Partial<GoalMetric>) {
  return pickDefined<GoalMetricRow>([
    ['label', updates.label],
    ['current_value', updates.currentValue],
    // Same `in` treatment as goal progress: a metric losing its target passes
    // `{ targetValue: undefined }` and must reach the DB as null.
    [
      'target_value',
      'targetValue' in updates ? (updates.targetValue ?? null) : undefined,
    ],
    ['unit', updates.unit],
    ['sort_order', updates.order],
  ])
}

// --- personal goals --------------------------------------------------------

export function fromPersonalGoalRow(row: PersonalGoalRow): PersonalGoal {
  return {
    id: row.id,
    colleague: row.colleague,
    title: row.title,
    ...(row.target_date ? { targetDate: dateOrEmpty(row.target_date) } : {}),
    // Same contract as fromGoalRow: only null collapses to undefined, so an
    // explicit 0 still draws an empty bar.
    ...(row.progress === null ? {} : { progress: row.progress }),
    done: row.done,
    order: row.sort_order,
  }
}

export function toPersonalGoalInsert(goal: PersonalGoal) {
  return {
    id: goal.id,
    colleague: goal.colleague,
    title: goal.title,
    target_date: nullIfBlank(goal.targetDate),
    progress: goal.progress ?? null,
    done: goal.done,
    sort_order: goal.order,
  }
}

export function toPersonalGoalUpdate(updates: Partial<PersonalGoal>) {
  return pickDefined<PersonalGoalRow>([
    ['colleague', updates.colleague],
    ['title', updates.title],
    // `in` rather than `=== undefined`: clearing a deadline or a bar passes the
    // key with undefined, and both must reach the DB as null.
    [
      'target_date',
      'targetDate' in updates ? nullIfBlank(updates.targetDate) : undefined,
    ],
    ['progress', 'progress' in updates ? (updates.progress ?? null) : undefined],
    ['done', updates.done],
    ['sort_order', updates.order],
  ])
}
