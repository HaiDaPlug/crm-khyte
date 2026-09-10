import 'server-only'
import { exportProspectsSchema } from '@/lib/crm/contracts'
import type { Queryable } from '@/lib/crm/database'
import { CrmError } from '@/lib/crm/errors'
import { stockholmToday } from '@/lib/crm/service'
import { buildExportRows, hasBeenContacted } from '@/lib/export-prospects'
import { STAGES } from '@/lib/stage-config'
import { colleagues } from '@/lib/colleagues'
import { fromCompanyRow, fromContactRow, fromOpportunityRow, fromNoteRow, fromTaskRow } from '@/lib/db/mappers'
import type { CompanyRow, ContactRow, OpportunityRow, NoteRow, TaskRow } from '@/lib/db/rows'
import type { CrmEventRecord } from '@/lib/db/events'
import { EXPORT_GROUPS, EXPORT_GUIDANCE } from './export-schema'

export const EXPORT_ROWS_BYTES = 40000
const TEXT_LIMIT = 600
const DEFAULT_GROUPS = ['identity', 'status', 'people', 'dates', 'provenance'] as const

// Mirror the event provenance contract in lib/db/events.ts without its global
// getDb dependency, so the export uses the caller's injected database.
async function readEvents(db: Queryable, ids: string[]) {
  const rows = await db.query('select kind, subject_id, colleague, detail, occurred_at from crm_events where subject_id = any($1::uuid[]) order by occurred_at asc, id asc', [ids])
  const result: Record<string, CrmEventRecord[]> = {}
  for (const row of rows) {
    const detail = row.detail as Record<string, unknown> | null
    const provenance = detail?.backfilled ? 'backfilled' : detail?.from !== undefined && detail?.to !== undefined ? 'observed' : 'logged'
    const occurredOn = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(String(row.occurred_at)))
    const event = { kind: row.kind, subjectId: row.subject_id, colleague: row.colleague, occurredOn, provenance,
      fromStage: provenance === 'observed' ? detail?.from ?? null : null,
      toStage: provenance === 'observed' ? detail?.to ?? null : null } as CrmEventRecord
    ;(result[event.subjectId] ??= []).push(event)
  }
  return result
}

export async function exportProspects(db: Queryable, raw: unknown): Promise<{
  asOf: string; total: number; guidance: string; rows: Record<string, unknown>[];
  nextCursor: string | null; historyAvailable?: boolean; fields?: string[];
}> {
  const input = exportProspectsSchema.parse(raw)
  const asOf = input.asOf ?? stockholmToday()
  const stages = STAGES.filter(stage => hasBeenContacted(stage) && (!input.stages || input.stages.includes(stage)))
  const params: unknown[] = [stages, input.contactedSince ?? null]
  const filter = 'stage::text = any($1::text[]) and ($2::date is null or last_interaction >= $2::date)'
  const [count] = await db.query(`select count(*)::int as total from opportunities where ${filter}`, params)
  const base = { asOf, total: Number(count.total), guidance: EXPORT_GUIDANCE }
  if (input.countOnly) return { ...base, rows: [], nextCursor: null }

  // Immutable ID ordering prevents edits to last_interaction from moving a row
  // across the cursor. Fresh inserts/eligibility changes still require rechecks.
  const opportunities = await db.query(`select *, last_interaction::text as last_interaction, follow_up_date::text as follow_up_date from opportunities where ${filter} and ($3::uuid is null or id > $3::uuid) order by id asc limit $4`, [...params, input.cursor ?? null, input.limit + 1])
  const page = opportunities.slice(0, input.limit)
  if (!page.length) return { ...base, rows: [], nextCursor: null, historyAvailable: true }
  const ids = page.map(row => String(row.id))
  const companyIds = [...new Set(page.map(row => row.company_id))]
  const contactIds = [...new Set(page.map(row => row.contact_id))]
  const [companyRows, contactRows, noteRows, taskRows] = await Promise.all([
    db.query('select * from companies where id = any($1::uuid[])', [companyIds]),
    db.query('select * from contacts where id = any($1::uuid[])', [contactIds]),
    db.query('select *, created_at::text as created_at from notes where opportunity_id = any($1::uuid[]) or company_id = any($2::uuid[])', [ids, companyIds]),
    db.query('select *, due_date::text as due_date from tasks where related_opportunity_id = any($1::uuid[]) or related_company_id = any($2::uuid[])', [ids, companyIds]),
  ])
  let historyAvailable = true
  let events: Record<string, CrmEventRecord[]> = {}
  try { events = await readEvents(db, ids) } catch { historyAvailable = false }
  const companies = new Map(companyRows.map(row => { const value = fromCompanyRow(row as unknown as CompanyRow); return [value.id, value] }))
  const contacts = new Map(contactRows.map(row => { const value = fromContactRow(row as unknown as ContactRow); return [value.id, value] }))
  const notes = noteRows.map(row => fromNoteRow(row as unknown as NoteRow))
  const tasks = taskRows.map(row => fromTaskRow(row as unknown as TaskRow))
  const [year, month, day] = asOf.split('-').map(Number)
  const today = new Date(year, month - 1, day)
  const groups = [...new Set(['identity', 'provenance', ...(input.fields ?? DEFAULT_GROUPS)])] as (keyof typeof EXPORT_GROUPS)[]
  const keys = [...new Set(groups.flatMap(group => [...EXPORT_GROUPS[group]]))]
  const rows: Record<string, unknown>[] = []
  let bytes = 2
  for (const source of page) {
    const opportunity = fromOpportunityRow(source as unknown as OpportunityRow)
    const company = companies.get(opportunity.companyId)
    const contact = contacts.get(opportunity.contactId)
    if (!company || !contact) throw new CrmError('incomplete_record', 'A prospect is missing its company or contact. Repair the link before exporting.')
    const [built] = buildExportRows([{ opportunity, company, contact }], { notes, tasks, events, today,
      colleagueName: id => id && id in colleagues ? colleagues[id as keyof typeof colleagues].name : '' })
    const row: Record<string, unknown> = { prospectId: opportunity.id, companyId: company.id, contactId: contact.id }
    const truncatedFields: string[] = []
    for (const key of keys) {
      const value = built[key]
      if (!value) continue
      row[key] = value.length > TEXT_LIMIT ? value.slice(0, TEXT_LIMIT) : value
      if (value.length > TEXT_LIMIT) truncatedFields.push(key)
    }
    if (truncatedFields.length) row.truncatedFields = truncatedFields
    const size = Buffer.byteLength(JSON.stringify(row), 'utf8') + 1
    if (bytes + size > EXPORT_ROWS_BYTES) {
      if (!rows.length) throw new CrmError('export_row_too_large', 'Request fewer field groups for this page.')
      break
    }
    rows.push(row)
    bytes += size
  }
  const hasMore = rows.length < page.length || opportunities.length > input.limit
  return { ...base, historyAvailable, fields: groups, rows, nextCursor: hasMore ? String(rows.at(-1)!.prospectId) : null }
}
