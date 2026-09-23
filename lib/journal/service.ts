import 'server-only'

import { createHash, randomUUID } from 'node:crypto'

import type { Database, Queryable } from '@/lib/crm/database'
import { CrmError } from '@/lib/crm/errors'
import { assertLiveSession } from '@/lib/org/members'
import type { ColleagueId } from '@/lib/types'
import {
  LINK_TARGET_TYPES,
  createEntryInputSchema,
  editEntryInputSchema,
  linkTargetSchema,
  listInputSchema,
  nextStepInputSchema,
  type CaptureSource,
  type ExportJournalEntry,
  type JournalCoverage,
  type JournalEntryDetail,
  type JournalEntryLinkView,
  type JournalEntryView,
  type JournalError,
  type JournalKind,
  type JournalOrigin,
  type JournalPage,
  type JournalRevisionView,
  type JournalSystemEvent,
  type JournalWriteResult,
  type LinkTarget,
  type LinkTargetType,
  type NextStepChangeResult,
  type OccurredPrecision,
  type ProcessingState,
} from './contracts'

/**
 * The one place anything is written to the Journal.
 *
 * Every path into it — the composer, the drawer's next-step change, the MCP
 * `log_outreach` tool, a later voice action — comes through `writeEntry`, so
 * "a capture, its entry, its first revision and its links, or nothing at all"
 * is a property of this file rather than a convention each caller is trusted
 * to follow. The alternative was three callers each inserting four rows, which
 * is three chances to forget the revision row and three different answers to
 * what a retry does.
 *
 * THE ADAPTER, NOT THE CLIENT. Entry points take `Database` and everything
 * inside a transaction takes `Queryable` (lib/crm/database.ts), the same split
 * lib/org/members.ts uses. Nothing here imports `next/*`, reads a cookie or
 * resolves a session: the caller has already done that and hands over an
 * organization and a user id. That is what lets tests/journal.test.ts drive
 * this file against PGlite with no server running and no network.
 *
 * SCOPE IS IN EVERY STATEMENT. Every select, update, insert and subquery below
 * names `organization_id`, including the link-target lookups and the `exists`
 * filter on the feed. tests/scoping.test.ts reads this file as text and checks
 * exactly that, which is why no table name here is interpolated — only column
 * names, from fixed maps. An id from another organization resolves to nothing
 * and comes back as `not_found` or `target_not_found`, never as a silent
 * success and never as a leak.
 *
 * FAILURE IS A VALUE. Everything a caller could reasonably provoke — a stale
 * revision, a redacted entry, a reused request key, a link to a record that is
 * not theirs, text that is too long — is returned as `{ ok: false, error }`
 * from the union in ./contracts, because the Server Action boundary turns a
 * thrown error into an opaque digest the browser cannot act on. A broken
 * invariant (a capture with no entry) still throws: nobody can provoke it and
 * it must be loud.
 *
 * A BROWSER WRITE RE-CHECKS WHO IS WRITING. The session was resolved when the
 * request arrived; the write happens later, possibly after an owner revoked
 * the person sending it. Every mutation transaction below that a browser
 * reaches — createEntry, editEntry, deleteEntry, addLink, removeLink and
 * changeNextStep — goes through `mutation()`, which takes the account lock and
 * asks lib/org/members.ts `assertLiveSession` whether that session is still
 * live on the same membership generation before anything is written. The MCP
 * path does not: its writes run inside `commitAction`, which revalidates the
 * connection under the same lock for every commit.
 */

/* ———— who is writing ———— */

/** Enough to scope a read. */
export type JournalScope = { organizationId: string }

/** Enough to attribute a change. `userId` is null only where no account is
 *  behind the write at all, which Stage 2 never does — migrated rows get
 *  their null from the backfill, not from here. */
export type JournalEditor = { organizationId: string; userId: string | null }

/**
 * Who is writing, and how the text reached Donna. `source` is the capture's
 * provenance, never the contact channel.
 *
 * `sessionId` and `credentialGeneration` are the browser session the Server
 * Action resolved (lib/auth/context.ts AuthContext). A `typed` actor without
 * both is refused `unauthorized`: every browser write re-checks them under the
 * account lock (see `mutation`). The MCP actor carries neither — its commit
 * revalidates the connection instead.
 */
export type JournalActor = JournalEditor & {
  source: Extract<CaptureSource, 'typed' | 'mcp'>
  sessionId?: string
  credentialGeneration?: string
}

/**
 * The server-only half of a write.
 *
 * `origin: 'system'` is here and nowhere in the input schema: the drawer's
 * next-step change and the MCP outreach line are Donna writing on somebody's
 * behalf, and a browser must not be able to post a line that reads that way.
 * `systemEvent` says which change a system entry records (only
 * `changeNextStep` sets it). `captureId` and `entryId` let the MCP path derive
 * both ids from its requestId, so a replayed tool call rebuilds the same rows
 * (lib/crm/service.ts `generatedId`).
 */
export type WriteOptions = {
  origin?: JournalOrigin
  systemEvent?: JournalSystemEvent
  captureId?: string
  entryId?: string
}

/* ———— rows ———— */

type EntryRow = {
  id: string
  organization_id: string
  capture_id: string
  author_id: string | null
  performer: ColleagueId | null
  origin: JournalOrigin
  system_event: JournalSystemEvent | null
  kind: JournalKind
  title: string | null
  body: string
  occurred_precision: OccurredPrecision
  occurred_on: string | null
  occurred_at: string | null
  revision: number
  legacy_kind: string | null
  legacy_dismissed: boolean
  legacy_applied: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
  source: CaptureSource
  processing_state: ProcessingState
  author_name: string | null
}

type LinkRow = {
  id: string
  entry_id: string
  target_type: LinkTargetType
  company_id: string | null
  contact_id: string | null
  opportunity_id: string | null
  lead_id: string | null
  task_id: string | null
  interaction_id: string | null
  target_label: string
  relationship: string
}

