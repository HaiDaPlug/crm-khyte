import { z } from 'zod'

import type { ColleagueId } from '@/lib/types'

/**
 * What a Journal write and a Journal read are allowed to say.
 *
 * NO `server-only` HERE, DELIBERATELY. The composer, the drafts module and the
 * store slice all need these types and these limits — the 20,000-character
 * ceiling is enforced in the textarea as well as in the database — and
 * tests/store.test.ts runs without `--conditions=react-server`. Adding the
 * import would break every one of those the moment a client file imported a
 * type from here. ./service.ts is the half that touches Postgres and it is the
 * half that carries the marker.
 *
 * WHAT IS NOT IN THESE SCHEMAS IS THE POINT. There is no `origin` and no
 * `organizationId`, `authorId` or `entryId`: an entry written by a person is
 * `origin: 'person'` because the write service says so, and the ids come from
 * the session. `origin: 'system'` is reachable only through the server-side
 * options argument of writeEntry (the next-step line and the MCP tool), so a
 * browser cannot post a line that reads as though Donna wrote it.
 */

/* ———— vocabulary ———— */

/** The five kinds an entry can be. `update` is the neutral default. */
export const JOURNAL_KINDS = ['conversation', 'observation', 'idea', 'decision', 'update'] as const
export type JournalKind = (typeof JOURNAL_KINDS)[number]

/** Everything an entry can be linked to. One typed column per entity. */
export const LINK_TARGET_TYPES = ['company', 'contact', 'opportunity', 'lead', 'task', 'interaction'] as const
export type LinkTargetType = (typeof LINK_TARGET_TYPES)[number]

/** How precisely the event time is known. Stage 2 writes the first two. */
export const OCCURRED_PRECISIONS = ['exact', 'day', 'month', 'unknown'] as const
export type OccurredPrecision = (typeof OCCURRED_PRECISIONS)[number]

/** Who wrote it: a person, or Donna on someone's behalf. */
export const ORIGINS = ['person', 'system'] as const
export type JournalOrigin = (typeof ORIGINS)[number]

/** How the text entered Donna. Not `channel` — that means something else on
 *  crm_interactions. */
export const CAPTURE_SOURCES = ['typed', 'mcp', 'legacy'] as const
export type CaptureSource = (typeof CAPTURE_SOURCES)[number]

/** Stage 2 writes `not_requested` only; the rest are Stage 3's. */
export type ProcessingState =
  | 'not_requested'
  | 'queued'
  | 'interpreting'
  | 'ready'
  | 'needs_clarification'
  | 'failed'

/** The fixed roster, as lib/crm/contracts.ts declares it. */
const colleague = z.enum(['erik', 'abdi', 'hai'])

/** The database's own ceiling on a capture, repeated here so an over-long
 *  paste is refused before it becomes a constraint violation. */
export const MAX_TEXT_LENGTH = 20000
/** More than this many links on one entry is a program doing something odd,
 *  not a person describing a conversation. */
export const MAX_LINKS = 20

/* ———— inputs ———— */

export const linkTargetSchema = z.strictObject({
  type: z.enum(LINK_TARGET_TYPES),
  id: z.uuid(),
})
export type LinkTarget = z.infer<typeof linkTargetSchema>

/**
 * A new entry, as the composer or a tool submits it.
 *
 * `requestKey` is minted by the client when the draft is first written and
 * reused until the save succeeds, which is what makes a retry return the
 * original entry instead of a second one.
 *
 * THE EVENT TIME. Omit both dates and the entry is `exact` at the moment it is
 * written, its day computed in the organization's timezone. Give `occurredOn`
 * and it is `day`: a date somebody picked carries no instant, and inventing
 * midnight for it would be a precision the person never claimed. Give
 * `occurredAt` and it is `exact` at that instant, its day again the
 * organization's.
 */
export const createEntryInputSchema = z
  .strictObject({
    requestKey: z.string().min(1).max(128),
    text: z.string().min(1).max(MAX_TEXT_LENGTH),
    title: z.string().trim().max(200).nullish(),
    kind: z.enum(JOURNAL_KINDS).default('update'),
    occurredPrecision: z.enum(['exact', 'day']).optional(),
    occurredOn: z.iso.date().optional(),
    occurredAt: z.iso.datetime({ offset: true }).optional(),
    performer: colleague.nullish(),
    links: z.array(linkTargetSchema).max(MAX_LINKS).default([]),
  })
  .refine(
    input => input.occurredPrecision !== 'day' || Boolean(input.occurredOn),
    { message: 'occurredPrecision "day" needs the day it happened' }
  )
  .refine(
    input => !(input.occurredOn && input.occurredAt),
    { message: 'a day and an instant are two different claims; send one' }
  )
export type CreateEntryInput = z.input<typeof createEntryInputSchema>

/**
 * An edit. `expectedRevision` is the revision the editor was looking at: a
 * write against a stale one is refused rather than silently overwriting
 * somebody else's wording, which is the whole reason the revisions table
 * exists.
 *
 * The event-time rules are the create rules, minus the default: an edit that
 * says nothing about the dates leaves them exactly as they were.
 */
