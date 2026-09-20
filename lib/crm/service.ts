import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { actionSchemas, type ActionName, searchSchema, recordSchema,
  bulkPreviewSchema, bulkCommitSchema, BULK_MAX_ROWS, type bulkRowSchema } from './contracts'
import type { Database, Queryable, Row } from './database'
import { CrmError } from './errors'
import { eventsForArrival } from '@/lib/db/events'
import type { Stage } from '@/lib/types'
import { fromCompanyRow, fromContactRow, fromLeadRow, fromOpportunityRow, fromTaskRow } from '@/lib/db/mappers'
import type { CompanyRow, ContactRow, LeadRow, OpportunityRow, TaskRow } from '@/lib/db/rows'

const tables = { company: 'companies', contact: 'contacts', prospect: 'opportunities', lead: 'leads', task: 'tasks' } as const
type Entity = keyof typeof tables
// `mustAffect` marks a statement that has to hit a row (an update). commitAction
// checks it so a write that matched nothing surfaces as not_found instead of a
// receipt claiming a save that never happened.
type Statement = { sql: string; values: unknown[]; mustAffect?: boolean }
type Change = { entity: string; id: string; operation: 'create' | 'update'; fields: Row }
type Plan = { statements: Statement[]; changes: Change[]; entity: Entity; id: string; actor: Actor }
/**
 * Who a tool call acts as: the connection, the account that approved it and
 * the organization it was approved for. It comes from the OAuth principal
 * (lib/mcp/oauth.ts), never from a parameter the model supplied, and every
 * query in this file is scoped by it. A record in another organization must
 * look exactly like a record that does not exist.
 */
export type Actor = { connectionId: string; userId: string; organizationId: string }