type RevisionRow = {
  revision: number
  title: string | null
  body: string
  kind: JournalKind
  occurred_precision: OccurredPrecision
  occurred_on: string | null
  occurred_at: string | null
  performer: ColleagueId | null
  changed_by: string | null
  changed_at: string
}

/** One typed column per entity — the schema's shape, as a map, so a column
 *  name can be chosen without a table name ever being interpolated. */
const LINK_COLUMN: Record<LinkTargetType, string> = {
  company: 'company_id',
  contact: 'contact_id',
  opportunity: 'opportunity_id',
  lead: 'lead_id',
  task: 'task_id',
  interaction: 'interaction_id',
}

/**
 * Full-precision ISO 8601, in UTC.
 *
 * `::text` on a timestamptz gives `2026-09-22 10:00:00.123456+00`, which is
 * Postgres's own format and not one every JavaScript engine parses. A JS
 * `Date` round-trip would be worse: it truncates to milliseconds, and the feed
 * cursor is a timestamp compared with `<` — losing the microseconds would skip
 * every row that falls inside the rounded-away interval. So the database
 * formats it, to the microsecond, in a shape both `Date.parse` and
 * `::timestamptz` read back exactly.
 */
const isoText = (column: string) => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

/** Everything a card needs, from the entry, its capture and its author's
 *  membership. No table names here — the statements below supply those. */
const ENTRY_COLUMNS = `e.id, e.organization_id, e.capture_id, e.author_id, e.performer, e.origin, e.system_event,
    e.kind, e.title, e.body, e.occurred_precision, e.occurred_on::text as occurred_on,
    ${isoText('e.occurred_at')} as occurred_at, e.revision, e.legacy_kind,
    e.legacy_dismissed, e.legacy_applied, ${isoText('e.deleted_at')} as deleted_at,
    ${isoText('e.created_at')} as created_at, ${isoText('e.updated_at')} as updated_at,
    c.source, c.processing_state, m.display_name as author_name`

/* ———— mapping ———— */

function toLinkView(row: LinkRow): JournalEntryLinkView {
  const targetId =
    row.company_id ?? row.contact_id ?? row.opportunity_id ?? row.lead_id ?? row.task_id ?? row.interaction_id ?? null
  return {
    id: row.id,
    targetType: row.target_type,
    // Null is the tombstone: the record was deleted, the composite key nulled
    // this column, and `targetLabel` is what it was called at link time.
    targetId,
    targetLabel: row.target_label,
    relationship: row.relationship,
  }
}

function toEntryView(row: EntryRow, links: JournalEntryLinkView[]): JournalEntryView {
  return {
    id: row.id,
    organizationId: row.organization_id,
    captureId: row.capture_id,
    authorId: row.author_id,
    authorName: row.author_name,
    performer: row.performer,
    origin: row.origin,
    systemEvent: row.system_event ?? null,
    kind: row.kind,
    title: row.title,
    body: row.body,
    occurredPrecision: row.occurred_precision,
    occurredOn: row.occurred_on,
    occurredAt: row.occurred_at,
    revision: Number(row.revision),
    source: row.source,
    processingState: row.processing_state,
    legacyKind: row.legacy_kind,
    legacyDismissed: row.legacy_dismissed,
    legacyApplied: row.legacy_applied,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    links,
  }
}

function toRevisionView(row: RevisionRow): JournalRevisionView {
  return {
    revision: Number(row.revision),
    title: row.title,
    body: row.body,
    kind: row.kind,
    occurredPrecision: row.occurred_precision,
    occurredOn: row.occurred_on,
    occurredAt: row.occurred_at,
    performer: row.performer,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
  }
}

/* ———— reads the writes share ———— */

async function linksFor(db: Queryable, organizationId: string, entryIds: string[]): Promise<Map<string, JournalEntryLinkView[]>> {
  const byEntry = new Map<string, JournalEntryLinkView[]>()
  if (!entryIds.length) return byEntry
  const rows = await db.query<LinkRow>(
    `select l.id, l.entry_id, l.target_type, l.company_id, l.contact_id, l.opportunity_id,
            l.lead_id, l.task_id, l.interaction_id, l.target_label, l.relationship
       from journal_entry_links l
      where l.organization_id = $1 and l.entry_id = any($2::uuid[])
      order by l.created_at asc, l.id asc`,
    [organizationId, entryIds]
  )
  for (const row of rows) {
    const list = byEntry.get(row.entry_id) ?? []
    list.push(toLinkView(row))
    byEntry.set(row.entry_id, list)
  }
  return byEntry
}

/** The views for a set of ids, in the order the ids were given. Anything not
 *  in this organization is simply absent from the result. */
async function viewsFor(db: Queryable, organizationId: string, entryIds: string[]): Promise<JournalEntryView[]> {
  if (!entryIds.length) return []
  const rows = await db.query<EntryRow>(
    `select ${ENTRY_COLUMNS}
       from journal_entries e
       join captures c on c.id = e.capture_id and c.organization_id = e.organization_id
       left join organization_members m on m.user_id = e.author_id and m.organization_id = e.organization_id
      where e.organization_id = $1 and e.id = any($2::uuid[])`,
    [organizationId, entryIds]
  )
  const links = await linksFor(db, organizationId, rows.map(row => row.id))
  const byId = new Map(rows.map(row => [row.id, toEntryView(row, links.get(row.id) ?? [])]))
  return entryIds.map(id => byId.get(id)).filter((view): view is JournalEntryView => Boolean(view))
}

/** One view, or a thrown invariant: the caller has just written or read the
 *  row's id inside the same transaction, so its absence is a bug here. */
async function viewOrThrow(db: Queryable, organizationId: string, entryId: string): Promise<JournalEntryView> {
  const [view] = await viewsFor(db, organizationId, [entryId])
  if (!view) throw new CrmError('journal_entry_vanished', `The journal entry ${entryId} was written but cannot be read back.`)
  return view
}

/**
 * The organization's clock, read inside the transaction that uses it.
 *
 * Decision 7: a Journal day is a day in the ORGANIZATION's timezone, not the
 * server's. An entry written at 22:30 UTC on a Monday belongs to Tuesday in
 * Stockholm, and once a second organization exists the server's own zone stops
 * being the right authority for either of them.
 */