export const editEntryInputSchema = z
  .strictObject({
    title: z.string().trim().max(200).nullish(),
    body: z.string().min(1).max(MAX_TEXT_LENGTH).optional(),
    kind: z.enum(JOURNAL_KINDS).optional(),
    occurredPrecision: z.enum(['exact', 'day']).optional(),
    occurredOn: z.iso.date().optional(),
    occurredAt: z.iso.datetime({ offset: true }).optional(),
    performer: colleague.nullish(),
    expectedRevision: z.int().min(1),
  })
  .refine(
    input => input.occurredPrecision !== 'day' || Boolean(input.occurredOn),
    { message: 'occurredPrecision "day" needs the day it happened' }
  )
  .refine(
    input => input.occurredPrecision !== 'exact' || Boolean(input.occurredAt),
    { message: 'occurredPrecision "exact" needs the instant it happened' }
  )
  .refine(
    input => !(input.occurredOn && input.occurredAt),
    { message: 'a day and an instant are two different claims; send one' }
  )
export type EditEntryInput = z.input<typeof editEntryInputSchema>

/**
 * One page of the feed.
 *
 * `targets` is an any-of filter: an entry linked to the prospect OR to its
 * company belongs on the prospect's timeline, and an entry linked to both
 * belongs there once.
 */
export const listInputSchema = z.strictObject({
  cursor: z.string().max(256).optional(),
  limit: z.int().min(1).max(100).default(30),
  targets: z.array(linkTargetSchema).max(MAX_LINKS).optional(),
  origins: z.array(z.enum(ORIGINS)).min(1).max(2).default([...ORIGINS]),
  includeDeleted: z.boolean().default(false),
})
export type ListEntriesInput = z.input<typeof listInputSchema>

/* ———— views ———— */

/** A link as the feed renders it. `targetId` null is a tombstone: the record
 *  was deleted and `targetLabel` is what it was called at link time. */
export interface JournalEntryLinkView {
  id: string
  targetType: LinkTargetType
  targetId: string | null
  targetLabel: string
  relationship: string
}

/** One entry, everything a card needs and nothing a card does not. */
export interface JournalEntryView {
  id: string
  organizationId: string
  captureId: string
  authorId: string | null
  /** The author's display name in this organization; null means unknown —
   *  a migrated note, or an account that has since been deleted. */
  authorName: string | null
  performer: ColleagueId | null
  origin: JournalOrigin
  kind: JournalKind
  title: string | null
  body: string
  occurredPrecision: OccurredPrecision
  occurredOn: string | null
  occurredAt: string | null
  revision: number
  source: CaptureSource
  processingState: ProcessingState
  legacyKind: string | null
  legacyDismissed: boolean
  legacyApplied: boolean
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  links: JournalEntryLinkView[]
}

/** One past wording of an entry. Row 1 is the entry as created. */
export interface JournalRevisionView {
  revision: number
  title: string | null
  body: string
  kind: JournalKind
  occurredPrecision: OccurredPrecision
  occurredOn: string | null
  occurredAt: string | null
  performer: ColleagueId | null
  changedBy: string | null
  changedAt: string
}

/** What the expanded card reads: the entry, the text as it arrived, and every
 *  wording since. */
export interface JournalEntryDetail extends JournalEntryView {
  originalText: string
  revisions: JournalRevisionView[]
}

/** One entry as the CSV export counts it. */
export interface ExportJournalEntry {
  id: string
  body: string
  createdAt: string
  occurredOn: string | null
}

/**
 * How much of the Journal the caller is actually looking at — ONE type, used
 * by the service, the actions, the store and the MCP tool.
 *
 * A feed that quietly shows the first thirty of two hundred entries is a feed
 * that lies by omission, and every surface that renders entries has to be able
 * to say so in the same words. `unavailable` is the demo-mode case: no
 * database, so zero entries is not the same statement as "there are none".
 */
export interface JournalCoverage {
  returned: number
  hasMore: boolean
  oldestCreatedAt: string | null
  loadedAt: string
  unavailable?: boolean
}

/* ———— results ———— */

/**
 * Everything that can go wrong, as a value rather than an exception.
 *
 *   not_found            no such entry in this organization — including an id
 *                        that belongs to another one, which must look exactly
 *                        like an id that belongs to nobody.
 *   deleted              the entry is there but redacted; an edit cannot be
 *                        applied to it, and the card says so in its own words.
 *   request_key_conflict the key was already used for different text. The
 *                        entry it was used for comes back so the composer can
 *                        link to it.
 *   revision_conflict    somebody edited it while this editor was open.
 *   target_not_found     a link target that is not in this organization. The
 *                        whole write fails; a half-linked entry is worse than
 *                        a refusal.
 *   invalid              the input did not pass the schema.
 *   unavailable          no database configured (demo mode).
 */
export type JournalError =
  | 'not_found'
  | 'deleted'
  | 'request_key_conflict'
  | 'revision_conflict'
  | 'target_not_found'
  | 'invalid'
  | 'unavailable'

/** What every write returns. `replayed` marks a retry that found its own
 *  earlier entry rather than writing a second one. */
export type JournalWriteResult =
  | { ok: true; entry: JournalEntryView; replayed?: boolean }
  | { ok: false; error: JournalError; existing?: JournalEntryView }

/** One page of the feed. */
export interface JournalPage {
  entries: JournalEntryView[]
  nextCursor: string | null
  coverage: JournalCoverage
}

/** An empty page — what a read answers with when there is no database. */
export function unavailablePage(): JournalPage {
  return {
    entries: [],
    nextCursor: null,
    coverage: { returned: 0, hasMore: false, oldestCreatedAt: null, loadedAt: new Date().toISOString(), unavailable: true },
  }
}