/** Stable across key ordering, previews and retries. */
export function fingerprint(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function generatedId(requestId: string, kind: string): string {
  const hex = fingerprint(`${requestId}:${kind}`).slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`
}

const camel = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v]))
function publicRecord(entity: Entity, data: Row) {
  switch (entity) {
    case 'company': return fromCompanyRow(data as unknown as CompanyRow)
    case 'contact': return fromContactRow(data as unknown as ContactRow)
    case 'prospect': return fromOpportunityRow(data as unknown as OpportunityRow)
    case 'lead': return fromLeadRow(data as unknown as LeadRow)
    case 'task': return fromTaskRow(data as unknown as TaskRow)
  }
}

async function load(db: Queryable, entity: Entity, id: string, actor: Actor, lock = false) {
  // Scoped in the predicate, not checked after the read: an id from another
  // organization is simply not found, and the row lock is never taken on it.
  const [row] = await db.query<{ data: Row; version: string }>(
    `select to_jsonb(t) as data, updated_at::text as version from ${tables[entity]} t where id = $1 and organization_id = $2 ${lock ? 'for update' : ''}`, [id, actor.organizationId])
  if (!row) throw new CrmError('not_found', `The ${entity} no longer exists. Search again.`)
  return row
}

export async function getRecord(db: Queryable, input: unknown, actor: Actor) {
  const { entity, id } = recordSchema.parse(input)
  const row = await load(db, entity, id, actor)
  const result: Row = { entity, record: publicRecord(entity, row.data), version: row.version }
  if (entity === 'prospect') {
    // The composite foreign keys already keep a prospect's company and contact
    // in its organization; the filter is repeated so the rule is visible here
    // rather than relying on the reader knowing the schema.
    result.company = publicRecord('company', (await load(db, 'company', String(row.data.company_id), actor)).data)
    result.contact = publicRecord('contact', (await load(db, 'contact', String(row.data.contact_id), actor)).data)
    result.interactions = (await db.query(`select id, occurred_on, channel, summary, followed_up_by, source_system, source_message_id
      from crm_interactions where opportunity_id = $1 and organization_id = $2 order by occurred_on desc, created_at desc limit 20`, [id, actor.organizationId])).map(camel)
    result.notes = (await db.query(`select id, raw, created_at from notes where opportunity_id = $1 and organization_id = $2 and not dismissed order by created_at desc limit 20`, [id, actor.organizationId])).map(camel)
    result.tasks = (await db.query<{ data: Row }>(`select to_jsonb(t) as data from tasks t where related_opportunity_id = $1 and organization_id = $2 and archived_at is null order by created_at desc limit 20`, [id, actor.organizationId])).map(r => publicRecord('task', r.data))
  }
  return result
}

export async function searchRecords(db: Queryable, input: unknown, actor: Actor) {
  const args = searchSchema.parse(input)
  const like = `%${args.query.replace(/[\\%_]/g, '\\$&')}%`
  const results: Row[] = []
  // Table/column names are fixed code, never user input. Search terms remain parameters.
  // Positions are fixed for every entity: $1 search term, $2 organization,
  // $3 limit, $4 assignee. The prospect subqueries carry the organization too,
  // so a company name in another organization cannot surface this one's deals.
  const filters: Record<Entity, string> = {
    company: '(name ilike $1 or domain ilike $1)',
    contact: '(name ilike $1 or email ilike $1)',
    prospect: `(company_id in (select id from companies where organization_id = $2 and (name ilike $1 or domain ilike $1))
      or contact_id in (select id from contacts where organization_id = $2 and (name ilike $1 or email ilike $1)))`,
    lead: '(company_name ilike $1 or contact_name ilike $1)',
    task: '(title ilike $1 or description ilike $1)',
  }
  for (const entity of Object.keys(tables) as Entity[]) {
    if (args.entity !== 'all' && entity !== args.entity) continue
    if (args.assignee && entity !== 'task') continue
    const rows = await db.query<{ data: Row; version: string }>(
      `select to_jsonb(t) as data, updated_at::text as version from ${tables[entity]} t
      where organization_id = $2 and ${filters[entity]} ${args.assignee ? 'and assignee = $4' : ''} order by updated_at desc, id limit $3`,
      [like, actor.organizationId, args.limit + 1, ...(args.assignee ? [args.assignee] : [])])
    results.push({ entity, matches: rows.slice(0, args.limit).map(r => ({ record: publicRecord(entity, r.data), version: r.version })), hasMore: rows.length > args.limit })
  }
  return { results, guidance: 'These are candidates. Inspect IDs before updating; do not assume the first matching company/deal is correct.' }
}

function insert(plan: Plan, table: string, entity: string, row: Row) {
  // Stamped here, on every insert, rather than at each call site. The column
  // has a rollout default (Khyte) so a forgotten path would not fail — it would
  // silently file another organization's record under Khyte, which is exactly
  // the mistake the default must not be allowed to hide.
  const stamped: Row = { ...row, organization_id: plan.actor.organizationId }
  const columns = Object.keys(stamped).map(k => `"${k}"`).join(', ')
  // Bind pre-serialized JSON as text. postgres.js otherwise infers jsonb and
  // JSON.stringify's the string again, turning the object into a JSON scalar.
  plan.statements.push({ sql: `insert into ${table} (${columns}) select ${columns} from jsonb_populate_record(null::${table}, $1::text::jsonb)`, values: [JSON.stringify(stamped)] })
  // The organization is the connection's scope, not a field the caller chose,
  // so it is not among the changes offered for review.
  plan.changes.push({ entity, id: String(row.id), operation: 'create', fields: camel(row) })
}

function update(plan: Plan, table: string, entity: string, id: string, patch: Row) {
  const columns = Object.keys(patch)
  if (!columns.length) return
  // The row was loaded and locked in this organization already; the predicate
  // is repeated so the statement is safe on its own, and `returning` is what
  // lets commitAction confirm a row was actually written.
  plan.statements.push({ sql: `update ${table} t set ${columns.map(k => `"${k}" = x."${k}"`).join(', ')}
    from jsonb_populate_record(null::${table}, $1::text::jsonb) x where t.id = $2 and t.organization_id = $3 returning t.id`,
    values: [JSON.stringify(patch), id, plan.actor.organizationId], mustAffect: true })
  plan.changes.push({ entity, id, operation: 'update', fields: camel(patch) })
}

function checkVersion(actual: string, expected: string) {
  if (actual !== expected) throw new CrmError('conflict', 'The record changed. Read it again and prepare a new preview.')
}

async function matching(db: Queryable, entity: 'company' | 'contact' | 'lead', condition: string, values: unknown[], actor: Actor) {
  // The organization is bound after the caller's own parameters, so the
  // conditions at the call sites read as written ($1, $2, ...) and the
  // parenthesised condition cannot escape the organization with an `or`.
  const matches = await db.query(`select id from ${tables[entity]} where organization_id = $${values.length + 1} and (${condition}) limit 10`, [...values, actor.organizationId])
  if (matches.length) throw new CrmError('possible_duplicate', `Matching ${entity} records already exist. Inspect them before creating another.`, { entity, ids: matches.map(r => r.id) })
}

function event(plan: Plan, requestId: string, kind: string, subjectId: string, colleague: string | null, day: string, detail: Row) {
  // Match the existing ledger's server-local calendar encoding. Deployment sets
  // TZ=Europe/Stockholm so UI writes, counts and exports use the same day boundary.
  const [year, month, date] = day.split('-').map(Number)
  const start = new Date(year, month - 1, date).toISOString()
  const end = new Date(year, month - 1, date + 1).toISOString()
  // Keep existing per-prospect/day outreach counts, independent of message count.
  // `colleague` stays the roster label credited with the work; `recorded_by` is
  // the account behind the connection that logged it. They differ whenever
  // someone logs for a teammate, and both are kept. The duplicate check is
  // per organization so a subject id can never be "already contacted" by
  // another organization's event.
  plan.statements.push({
    sql: `insert into crm_events (id, organization_id, kind, subject_id, colleague, detail, occurred_at, recorded_by)
      select $1, $8::uuid, $2::crm_event_kind, $3, $4, $5::text::jsonb, $6::timestamptz, $9::uuid
      where $2 <> 'prospect_contacted' or not exists (
        select 1 from crm_events where organization_id = $8::uuid and kind = 'prospect_contacted' and subject_id = $3
        and occurred_at >= $6::timestamptz and occurred_at < $7::timestamptz)`,
    values: [generatedId(requestId, `event:${kind}`), kind, subjectId, colleague, JSON.stringify(detail), start, end, plan.actor.organizationId, plan.actor.userId],
  })
}

export function stockholmToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

async function prepare(db: Queryable, action: ActionName, raw: unknown, actor: Actor, lock: boolean): Promise<Plan> {
  const input = actionSchemas[action].parse(raw)
  const plan: Plan = { statements: [], changes: [], entity: 'lead', id: generatedId(input.requestId, action), actor }
  if (action === 'create_lead') {
    const a = actionSchemas.create_lead.parse(input)
    await matching(db, 'lead', 'lower(trim(company_name)) = lower(trim($1))', [a.companyName], actor)
    const companies = await db.query('select id from companies where organization_id = $2 and lower(trim(name)) = lower(trim($1)) limit 10', [a.companyName, actor.organizationId])
    if (companies.length) throw new CrmError('possible_duplicate', 'This company already exists in the CRM. Inspect its prospects before adding a raw lead.', { companyIds: companies.map(c => c.id) })
    insert(plan, 'leads', 'lead', { id: plan.id, company_name: a.companyName, contact_name: a.contactName ?? null, connection: a.connection ?? null,
      source: a.source ?? null, followed_up_by: a.followedUpBy, priority: a.priority, notes: a.notes ?? '', tags: a.tags })
    event(plan, a.requestId, 'lead_added', plan.id, a.followedUpBy, stockholmToday(), { companyName: a.companyName, loggedVia: 'crm_tool' })
    return plan
  }
  if (action === 'create_task') {
    const a = actionSchemas.create_task.parse(input)
    plan.entity = 'task'
    let companyId = a.relatedCompanyId ?? null
    if (companyId) await load(db, 'company', companyId, actor, lock)
    if (a.relatedOpportunityId) {
      const opportunity = await load(db, 'prospect', a.relatedOpportunityId, actor, lock)
      if (companyId && companyId !== opportunity.data.company_id) throw new CrmError('invalid_link', 'The task company does not match the selected prospect.')
      companyId = String(opportunity.data.company_id)
    }
    insert(plan, 'tasks', 'task', { id: plan.id, title: a.title, description: a.description ?? null, assignee: a.assignee, due_date: a.dueDate,
      priority: a.priority, completed: false, related_company_id: companyId, related_opportunity_id: a.relatedOpportunityId ?? null, tags: a.tags })
    return plan
  }
  if (action === 'assign_task') {
    const a = actionSchemas.assign_task.parse(input)
    const task = await load(db, 'task', a.taskId, actor, lock)
    checkVersion(task.version, a.expectedVersion)
    if (task.data.archived_at) throw new CrmError('archived_task', 'This task is archived. Restore it in the CRM before assigning it.')
    plan.entity = 'task'; plan.id = a.taskId
    update(plan, 'tasks', 'task', a.taskId, { assignee: a.assignee })
    return plan
  }

  const a = actionSchemas.log_outreach.parse(input)
  if (a.occurredOn > stockholmToday()) throw new CrmError('future_outreach', 'Outreach must have happened already. Create a task for planned outreach.')
  plan.entity = 'prospect'
  let companyId: string, contactId: string, previousStage: Stage = 'New', opportunity: Row | undefined
  if (a.target.kind === 'existing') {
    const current = await load(db, 'prospect', a.target.opportunityId, actor, lock)
    checkVersion(current.version, a.target.expectedVersion)
    opportunity = current.data
    plan.id = a.target.opportunityId
    companyId = String(opportunity.company_id); contactId = String(opportunity.contact_id)
    previousStage = opportunity.stage as Stage
  } else {
    const company = a.target.company
    if ('id' in company) {
      await load(db, 'company', company.id, actor, lock); companyId = company.id
    } else {
      await matching(db, 'company', 'lower(trim(name)) = lower(trim($1)) or ($2::text is not null and lower(domain) = lower($2))', [company.name, company.domain ?? null], actor)
      companyId = generatedId(a.requestId, 'company')
      insert(plan, 'companies', 'company', { id: companyId, name: company.name, domain: company.domain?.toLowerCase() ?? '', industry: company.industry ?? '', location: company.location ?? '' })
    }
    const contact = a.target.contact
    if ('id' in contact) {
      const existing = await load(db, 'contact', contact.id, actor, lock)
      if (existing.data.company_id !== companyId) throw new CrmError('invalid_link', 'The selected contact belongs to a different company.')
      contactId = contact.id
    } else {
      await matching(db, 'contact', '(company_id = $1 and lower(trim(name)) = lower(trim($2))) or ($3::text is not null and lower(email) = lower($3))', [companyId, contact.name, contact.email ?? null], actor)
      contactId = generatedId(a.requestId, 'contact')
      insert(plan, 'contacts', 'contact', { id: contactId, company_id: companyId, name: contact.name, email: contact.email ?? '', role: contact.role ?? '', phone: contact.phone ?? null })
    }
    const existing = await db.query('select id from opportunities where company_id = $1 and organization_id = $2 limit 10', [companyId, actor.organizationId])
    if (existing.length) throw new CrmError('possible_duplicate', 'This company already has prospects. Select the appropriate deal instead of creating another.', { opportunityIds: existing.map(r => r.id) })
  }
  if (a.source) {
    // The unique source index is per (source, opportunity) across the whole
    // table; the organization predicate keeps the answer — and the ids in
    // it — inside this organization all the same.
    const [duplicate] = await db.query(`select id, opportunity_id from crm_interactions
      where source_system = $1 and source_account = $2 and source_message_id = $3 and opportunity_id = $4 and organization_id = $5`,
      [a.source.system, a.source.account, a.source.messageId, plan.id, actor.organizationId])
    if (duplicate) throw new CrmError('already_logged', 'This source has already been logged for this prospect.', { interactionId: duplicate.id, opportunityId: duplicate.opportunity_id })
  }
  const stage = (a.stage ?? (opportunity ? previousStage : 'Contacted')) as Stage
  const patch: Row = {
    last_interaction: opportunity?.last_interaction && String(opportunity.last_interaction) > a.occurredOn ? opportunity.last_interaction : a.occurredOn,
    tags: [...new Set([...(opportunity?.tags as string[] ?? []), ...a.tags])],
    ...(a.stage !== undefined ? { stage } : {}),
    ...(a.nextStep !== undefined ? { next_step: a.nextStep } : {}),
    ...(a.followUpDate !== undefined ? { follow_up_date: a.followUpDate } : {}),
    ...(a.priority !== undefined ? { priority: a.priority } : {}),
    ...(a.dealValueSek !== undefined ? { deal_value: a.dealValueSek } : {}),
  }
  // Sort order is a position within this organization's column; another
  // organization's cards must not push a new one to the bottom of theirs.
  if (opportunity) {
    if (stage !== previousStage) {
      const [position] = await db.query('select coalesce(max(sort_order), -1) + 1 as position from opportunities where stage = $1 and organization_id = $2', [stage, actor.organizationId])
      patch.sort_order = position.position
    }
    update(plan, 'opportunities', 'prospect', plan.id, patch)
  } else {
    const [position] = await db.query('select coalesce(max(sort_order), -1) + 1 as position from opportunities where stage = $1 and organization_id = $2', [stage, actor.organizationId])
    insert(plan, 'opportunities', 'prospect', { id: plan.id, company_id: companyId, contact_id: contactId,
      stage, priority: a.priority ?? 'medium', in_pipeline: true, next_step: '', followed_up_by: a.followedUpBy, sort_order: position.position, ...patch })
  }
  insert(plan, 'crm_interactions', 'interaction', { id: generatedId(a.requestId, 'interaction'), opportunity_id: plan.id, company_id: companyId, contact_id: contactId,
    occurred_on: a.occurredOn, channel: a.channel, summary: a.summary, followed_up_by: a.followedUpBy, connection_id: actor.connectionId,
    source_system: a.source?.system ?? null, source_account: a.source?.account ?? null, source_message_id: a.source?.messageId ?? null })
  // Also populate the existing timeline; no frontend fork is needed to see the saved outreach.
  insert(plan, 'notes', 'note', { id: generatedId(a.requestId, 'note'), opportunity_id: plan.id, company_id: companyId,
    raw: `[${a.occurredOn} · ${a.channel} · ${a.followedUpBy ?? 'unassigned'}] ${a.summary}` })
  event(plan, a.requestId, 'prospect_contacted', plan.id, a.followedUpBy, a.occurredOn, { loggedVia: 'crm_tool', interactionId: generatedId(a.requestId, 'interaction') })
  for (const arrival of eventsForArrival(previousStage, stage, { subjectId: plan.id })) {
    // Imported stage timing is reported evidence, not a transition witnessed on
    // that historic date. Avoid {from,to}, which the export classifies as observed.
    if (arrival.kind !== 'prospect_contacted') event(plan, a.requestId, arrival.kind, plan.id, a.followedUpBy, a.occurredOn,
      { reportedFrom: previousStage, reportedTo: stage, loggedVia: 'crm_tool' })
  }
  return plan
}

/* ———— bulk outreach ———— */

type BulkRow = z.infer<typeof bulkRowSchema>
type Resolution =
  | { kind: 'ready'; parameters: Row }
  | { kind: 'ambiguous'; reason: string; candidates: Row }
  | { kind: 'invalid'; reason: string }

/**
 * Merge one row over the batch defaults and turn it into log_outreach parameters.
 *
 * Returns a classification instead of throwing, which is the whole point: one bad
 * row in a 200-row import must not abort the other 199. matching() keeps throwing
 * for the single-record path, which is unchanged.
 */
async function resolveRow(db: Queryable, row: BulkRow, defaults: Row, batchId: string, index: number,
  source: { system: string; account: string; label?: string } | undefined, actor: Actor): Promise<Resolution> {
  const requestId = generatedId(batchId, 'row:' + index)
  const stated = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined))
  const merged = { ...defaults, ...stated } as Row
  const occurredOn = merged.occurredOn as string | undefined
  const summary = merged.summary as string | undefined
  if (!occurredOn) return { kind: 'invalid', reason: 'No occurredOn on the row or in defaults.' }
  if (!summary) return { kind: 'invalid', reason: 'No summary on the row or in defaults.' }
  if (occurredOn > stockholmToday()) return { kind: 'invalid', reason: 'Outreach must have happened already.' }
  if (merged.followedUpBy === undefined) return { kind: 'invalid', reason: 'followedUpBy must be stated explicitly, including null.' }

  const common: Row = {
    requestId, occurredOn, summary,
    channel: merged.channel ?? 'email',
    followedUpBy: merged.followedUpBy,
    tags: (merged.tags as string[] | undefined) ?? [],
    ...(merged.stage !== undefined ? { stage: merged.stage } : {}),
    ...(merged.nextStep !== undefined ? { nextStep: merged.nextStep } : {}),
    ...(merged.followUpDate !== undefined ? { followUpDate: merged.followUpDate } : {}),
    ...(merged.priority !== undefined ? { priority: merged.priority } : {}),
    ...(merged.dealValueSek !== undefined ? { dealValueSek: merged.dealValueSek } : {}),
    // A per-row message ID makes re-importing the same mailbox idempotent at the
    // database level, independently of batchId.
    ...(source && row.sourceMessageId
      ? { source: { system: source.system, account: source.account, messageId: row.sourceMessageId } }
      : {}),
  }

  // The caller resolved this row on an earlier preview: honour it verbatim.
  if (row.opportunityId) {
    if (!row.expectedVersion) return { kind: 'invalid', reason: 'opportunityId requires expectedVersion from the preview.' }
    return { kind: 'ready', parameters: { ...common, target: { kind: 'existing', opportunityId: row.opportunityId, expectedVersion: row.expectedVersion } } }
  }

  const companyName = merged.companyName as string | undefined
  const contactName = merged.contactName as string | undefined
  const email = merged.email as string | undefined
  if (!companyName && !row.companyId) return { kind: 'invalid', reason: 'No companyName, companyId or opportunityId.' }
  if (!contactName && !row.contactId) return { kind: 'invalid', reason: 'No contactName, contactId or opportunityId.' }

  // Strongest signal first: an exact email already in the CRM identifies the
  // contact, and through it the company and any live deal. The same person
  // can be a contact of two organizations; only this organization's row is
  // a match, and only its deals are candidates.
  if (!row.companyId && !row.contactId && email) {
    const byEmail = await db.query(`select c.id as contact_id, c.company_id,
        (select o.id from opportunities o where o.contact_id = c.id and o.organization_id = $2 order by o.updated_at desc limit 1) as opportunity_id,
        (select o.updated_at::text from opportunities o where o.contact_id = c.id and o.organization_id = $2 order by o.updated_at desc limit 1) as version
      from contacts c where c.organization_id = $2 and lower(c.email) = lower($1) limit 5`, [email, actor.organizationId])
    if (byEmail.length > 1) {
      return { kind: 'ambiguous', reason: 'That email matches several contacts.', candidates: { contactIds: byEmail.map(r => r.contact_id) } }
    }
    if (byEmail.length === 1) {
      const hit = byEmail[0]
      if (!hit.opportunity_id) {
        return { kind: 'ambiguous', reason: 'The contact exists but has no prospect. Confirm before creating one.',
          candidates: { contactId: hit.contact_id, companyId: hit.company_id } }
      }
      return { kind: 'ambiguous', reason: 'An existing prospect matches this email. Re-send this row with opportunityId and expectedVersion to log against it.',
        candidates: { opportunityId: hit.opportunity_id, expectedVersion: hit.version, contactId: hit.contact_id, companyId: hit.company_id } }
    }
  }

  // No email match. If the company already exists it is reported, never merged
  // silently: picking a deal for the caller is exactly the guess to avoid.
  if (!row.companyId && companyName) {
    const domain = (merged.companyDomain as string | undefined) ?? null
    const byCompany = await db.query(`select id from companies
      where organization_id = $3 and (lower(trim(name)) = lower(trim($1)) or ($2::text is not null and lower(domain) = lower($2))) limit 5`,
      [companyName, domain, actor.organizationId])
    if (byCompany.length) {
      const ids = byCompany.map(r => r.id as string)
      const deals = await db.query('select id, company_id, updated_at::text as version from opportunities where company_id = any($1::uuid[]) and organization_id = $2 limit 10', [ids, actor.organizationId])
      return {
        kind: 'ambiguous',
        reason: deals.length
          ? 'This company already has prospects. Choose the correct deal and re-send with opportunityId and expectedVersion.'
          : 'This company already exists. Re-send with companyId to attach a new prospect to it.',
        candidates: { companyIds: ids, opportunities: deals.map(d => ({ opportunityId: d.id, companyId: d.company_id, expectedVersion: d.version })) },
      }
    }
  }

  const company: Row = row.companyId
    ? { id: row.companyId }
    : { name: companyName as string, ...(merged.companyDomain ? { domain: merged.companyDomain } : {}) }
  const contact: Row = row.contactId
    ? { id: row.contactId }
    : { name: contactName as string, ...(email ? { email } : {}) }
  return { kind: 'ready', parameters: { ...common, target: { kind: 'new', company, contact } } }
}

export async function previewBulkOutreach(db: Database, raw: unknown, actor: Actor) {
  const input = bulkPreviewSchema.parse(raw)
  const ready: Row[] = [], ambiguous: Row[] = [], invalid: Row[] = []
  for (const [index, row] of input.records.entries()) {
    const ref = row.ref ?? String(index)
    const resolution = await resolveRow(db, row, input.defaults as Row, input.batchId, index, input.source, actor)
    if (resolution.kind === 'ready') {
      // Validate against the real action schema here, so a row that would fail at
      // commit is reported now rather than surviving the preview.
      const parsed = actionSchemas.log_outreach.safeParse(resolution.parameters)
      if (parsed.success) ready.push({ ref, index, parameters: parsed.data })
      else invalid.push({ ref, index, reason: 'Invalid fields.', fields: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) })
    } else if (resolution.kind === 'ambiguous') {
      ambiguous.push({ ref, index, reason: resolution.reason, ...resolution.candidates })
    } else {
      invalid.push({ ref, index, reason: resolution.reason })
    }
  }
  return {
    status: 'preview' as const,
    batchId: input.batchId,
    counts: { requested: input.records.length, ready: ready.length, ambiguous: ambiguous.length, invalid: invalid.length },
    ready, ambiguous, invalid,
    guidance: 'No records have been saved. Ambiguous rows are never guessed: re-send them with the returned opportunityId/companyId/contactId to reuse a record. Commit with the same batchId and these exact parameters; ambiguous and invalid rows are skipped.',
  }
}

/**
 * Commit the ready rows one at a time.
 *
 * Deliberately not one transaction for the whole batch. commitAction takes the
 * 'khyte:crm-tools' advisory lock, and holding it across 200 rows would block
 * every other tool write, and the UI behind them, for the whole import. Per-row
 * commits keep each lock window short and give real partial success: a failing
 * row is reported and the rest still land. Each row's requestId is derived from
 * batchId, so retrying a batch returns already_saved per row rather than
 * duplicating anything.
 */
export async function commitBulkOutreach(db: Database, raw: unknown, actor: Actor) {
  const input = bulkCommitSchema.parse(raw)
  const { previewToken: _previewToken, ...preview } = input

  // Receipts first, before any re-resolution.
  //
  // A replay of an already-committed batch would otherwise re-resolve every row
  // against a database that now contains the records the first run created, so
  // rows would come back "ambiguous" against their own results and never reach
  // commitAction — which is the thing that knows how to answer already_saved.
  // Reading the receipts up front means a retry reports what landed instead of
  // rediscovering it as a conflict.
  const requestIds = input.records.map((_row, index) => generatedId(input.batchId, 'row:' + index))
  const receipts = new Map((await db.query<{ request_id: string; result: Row }>(
    'select request_id, result from crm_tool_receipts where organization_id = $1 and connection_id = $2 and request_id = any($3::uuid[])',
    [actor.organizationId, actor.connectionId, requestIds])).map(r => [r.request_id, r.result]))

  const plan = await previewBulkOutreach(db, preview, actor)
  const saved: Row[] = [], failed: Row[] = []

  // Rows already receipted under this batch, whatever the fresh preview thinks.
  for (const [index, row] of input.records.entries()) {
    const receipt = receipts.get(requestIds[index])
    if (!receipt) continue
    saved.push({ ref: row.ref ?? String(index), index, requestId: requestIds[index], status: 'already_saved', prospectId: receipt.id ?? null })
  }

  for (const row of plan.ready) {
    const parameters = row.parameters as Row
    if (receipts.has(String(parameters.requestId))) continue
    try {
      const result = await commitAction(db, 'log_outreach', parameters, actor)
      saved.push({ ref: row.ref, index: row.index, requestId: parameters.requestId, status: result.status, prospectId: result.id ?? null })
    } catch (error) {
      // Fail closed per row: a version conflict or duplicate stops that row only.
      failed.push({ ref: row.ref, index: row.index, ...safeError(error) })
    }
  }
  const alreadySaved = saved.filter(r => r.status === 'already_saved').length
  // A row that already saved is not also "skipped": on a replay the fresh
  // preview flags it against its own first run, which is noise, not a decision
  // waiting for the caller.
  const settled = new Set(saved.map(r => r.index))
  const ambiguous = plan.ambiguous.filter(r => !settled.has(r.index as number))
  const invalid = plan.invalid.filter(r => !settled.has(r.index as number))
  return {
    status: 'committed' as const,
    batchId: input.batchId,
    counts: {
      requested: input.records.length, saved: saved.length, newlySaved: saved.length - alreadySaved, alreadySaved,
      skippedAmbiguous: ambiguous.length, skippedInvalid: invalid.length, failed: failed.length,
    },
    saved, failed, ambiguous, invalid,
    guidance: 'Only rows listed under saved persisted. Retrying this batchId returns already_saved for those and does not duplicate them. Resolve ambiguous rows explicitly before re-sending them.',
  }
}

/** What a batch actually persisted, by replaying its derived per-row request IDs. */
export async function getBulkResult(db: Queryable, batchId: string, actor: Actor) {
  const requestIds = Array.from({ length: BULK_MAX_ROWS }, (_, i) => generatedId(batchId, 'row:' + i))
  // A batch id is caller-chosen, so the derived request ids are guessable;
  // the receipts are only visible to the organization and connection that
  // wrote them.
  const rows = await db.query<{ request_id: string; result: Row }>(
    'select request_id, result from crm_tool_receipts where organization_id = $1 and connection_id = $2 and request_id = any($3::uuid[]) order by created_at',
    [actor.organizationId, actor.connectionId, requestIds])
  return {
    status: rows.length ? ('found' as const) : ('not_found' as const),
    batchId, savedRows: rows.length,
    saved: rows.map(r => ({ requestId: r.request_id, result: r.result })),
  }
}

export async function previewAction(db: Database, action: ActionName, raw: unknown, actor: Actor) {
  const input = actionSchemas[action].parse(raw)
  const plan = await prepare(db, action, input, actor, false)
  return { status: 'preview' as const, action, requestId: input.requestId, parameters: input, changes: plan.changes,
    guidance: 'No records have been saved. Review these changes and use the matching write tool with the same parameters.' }
}

export async function commitAction(db: Database, action: ActionName, raw: unknown, actor: Actor): Promise<Row> {
  const input = actionSchemas[action].parse(raw)
  const hash = fingerprint({ action, input })
  return db.transaction(async tx => {
    // Serializes tool writes across processes: name matching and first-time creation cannot race.
    // Existing UI updates are protected by row locks and expectedVersion checks on the affected records.
    await tx.query("select pg_advisory_xact_lock(hashtext('khyte:crm-tools'))")
    // Looked up by request id alone — it is the primary key, so a request id
    // taken by another organization or connection is a real collision, not a
    // miss. Answering not-found there would let the caller write a second
    // record under an id the table already refuses; a conflict tells the truth
    // without revealing whose receipt it is.
    const [receipt] = await tx.query<{ payload_hash: string; connection_id: string; organization_id: string; result: Row }>(
      'select payload_hash, connection_id, organization_id, result from crm_tool_receipts where request_id = $1', [input.requestId])
    if (receipt) {
      if (receipt.payload_hash !== hash || receipt.connection_id !== actor.connectionId || receipt.organization_id !== actor.organizationId) {
        throw new CrmError('request_id_conflict', 'This request ID already belongs to another operation. Do not reuse it with different parameters.')
      }
      return { ...receipt.result, status: 'already_saved' }
    }
    const plan = await prepare(tx, action, input, actor, true)
    for (const statement of plan.statements) {
      const affected = await tx.query(statement.sql, statement.values)
      // Cannot happen while the row lock from prepare() is held, but a write
      // that matched nothing must never be receipted as a save.
      if (statement.mustAffect && !affected.length) throw new CrmError('not_found', 'The record no longer exists. Search again.')
    }
    const record = await getRecord(tx, { entity: plan.entity, id: plan.id }, actor)
    const result = { status: 'saved', action, requestId: input.requestId, changes: plan.changes, ...record }
    await tx.query(`insert into crm_tool_receipts (request_id, organization_id, action, payload_hash, connection_id, result) values ($1,$2,$3,$4,$5,$6::text::jsonb)`,
      [input.requestId, actor.organizationId, action, hash, actor.connectionId, JSON.stringify(result)])
    return result
  })
}

export function safeError(error: unknown) {
  if (error instanceof CrmError) return { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
  if (error instanceof z.ZodError) return { code: 'invalid_parameters', message: 'Correct the invalid fields before trying again.', fields: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) }
  // Do not send database errors, schema names, SQL, connection strings or stack traces to the model.
  return { code: 'service_unavailable', message: 'The CRM operation could not complete. Check server configuration/migrations and retry with the same requestId.' }
}