async function organizationTimezone(db: Queryable, organizationId: string): Promise<string> {
  const [row] = await db.query<{ timezone: string }>('select timezone from organizations where id = $1', [organizationId])
  if (!row) throw new CrmError('not_found', 'The organization no longer exists.')
  return row.timezone
}

/* ———— link targets ———— */

/**
 * The label a link carries, read from the target record inside the caller's
 * organization — which is also how a target from anywhere else is refused.
 *
 * Every label is the name the CRM shows for that record: a prospect is called
 * by its COMPANY's name everywhere in this app, so an opportunity link reads
 * "Nordvik AB" rather than a uuid, and that is what survives as the tombstone
 * when the prospect is deleted.
 */
async function resolveTargetLabel(db: Queryable, organizationId: string, target: LinkTarget): Promise<string | null> {
  switch (target.type) {
    case 'company': {
      const [row] = await db.query<{ label: string }>(
        'select name as label from companies where id = $1 and organization_id = $2', [target.id, organizationId])
      return row?.label ?? null
    }
    case 'contact': {
      const [row] = await db.query<{ label: string }>(
        'select name as label from contacts where id = $1 and organization_id = $2', [target.id, organizationId])
      return row?.label ?? null
    }
    case 'opportunity': {
      const [row] = await db.query<{ label: string }>(
        `select c.name as label
           from opportunities o
           join companies c on c.id = o.company_id and c.organization_id = o.organization_id
          where o.id = $1 and o.organization_id = $2`, [target.id, organizationId])
      return row?.label ?? null
    }
    case 'lead': {
      // A lead has no company record yet — `company_name` is the free text
      // that stands in for one until it is promoted.
      const [row] = await db.query<{ label: string }>(
        'select company_name as label from leads where id = $1 and organization_id = $2', [target.id, organizationId])
      return row?.label ?? null
    }
    case 'task': {
      const [row] = await db.query<{ label: string }>(
        'select title as label from tasks where id = $1 and organization_id = $2', [target.id, organizationId])
      return row?.label ?? null
    }
    case 'interaction': {
      // The same label the notes backfill writes, so a migrated outreach line
      // and a new one read identically: `2026-09-10 · email`.
      const [row] = await db.query<{ label: string }>(
        `select i.occurred_on::text || ' · ' || i.channel as label
           from crm_interactions i where i.id = $1 and i.organization_id = $2`, [target.id, organizationId])
      return row?.label ?? null
    }
  }
}

/** Writes one link. `on conflict do nothing` because the partial unique index
 *  per target column already says one link per entry per record. */
async function insertLink(
  db: Queryable,
  actor: JournalEditor,
  entryId: string,
  target: LinkTarget,
  label: string
): Promise<void> {
  const column = LINK_COLUMN[target.type]
  await db.query(
    `insert into journal_entry_links (organization_id, entry_id, target_type, ${column}, target_label, relationship, created_by)
     values ($1, $2, $3, $4::uuid, $5, 'about', $6::uuid)
     on conflict do nothing`,
    [actor.organizationId, entryId, target.type, target.id, label, actor.userId]
  )
}

/* ———— the write ———— */

/**
 * Appends one revision row from the entry as it stands right now.
 *
 * Snapshotting FROM the entry rather than from the patch is deliberate: the
 * row and its history cannot disagree, because there is only one set of values
 * and the database supplies it. `updated_at` is the entry's own stamp, which
 * `set_updated_at` moves on every update, so this serves revision 1 (written
 * at creation) and revision N+1 (written after an edit) with one statement.
 */
async function appendRevision(db: Queryable, organizationId: string, entryId: string, changedBy: string | null): Promise<void> {
  await db.query(
    `insert into journal_entry_revisions (
       organization_id, entry_id, revision, title, body, kind,
       occurred_precision, occurred_on, occurred_at, performer, changed_by, changed_at)
     select e.organization_id, e.id, e.revision, e.title, e.body, e.kind,
            e.occurred_precision, e.occurred_on, e.occurred_at, e.performer, $3::uuid, e.updated_at
       from journal_entries e
      where e.id = $1 and e.organization_id = $2
     on conflict (entry_id, revision) do nothing`,
    [entryId, organizationId, changedBy]
  )
}

/**
 * What a retry has to match to be a replay: the write's EXPLICIT inputs, as a
 * sha256 over one fixed-order JSON document.
 *
 * Text alone was not enough. The composer keeps its request key until a save
 * succeeds, so a draft whose kind, date, title, performer or links changed
 * after a save that did land (but whose answer was lost) arrives under the
 * same key with the same text — and answering it with the first entry would
 * tell the writer their second version was saved when it was not.
 *
 * EXPLICIT means what the caller actually sent: the parsed input with zod's
 * defaults (the kind), never a value the server generates. An entry written
 * with no event time is `exact` at the moment of writing, and that moment
 * differs between the first attempt and its retry; hashing it would make
 * every such retry a conflict. So the occurrence fields are hashed as sent,
 * or null. The link set is sorted by type then id (and a repeated target
 * collapses, because the partial unique index writes one link per record), so
 * the same set in another order is the same request. `origin` is included
 * because it is part of what was asked for, even though only the server can
 * ask for `system`.
 */
function requestFingerprint(
  entry: {
    text: string
    title?: string | null
    kind: JournalKind
    occurredPrecision?: 'exact' | 'day'
    occurredOn?: string
    occurredAt?: string
    performer?: ColleagueId | null
    links: LinkTarget[]
  },
  origin: JournalOrigin
): string {
  const unique = new Map<string, LinkTarget>()
  for (const link of entry.links) {
    const target: LinkTarget = { type: link.type, id: link.id.toLowerCase() }
    unique.set(`${target.type}:${target.id}`, target)
  }
  const links = [...unique.values()].sort((a, b) =>
    a.type < b.type ? -1 : a.type > b.type ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const canonical = JSON.stringify({
    text: entry.text,
    title: entry.title ?? null,
    kind: entry.kind,
    occurredPrecision: entry.occurredPrecision ?? null,
    occurredOn: entry.occurredOn ?? null,
    occurredAt: entry.occurredAt ?? null,
    performer: entry.performer ?? null,
    origin,
    links,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * A retry of a key that has already been used.
 *
 * Same author and the same request — the fingerprint above, which covers the
 * text and everything else the caller said about the entry — is the same
 * person pressing save twice (or the same tool call replayed): the ORIGINAL
 * entry comes back marked `replayed` and nothing is written. It is compared
 * with the capture's stored fingerprint, never with the entry as it reads
 * now, because the entry may have been edited since and a retry is a retry
 * of what was first sent.
 *
 * Anything else is a key collision — a draft that was edited after its first
 * save succeeded, or two drafts sharing a key — and the entry the key DID
 * produce comes back with the refusal so the composer can link to it rather
 * than leaving the writer guessing what they lost. A capture with no
 * fingerprint (a legacy row, or one whose entry was deleted and redacted) can
 * prove nothing about what it was asked for, so it is always a collision.
 */
async function replayed(db: Queryable, actor: JournalActor, requestKey: string, fingerprint: string): Promise<JournalWriteResult> {
  const [capture] = await db.query<{ id: string; author_id: string | null; request_fingerprint: string | null }>(
    'select id, author_id, request_fingerprint from captures where organization_id = $1 and request_key = $2',
    [actor.organizationId, requestKey]
  )
  if (!capture) {
    throw new CrmError('journal_capture_vanished', 'A capture refused as a duplicate could not be read back.')
  }
  const [entryRow] = await db.query<{ id: string }>(
    'select id from journal_entries where organization_id = $1 and capture_id = $2', [actor.organizationId, capture.id]
  )
  if (!entryRow) {
    throw new CrmError('journal_entry_missing', `The capture ${capture.id} has no entry.`)
  }
  const existing = await viewOrThrow(db, actor.organizationId, entryRow.id)
  const sameAuthor = (capture.author_id ?? null) === (actor.userId ?? null)
  const sameRequest = capture.request_fingerprint !== null && capture.request_fingerprint === fingerprint
  if (sameAuthor && sameRequest) return { ok: true, replayed: true, entry: existing }
  return { ok: false, error: 'request_key_conflict', existing }
}

/**
 * The inner write: one capture, one entry, its first revision and its links,
 * inside the caller's transaction.
 *
 * It takes a `Queryable` rather than a `Database` precisely so it can be
 * enlisted in somebody else's transaction — `commitAction`'s, in the MCP path,
 * where an entry that cannot be written must take the interaction and the
 * prospect change down with it.
 *
 * ALL OR NOTHING ON LINKS. Every target is resolved before the entry is
 * inserted, and one target outside the organization fails the whole write with
 * `target_not_found`. An entry that quietly dropped a link would be evidence
 * filed against the wrong record, or against none.
 */
export async function writeEntry(
  tx: Queryable,
  actor: JournalActor,
  input: unknown,
  options: WriteOptions = {}
): Promise<JournalWriteResult> {
  const parsed = createEntryInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const entry = parsed.data

  /**
   * The event time, decided before anything is written.
   *
   * A caller that names its precision is obeyed — `log_outreach` sends `day`
   * with the date out of the outreach line, and a Stage 3 interpretation will
   * send one too — and a caller that says nothing gets the old derivation: a
   * day if it picked one, otherwise this instant.
   *
   * The same coherence the edit path enforces, and the same coherence the
   * table's own check constraint does, because the two halves must not be able
   * to disagree about what was claimed:
   *
   *   day   — needs the day it happened, and carries no instant. Inventing
   *           midnight for a date somebody typed is a precision they never
   *           claimed.
   *   exact — the instant given, or now; its day is DERIVED from that instant
   *           in the organization's timezone, so a day supplied alongside it
   *           could only disagree with the one that is about to be computed.
   */
  const precision: OccurredPrecision = entry.occurredPrecision ?? (entry.occurredOn ? 'day' : 'exact')
  if (precision === 'day' && !entry.occurredOn) return { ok: false, error: 'invalid' }
  if (precision === 'exact' && entry.occurredOn) return { ok: false, error: 'invalid' }

  const origin = options.origin ?? 'person'
  // Only Donna records a system event; the table's check says the same.
  if (options.systemEvent && origin !== 'system') return { ok: false, error: 'invalid' }
  const fingerprint = requestFingerprint(entry, origin)

  // The capture first, and its uniqueness is what makes this idempotent: the
  // insert either takes the key or finds it taken, in one statement, with no
  // read-then-write race in between.
  const captureId = options.captureId ?? randomUUID()
  const claimed = await tx.query<{ id: string }>(
    `insert into captures (id, organization_id, author_id, source, original_text, request_key, request_fingerprint, processing_state)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, 'not_requested')
     on conflict (organization_id, request_key) do nothing
     returning id`,
    [captureId, actor.organizationId, actor.userId, actor.source, entry.text, entry.requestKey, fingerprint]
  )
  if (!claimed.length) return replayed(tx, actor, entry.requestKey, fingerprint)

  // Before the entry exists, so a bad target costs nothing to undo.
  const labels: Array<{ target: LinkTarget; label: string }> = []
  for (const target of entry.links) {
    const label = await resolveTargetLabel(tx, actor.organizationId, target)
    if (label === null) return { ok: false, error: 'target_not_found' }
    labels.push({ target, label })
  }

  // Read inside the transaction that uses it: an `exact` entry's day is this
  // organization's day, not the server's.
  const timezone = await organizationTimezone(tx, actor.organizationId)
  const entryId = options.entryId ?? randomUUID()
  await tx.query(
    `insert into journal_entries (
       id, organization_id, capture_id, author_id, performer, origin, kind, title, body,
       occurred_precision, occurred_on, occurred_at, revision, system_event)
     select $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::crm_colleague, $6, $7, $8, $9,
            $10,
            coalesce($11::date, (t.moment at time zone $13)::date),
            case when $10 = 'exact' then t.moment else null end,
            1,
            $14
       from (select coalesce($12::timestamptz, now()) as moment) t`,
    [
      entryId,
      actor.organizationId,
      captureId,
      actor.userId,
      entry.performer ?? null,
      origin,
      entry.kind,
      entry.title ?? null,
      entry.text,
      precision,
      entry.occurredOn ?? null,
      entry.occurredAt ?? null,
      timezone,
      options.systemEvent ?? null,
    ]
  )

  await appendRevision(tx, actor.organizationId, entryId, actor.userId)
  for (const { target, label } of labels) await insertLink(tx, actor, entryId, target, label)

  return { ok: true, entry: await viewOrThrow(tx, actor.organizationId, entryId) }
}

/** Every refusal a write can answer with, and the one success shape. */
type Refusal = Extract<JournalWriteResult, { ok: false }>
type Accepted = Extract<JournalWriteResult, { ok: true }>

/**
 * Carries a refusal out through a transaction that has to roll back.
 *
 * `writeEntry` claims the request key by INSERTING the capture — that is what
 * makes it idempotent without a read-then-write race — so by the time a link
 * target turns out to belong to another organization, a row already exists.
 * Returning the refusal would commit that row: the write is refused, nothing
 * is acknowledged, and yet the key is taken by a capture with no entry, which
 * the next retry could not explain. So the refusal is thrown, the transaction
 * rolls back, and the result is handed back on the far side. changeNextStep
 * relies on the same thing: a refused system line takes the next-step update
 * down with it.
 */
class WriteRefused extends Error {
  constructor(readonly result: Refusal) {
    super('journal write refused')
  }
}

/**
 * Whether the writer may still write, asked inside its own transaction.
 *
 * `typed` is a browser session, and a browser session can be revoked between
 * the request arriving and the write landing. It is re-checked here under the
 * account lock (lib/org/members.ts `assertLiveSession`, which documents the
 * lock order): no session id or no generation is no session. `mcp` is not
 * checked here: its writes run inside commitAction, which revalidates the
 * connection and its membership under the same account lock for every commit
 * (lib/crm/service.ts), and a second, different check would only disagree.
 */
async function writerIsLive(tx: Queryable, actor: JournalActor): Promise<boolean> {
  if (actor.source !== 'typed') return true
  if (!actor.userId || !actor.sessionId || !actor.credentialGeneration) return false
  return assertLiveSession(tx, {
    userId: actor.userId,
    organizationId: actor.organizationId,
    sessionId: actor.sessionId,
    credentialGeneration: actor.credentialGeneration,
  })
}

/**
 * One browser-reachable mutation: its own transaction, the writer re-checked
 * first, every refusal rolled back.
 *
 * The check comes before any statement of the write, so the account lock is
 * the first lock the transaction takes and the row locks come after it — the
 * order assertLiveSession states. A refusal of any kind is thrown through
 * WriteRefused and handed back as a value, so nothing a refused call did
 * inside the transaction survives it and nothing is acknowledged.
 */
async function mutation<S extends { ok: true }>(
  db: Database,
  actor: JournalActor,
  run: (tx: Queryable) => Promise<S | Refusal>
): Promise<S | Refusal> {
  try {
    return await db.transaction(async tx => {
      if (!(await writerIsLive(tx, actor))) throw new WriteRefused({ ok: false, error: 'unauthorized' })
      const result = await run(tx)
      if (result.ok === false) throw new WriteRefused(result as Refusal)
      return result as S
    })
  } catch (cause) {
    if (cause instanceof WriteRefused) return cause.result
    throw cause
  }
}

/** The whole write, in a transaction of its own. What a Server Action calls. */
export async function createEntry(
  db: Database,
  actor: JournalActor,
  input: unknown,
  options: WriteOptions = {}
): Promise<JournalWriteResult> {
  return mutation<Accepted>(db, actor, tx => writeEntry(tx, actor, input, options))
}

/* ———— editing ———— */

/**
 * Why an update that matched nothing matched nothing.
 *
 * The update filters on id, organization, revision, `deleted_at is null` and
 * `origin = 'person'` at once, which is what makes it safe — and what makes a
 * miss ambiguous. This second read, scoped to the organization but INCLUDING
 * deleted and system rows, separates the four answers the editor has to tell
 * apart: an id that is not theirs (or is nobody's), an entry somebody deleted
 * while the editor was open, an entry Donna wrote (which nobody rewrites), and
 * an entry somebody edited while the editor was open.
 */
async function whyNotWritable(
  db: Queryable,
  organizationId: string,
  entryId: string,
  expectedRevision?: number
): Promise<Extract<JournalError, 'not_found' | 'deleted' | 'system_entry' | 'revision_conflict'>> {
  const [row] = await db.query<{ revision: number; deleted_at: string | null; origin: JournalOrigin }>(
    'select revision, deleted_at, origin from journal_entries where id = $1 and organization_id = $2', [entryId, organizationId]
  )
  if (!row) return 'not_found'
  if (row.deleted_at) return 'deleted'
  if (row.origin !== 'person') return 'system_entry'
  if (expectedRevision !== undefined && Number(row.revision) !== expectedRevision) return 'revision_conflict'
  // Every filter the update carried is satisfied on re-read, so the row moved
  // between the two statements. Reported as the conflict it is.
  return 'revision_conflict'
}

/**
 * Edits an entry and appends the wording that replaced.
 *
 * `expectedRevision` is compared in the update's own predicate rather than
 * read first and checked after: two editors saving at the same moment would
 * both read revision 3 and both write revision 4, and the second would erase
 * the first without either being told. In the predicate, the second update
 * matches nothing and comes back `revision_conflict`.
 *
 * A SYSTEM ENTRY IS NOT EDITABLE. `origin = 'person'` is in the same
 * predicate, so an entry Donna wrote — a next-step change, an outreach line,
 * their legacy forms — comes back `system_entry` whatever the browser sends.
 * Its wording records what the CRM did; letting a person rewrite it would make
 * the provenance chip a claim only the UI enforced. It can still be deleted.
 */
export async function editEntry(
  db: Database,
  actor: JournalActor,
  entryId: string,
  patch: unknown
): Promise<JournalWriteResult> {
  const parsed = editEntryInputSchema.safeParse(patch)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const input = parsed.data

  return mutation<Accepted>(db, actor, async tx => {
    const sets: string[] = []
    const values: unknown[] = []
    /** Binds a value and returns the placeholder that names it. */
    const bind = (value: unknown): string => {
      values.push(value)
      return `$${values.length}`
    }

    if (input.title !== undefined) sets.push(`title = ${bind(input.title ?? null)}`)
    if (input.body !== undefined) sets.push(`body = ${bind(input.body)}`)
    if (input.kind !== undefined) sets.push(`kind = ${bind(input.kind)}`)
    if (input.performer !== undefined) sets.push(`performer = ${bind(input.performer ?? null)}::crm_colleague`)

    // The event time moves as a triple or not at all: the table's check
    // constraint refuses any other combination, and a patch that set one of
    // the three alone would depend on what the other two happened to be.
    if (input.occurredOn !== undefined) {
      sets.push(`occurred_precision = 'day'`, `occurred_on = ${bind(input.occurredOn)}::date`, 'occurred_at = null')
    } else if (input.occurredAt !== undefined) {
      const timezone = await organizationTimezone(tx, actor.organizationId)
      const instant = bind(input.occurredAt)
      sets.push(
        `occurred_precision = 'exact'`,
        `occurred_at = ${instant}::timestamptz`,
        `occurred_on = (${instant}::timestamptz at time zone ${bind(timezone)})::date`
      )
    }

    sets.push('revision = revision + 1')

    values.push(entryId, actor.organizationId, input.expectedRevision)
    const updated = await tx.query<{ id: string }>(
      `update journal_entries set ${sets.join(', ')}
        where id = $${values.length - 2} and organization_id = $${values.length - 1}
          and revision = $${values.length} and deleted_at is null and origin = 'person'
       returning id`,
      values
    )
    if (!updated.length) {
      return { ok: false as const, error: await whyNotWritable(tx, actor.organizationId, entryId, input.expectedRevision) }
    }

    await appendRevision(tx, actor.organizationId, entryId, actor.userId)
    return { ok: true as const, entry: await viewOrThrow(tx, actor.organizationId, entryId) }
  })
}

/* ———— links ———— */

/** The entry a link is being hung on, or why it cannot be. */
async function writableEntry(
  db: Queryable,
  organizationId: string,
  entryId: string
): Promise<Extract<JournalError, 'not_found' | 'deleted'> | null> {
  const [row] = await db.query<{ deleted_at: string | null }>(
    'select deleted_at from journal_entries where id = $1 and organization_id = $2', [entryId, organizationId]
  )
  if (!row) return 'not_found'
  if (row.deleted_at) return 'deleted'
  return null
}

/** Links an existing entry to a record. Adding a link twice is not an error —
 *  the second one finds the partial unique index and does nothing. */
export async function addLink(
  db: Database,
  actor: JournalActor,
  entryId: string,
  target: unknown
): Promise<JournalWriteResult> {
  const parsed = linkTargetSchema.safeParse(target)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  return mutation<Accepted>(db, actor, async tx => {
    const refusal = await writableEntry(tx, actor.organizationId, entryId)
    if (refusal) return { ok: false as const, error: refusal }
    const label = await resolveTargetLabel(tx, actor.organizationId, parsed.data)
    if (label === null) return { ok: false as const, error: 'target_not_found' as const }
    await insertLink(tx, actor, entryId, parsed.data, label)
    return { ok: true as const, entry: await viewOrThrow(tx, actor.organizationId, entryId) }
  })
}

/** Removes one link by its own id. The entry is untouched. */
export async function removeLink(
  db: Database,
  actor: JournalActor,
  entryId: string,
  linkId: string
): Promise<JournalWriteResult> {
  return mutation<Accepted>(db, actor, async tx => {
    const refusal = await writableEntry(tx, actor.organizationId, entryId)
    if (refusal) return { ok: false as const, error: refusal }
    const removed = await tx.query<{ id: string }>(
      `delete from journal_entry_links
        where id = $1 and entry_id = $2 and organization_id = $3
       returning id`,
      [linkId, entryId, actor.organizationId]
    )
    if (!removed.length) return { ok: false as const, error: 'not_found' as const }
    return { ok: true as const, entry: await viewOrThrow(tx, actor.organizationId, entryId) }
  })
}

/* ———— deletion ———— */

/**
 * Redacts an entry: the content goes, the fact that something was written
 * stays (decision 5).
 *
 * WHAT IS REACHED. The entry's body and title, the capture's original text,
 * every revision's body and title, and `legacy_extraction` — the old
 * `ai_extracted` blob, which is content too and is the one field a reader
 * would not think of.
 *
 * The capture's `request_fingerprint` goes too. It is a hash, not the text,
 * but it is a hash OF the text (and its metadata), and a short line is easy
 * to confirm by hashing guesses — keeping it would keep a way to test what
 * the entry said. A retry of the key afterwards meets a capture that can
 * prove nothing about its request, and is a `request_key_conflict` naming the
 * deleted entry, which is the honest answer.
 *
 * WHAT IS DELIBERATELY NOT REACHED. The links: `target_label` is a CRM
 * record's name, not Journal text, and clearing it would blank the tombstones
 * on records that are still there. Receipts hold no entry text at all (§6), so
 * there is nothing of this entry's wording anywhere else to reach.
 *
 * Idempotent: `coalesce` keeps the first `deleted_at` and the first
 * `deleted_by`, so deleting twice is the same state and the same answer.
 * Allowed on a system entry: removing Donna's line is a person's call to make,
 * rewriting it is not (editEntry).
 */
export async function deleteEntry(db: Database, actor: JournalActor, entryId: string): Promise<JournalWriteResult> {
  return mutation<Accepted>(db, actor, async tx => {
    const redacted = await tx.query<{ capture_id: string }>(
      `update journal_entries
          set body = '', title = null, legacy_extraction = null,
              deleted_at = coalesce(deleted_at, now()), deleted_by = coalesce(deleted_by, $3::uuid)
        where id = $1 and organization_id = $2
       returning capture_id`,
      [entryId, actor.organizationId, actor.userId]
    )
    // The `mustAffect` rule from lib/crm/service.ts: an update filtered by id
    // AND organization that hit nothing did not find the row, and an id from
    // another organization must be indistinguishable from an id from nowhere.
    if (!redacted.length) return { ok: false as const, error: 'not_found' as const }

    await tx.query(
      `update captures set original_text = '', request_fingerprint = null, deleted_at = coalesce(deleted_at, now())
        where id = $1 and organization_id = $2`,
      [redacted[0].capture_id, actor.organizationId]
    )
    await tx.query(
      `update journal_entry_revisions set body = '', title = null
        where entry_id = $1 and organization_id = $2`,
      [entryId, actor.organizationId]
    )
    return { ok: true as const, entry: await viewOrThrow(tx, actor.organizationId, entryId) }
  })
}

/* ———— the next step ———— */

/**
 * Changes a prospect's next step and records the value it replaced, in ONE
 * transaction.
 *
 * Before this, the drawer made two calls — the opportunity update over
 * PostgREST and a system line sent separately with the drawer's own copy of
 * the old value — so either could land without the other, and the "previous
 * next step" in the Journal was whatever the browser said it was. Now the
 * server reads the previous value itself, under a row lock, writes the new
 * one, and writes the system entry, or none of the three happens.
 *
 * WHAT THE ENTRY SAYS. `origin: 'system'`, `systemEvent: 'next_step_changed'`,
 * `kind: 'update'`, linked to the opportunity (the label is the company's
 * name, resolved by writeEntry), and `body` = the PREVIOUS next step alone.
 * The label ("Nästa steg" / "Next step") is rendered by the reader from its
 * own dictionary; storing it would freeze one language into the row. Nothing
 * is logged when the previous value was empty (there was no step to record)
 * or equals the new one.
 *
 * THE REQUEST KEY is `nextstep:<opportunity>:<updated_at before the change>`.
 * The row lock serializes two submissions, so the second one normally reads
 * the first one's result as its previous value and logs that transition, or
 * nothing when the value is unchanged. The key covers the case the lock
 * cannot: the same transition from the same row state arriving twice is one
 * capture and one entry, answered `replayed`; any later transition starts
 * from a later `updated_at` and gets its own. `updated_at` is formatted by the
 * database to the microsecond in UTC, so the key does not depend on a
 * connection's timezone setting.
 *
 * Order inside the transaction: the writer re-check (account lock), then the
 * opportunity row lock, then the Journal rows — the order lib/org/members.ts
 * `assertLiveSession` states. The `updated_at` trigger advances the row's
 * version, which is what an MCP caller's `expectedVersion` compares against.
 */
export async function changeNextStep(
  db: Database,
  actor: JournalActor,
  opportunityId: string,
  next: unknown
): Promise<NextStepChangeResult> {
  const parsed = nextStepInputSchema.safeParse(next)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  // Not an id at all is the same answer as an id from nowhere, and never a
  // cast error from the database.
  if (!UUID_PATTERN.test(opportunityId)) return { ok: false, error: 'not_found' }
  const value = parsed.data

  return mutation<Extract<NextStepChangeResult, { ok: true }>>(db, actor, async tx => {
    const [row] = await tx.query<{ next_step: string | null; updated_at: string }>(
      `select o.next_step, ${isoText('o.updated_at')} as updated_at
         from opportunities o
        where o.id = $1 and o.organization_id = $2
        for update`,
      [opportunityId, actor.organizationId]
    )
    if (!row) return { ok: false as const, error: 'not_found' as const }
    const previous = row.next_step ?? ''

    await tx.query(
      'update opportunities set next_step = $1 where id = $2 and organization_id = $3',
      [value, opportunityId, actor.organizationId]
    )
    if (!previous || previous === value) return { ok: true as const, entry: null, previous }

    const written = await writeEntry(
      tx,
      actor,
      {
        requestKey: `nextstep:${opportunityId}:${row.updated_at}`,
        text: previous,
        kind: 'update',
        links: [{ type: 'opportunity', id: opportunityId }],
      },
      { origin: 'system', systemEvent: 'next_step_changed' }
    )
    if (!written.ok) return written
    return { ok: true as const, entry: written.entry, previous }
  })
}

/* ———— reads ———— */

/** The feed cursor: the last row's sort key, opaque to the client. */
function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url')
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  let raw: string
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const split = raw.lastIndexOf('|')
  if (split <= 0) return null
  const createdAt = raw.slice(0, split)
  const id = raw.slice(split + 1)
  if (!UUID_PATTERN.test(id) || Number.isNaN(Date.parse(createdAt))) return null
  return { createdAt, id }
}

/**
 * The `exists` filter for a targets query, plus the parameters it needs.
 *
 * `exists` rather than a join: an entry linked to both the prospect and its
 * company matches twice in a join and would appear twice in the feed. The
 * semi-join asks whether any link matches and stops there, so A02 — one entry,
 * two links — is one row under either target.
 */
function targetsFilter(targets: LinkTarget[], values: unknown[]): string {
  const arms: string[] = []
  for (const type of LINK_TARGET_TYPES) {
    const ids = targets.filter(target => target.type === type).map(target => target.id)
    if (!ids.length) continue
    values.push(ids)
    arms.push(`l.${LINK_COLUMN[type]} = any($${values.length}::uuid[])`)
  }
  if (!arms.length) return ''
  return `and exists (select 1 from journal_entry_links l
      where l.entry_id = e.id and l.organization_id = e.organization_id and (${arms.join(' or ')}))`
}

export type JournalPageResult = { ok: true; page: JournalPage } | { ok: false; error: JournalError }

/**
 * One page of the feed, newest first.
 *
 * KEYSET, NOT OFFSET. The cursor is the last row's `(created_at, id)` and the
 * next page asks for rows strictly below it. An entry written while somebody
 * is paging is newer than every cursor in play, so it lands above the window
 * and shifts nothing — with `offset` it would push one row of page 2 onto page
 * 3, where the reader has already been, and that row would simply never be
 * seen. `id` breaks ties on identical timestamps so the order is total.
 *
 * `legacy_dismissed` rows stay out, which is exactly what dismissing a note
 * did before: today's visibility is preserved rather than quietly widened by
 * the migration.
 */
export async function listEntries(db: Queryable, scope: JournalScope, input: unknown): Promise<JournalPageResult> {
  const parsed = listInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const args = parsed.data

  const cursor = args.cursor ? decodeCursor(args.cursor) : null
  if (args.cursor && !cursor) return { ok: false, error: 'invalid' }

  const values: unknown[] = [scope.organizationId, args.includeDeleted, args.origins, cursor?.createdAt ?? null, cursor?.id ?? null]
  const filter = args.targets?.length ? targetsFilter(args.targets, values) : ''
  // One more than asked for: the extra row is how `hasMore` is known without a
  // second count over the same predicate.
  values.push(args.limit + 1)

  const rows = await db.query<EntryRow>(
    `select ${ENTRY_COLUMNS}
       from journal_entries e
       join captures c on c.id = e.capture_id and c.organization_id = e.organization_id
       left join organization_members m on m.user_id = e.author_id and m.organization_id = e.organization_id
      where e.organization_id = $1
        and e.legacy_dismissed = false
        and (e.deleted_at is null or $2::boolean)
        and e.origin = any($3::text[])
        and ($4::timestamptz is null or (e.created_at, e.id) < ($4::timestamptz, $5::uuid))
        ${filter}
      order by e.created_at desc, e.id desc
      limit $${values.length}`,
    values
  )

  const hasMore = rows.length > args.limit
  const page = rows.slice(0, args.limit)
  const links = await linksFor(db, scope.organizationId, page.map(row => row.id))
  const entries = page.map(row => toEntryView(row, links.get(row.id) ?? []))
  const last = page[page.length - 1]

  const coverage: JournalCoverage = {
    returned: entries.length,
    hasMore,
    oldestCreatedAt: last ? last.created_at : null,
    loadedAt: new Date().toISOString(),
  }
  return {
    ok: true,
    page: { entries, nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null, coverage },
  }
}

export type JournalEntryResult = { ok: true; entry: JournalEntryDetail } | { ok: false; error: JournalError }

/**
 * One entry with the text as it arrived and every wording since.
 *
 * A deleted entry is still readable: the card has to be able to say "this was
 * removed" rather than the surface pretending the row was never there.
 */
export async function getEntry(db: Queryable, scope: JournalScope, id: string): Promise<JournalEntryResult> {
  if (!UUID_PATTERN.test(id)) return { ok: false, error: 'not_found' }
  const [view] = await viewsFor(db, scope.organizationId, [id])
  if (!view) return { ok: false, error: 'not_found' }

  const [capture] = await db.query<{ original_text: string }>(
    'select original_text from captures where id = $1 and organization_id = $2', [view.captureId, scope.organizationId]
  )
  const revisions = await db.query<RevisionRow>(
    `select r.revision, r.title, r.body, r.kind, r.occurred_precision,
            r.occurred_on::text as occurred_on, ${isoText('r.occurred_at')} as occurred_at,
            r.performer, r.changed_by, ${isoText('r.changed_at')} as changed_at
       from journal_entry_revisions r
      where r.entry_id = $1 and r.organization_id = $2
      order by r.revision asc`,
    [id, scope.organizationId]
  )
  return { ok: true, entry: { ...view, originalText: capture?.original_text ?? '', revisions: revisions.map(toRevisionView) } }
}

/** How many entries a feed's filter actually covers — entries, not links, so
 *  an entry linked to both a prospect and its company counts once. */
export async function countEntries(db: Queryable, scope: JournalScope, targets?: LinkTarget[]): Promise<number> {
  const values: unknown[] = [scope.organizationId]
  const filter = targets?.length ? targetsFilter(targets, values) : ''
  const [row] = await db.query<{ total: number }>(
    `select count(*)::int as total
       from journal_entries e
      where e.organization_id = $1
        and e.legacy_dismissed = false
        and e.deleted_at is null
        ${filter}`,
    values
  )
  return Number(row?.total ?? 0)
}

/**
 * The Journal entries the contacted-prospect export counts, grouped by
 * opportunity.
 *
 * DECISION 13: person-written entries only. A next-step line and an outreach
 * line are Donna repeating what the CRM already records in its own columns;
 * counting them as notes would inflate every `note_count` in the file with
 * text nobody wrote.
 *
 * An entry reaches a prospect through its own link OR through its company's,
 * which is what `notesFor` did with `opportunityId`/`companyId` before —
 * `distinct` because an entry linked to both must be counted once.
 */
export async function listExportEntries(
  db: Queryable,
  scope: JournalScope,
  opportunityIds: string[]
): Promise<Record<string, ExportJournalEntry[]>> {
  const grouped: Record<string, ExportJournalEntry[]> = {}
  if (!opportunityIds.length) return grouped

  const rows = await db.query<{ opportunity_id: string; id: string; body: string; created_at: string; occurred_on: string | null }>(
    `select distinct o.id as opportunity_id, e.id, e.body,
            ${isoText('e.created_at')} as created_at, e.occurred_on::text as occurred_on
       from opportunities o
       join journal_entry_links l
         on l.organization_id = o.organization_id
        and (l.opportunity_id = o.id or l.company_id = o.company_id)
       join journal_entries e
         on e.id = l.entry_id and e.organization_id = l.organization_id
      where o.organization_id = $1
        and o.id = any($2::uuid[])
        and e.origin = 'person'
        and e.deleted_at is null
        and e.legacy_dismissed = false
      order by created_at asc`,
    [scope.organizationId, opportunityIds]
  )

  for (const row of rows) {
    const list = grouped[row.opportunity_id] ?? []
    list.push({ id: row.id, body: row.body, createdAt: row.created_at, occurredOn: row.occurred_on })
    grouped[row.opportunity_id] = list
  }
  return grouped
}
