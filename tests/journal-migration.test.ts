import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { applyMigrations, dropNotes, finishRollout, readSql } from './support/migrations'

/**
 * Rehearses supabase/migrations/20261001120000_journal.sql the way it will
 * actually run: against a database that already holds the three shapes of
 * legacy `notes` row production has, on the schema as it stood the moment
 * before.
 *
 * tests/mcp.test.ts applies every migration to an EMPTY database, so the
 * backfill there sees nothing and proves nothing. The backfill is the whole
 * risk of this migration: it decides, for every line anyone ever typed into
 * the old prospect drawer, what kind of thing it was, when it happened, who
 * performed it, and which prospect it is about — and there is no second
 * chance to decide better, because `notes` is dropped by a follow-up once the
 * build is verified. So this suite seeds the legacy rows, runs the migration,
 * and asserts what the live database will hold afterwards, then runs the
 * whole file a second time to prove a re-push changes nothing, then rehearses
 * the drop.
 *
 * tests/organization-migration.test.ts is the model; the shape is deliberately
 * the same so the two read as one pair.
 *
 * No .env files, remote database, production credentials, or network access.
 */

const JOURNAL_MIGRATION = '20261001120000_journal.sql'
/** Fixed in 20260920120000_organizations.sql, and the organization every
 *  legacy row lands in while the rollout default still stands. */
const KHYTE = '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10'

const pg = new PGlite()
const rows = async <T extends Record<string, unknown>>(sql: string, values: unknown[] = []) => (await pg.query<T>(sql, values)).rows
const count = async (table: string) => Number((await rows<{ n: number }>(`select count(*)::int as n from ${table}`))[0].n)
const journalSql = () => readSql(`supabase/migrations/${JOURNAL_MIGRATION}`)

/** Fixed ids, so every assertion can name the exact row it means. */
const legacy = {
  company: randomUUID(), contact: randomUUID(), opportunity: randomUUID(), connection: randomUUID(),
  // The one interaction the matched outreach line is a duplicate of …
  interaction: randomUUID(),
  // … and two indistinguishable rows, which no rule can choose between.
  twinA: randomUUID(), twinB: randomUUID(),
}

/** One note per shape the backfill has to tell apart. */
const note = {
  plain: randomUUID(),
  nextStep: randomUUID(),
  outreachMatched: randomUUID(),
  outreachUnmatched: randomUUID(),
  outreachDoubled: randomUUID(),
  both: randomUUID(),
  extracted: randomUUID(),
  dismissed: randomUUID(),
  lateEvening: randomUUID(),
  // Valid legacy content the first text of this migration would have refused
  // or aborted on: a note longer than the composer's ceiling, and three lines
  // shaped like outreach whose fields the tool could never have written.
  long: randomUUID(),
  malformedDate: randomUUID(),
  malformedChannel: randomUUID(),
  malformedColleague: randomUUID(),
}
const SEEDED_NOTES = Object.keys(note).length

const COMPANY_NAME = 'Nordvik AB'
/** The middle dot is U+00B7, exactly as lib/crm/service.ts writes it. */
const OUTREACH_MATCHED = '[2026-09-10 · email · erik] Sent the deck'
const OUTREACH_UNMATCHED = '[2026-09-11 · email · hai] Nobody logged this one'
const OUTREACH_DOUBLED = '[2026-09-12 · phone · abdi] Talked twice'
const NEXT_STEP = 'Nästa steg: Skicka offert'
const PLAIN = 'Called, interested.'
const BOTH = 'Met the CFO and the CEO.'
const EXTRACTED = 'Fjällvind are hiring; worth a call.'
const DISMISSED = 'A suggestion nobody wanted.'
const LATE_EVENING = 'Sent the summary just before midnight.'
const EXTRACTION = { company: COMPANY_NAME, confidence: 0.4 }
/** One character over the 20 000 a new capture may carry. The old drawer set
 *  no limit, so a note like this can exist, and it is somebody's text. */
const LONG = `Long legacy note. ${'x'.repeat(20001 - 'Long legacy note. '.length)}`
/** The outreach shape, with a date that does not exist. `'2026-99-99'::date`
 *  raises, and inside the backfill that would abort the whole push. */
const MALFORMED_DATE = '[2026-99-99 · email · hai] ordinary text'
/** A channel crm_interactions has never allowed, and a name not on the roster. */
const MALFORMED_CHANNEL = '[2026-09-10 · pigeon · erik] Sent by carrier pigeon'
const MALFORMED_COLLEAGUE = '[2026-09-10 · email · bob] Bob is not on the roster'
const MALFORMED = 3

/** A second organization. It cannot exist until the rollout follow-up has
 *  run, so the test that applies that file is the one that creates it. */
const OTHER = randomUUID()

type EntryRow = {
  id: string
  capture_id: string
  organization_id: string
  author_id: string | null
  performer: string | null
  origin: string
  kind: string
  title: string | null
  body: string
  occurred_precision: string
  occurred_on: string | null
  occurred_at_null: boolean
  occurred_at_is_created_at: boolean | null
  revision: number
  legacy_kind: string | null
  legacy_extraction: unknown
  legacy_dismissed: boolean
  legacy_applied: boolean
}

/**
 * One entry, with the timestamp comparisons done in SQL — a timestamptz
 * rendered into a string by two different layers is a comparison about
 * formatting, not about what the migration copied. It deliberately does not
 * join `notes`: the last test in this file runs after that table is dropped,
 * and an entry has to be readable without it. What was copied from `notes` is
 * asserted row-by-row in the first test, while the table is still there.
 */
const entry = async (id: string): Promise<EntryRow> => (await rows<EntryRow>(
  `select e.id, e.capture_id, e.organization_id, e.author_id, e.performer::text as performer,
          e.origin, e.kind, e.title, e.body, e.occurred_precision, e.occurred_on::text as occurred_on,
          (e.occurred_at is null) as occurred_at_null,
          (e.occurred_at = e.created_at) as occurred_at_is_created_at,
          e.revision, e.legacy_kind, e.legacy_extraction, e.legacy_dismissed, e.legacy_applied
     from journal_entries e
    where e.id = $1`, [id]))[0]

type LinkRow = {
  target_type: string
  target_label: string
  relationship: string
  company_id: string | null
  contact_id: string | null
  opportunity_id: string | null
  lead_id: string | null
  task_id: string | null
  interaction_id: string | null
}

const links = async (entryId: string): Promise<LinkRow[]> => rows<LinkRow>(
  `select target_type, target_label, relationship,
          company_id, contact_id, opportunity_id, lead_id, task_id, interaction_id
     from journal_entry_links where entry_id = $1 order by target_type`, [entryId])

type Counts = {
  notes_seen: number
  captures_inserted: number
  entries_inserted: number
  revisions_inserted: number
  links_inserted: number
  with_extraction: number
  dismissed: number
  applied: number
  outreach_total: number
  outreach_linked: number
  outreach_unmatched: number
  outreach_malformed: number
}

const migrateNotes = async (): Promise<Counts> =>
  (await rows<{ result: Counts }>('select public.journal_migrate_notes() as result'))[0].result

before(async () => {
  await pg.exec(`create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`)
  // Everything up to, but not including, the migration under rehearsal.
  await applyMigrations(pg, { stopBefore: JOURNAL_MIGRATION })

  // The prospect every note is about. No organization_id is given anywhere in
  // this block: the rollout default from 20260920120000_organizations.sql is
  // still standing, which is exactly the state a Stage 2 push lands in, and it
  // files every row under Khyte.
  await pg.query(`insert into companies (id, name, domain) values ($1, $2, 'nordvik.test')`, [legacy.company, COMPANY_NAME])
  await pg.query(`insert into contacts (id, company_id, name, email) values ($1, $2, 'Anna', 'anna@nordvik.test')`, [legacy.contact, legacy.company])
  await pg.query(`insert into opportunities (id, company_id, contact_id, stage, in_pipeline, followed_up_by)
    values ($1, $2, $3, 'Contacted', true, 'erik')`, [legacy.opportunity, legacy.company, legacy.contact])
  // crm_interactions.connection_id is a plain uuid column, but a real
  // connection row is what the MCP tool actually wrote beside, and the
  // organization migration suite seeds one the same way.
  await pg.query(`insert into crm_oauth_connections (id, client_id, access_hash, refresh_hash, scopes, access_expires_at, refresh_expires_at)
    values ($1, 'test-chatgpt', 'access-hash', 'refresh-hash', '{crm:read}', now() + interval '1 hour', now() + interval '30 days')`, [legacy.connection])

  const interaction = (id: string, on: string, channel: string, colleague: string, summary: string) =>
    pg.query(`insert into crm_interactions (id, opportunity_id, company_id, contact_id, occurred_on, channel, summary, followed_up_by, connection_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, legacy.opportunity, legacy.company, legacy.contact, on, channel, summary, colleague, legacy.connection])
  await interaction(legacy.interaction, '2026-09-10', 'email', 'erik', 'Sent the deck')
  // Two interactions the double-matched line cannot be told apart by. Nothing
  // in crm_interactions forbids them: the source uniqueness index is partial
  // on source_message_id, which the drawer path never sets.
  await interaction(legacy.twinA, '2026-09-12', 'phone', 'abdi', 'Talked twice')
  await interaction(legacy.twinB, '2026-09-12', 'phone', 'abdi', 'Talked twice')

  const legacyNote = (id: string, raw: string, createdAt: string, options: {
    opportunity?: string | null; company?: string | null; extraction?: unknown; dismissed?: boolean
  } = {}) => pg.query(
    `insert into notes (id, opportunity_id, company_id, raw, ai_extracted, dismissed, created_at, updated_at)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $7)`,
    [id, options.opportunity ?? null, options.company ?? null, raw,
      options.extraction === undefined ? null : JSON.stringify(options.extraction),
      options.dismissed ?? false, createdAt])

  await legacyNote(note.plain, PLAIN, '2026-09-05T08:00:00Z', { opportunity: legacy.opportunity })
  await legacyNote(note.nextStep, NEXT_STEP, '2026-09-06T09:00:00Z', { opportunity: legacy.opportunity })
  await legacyNote(note.outreachMatched, OUTREACH_MATCHED, '2026-09-10T11:00:00Z', { opportunity: legacy.opportunity })
  await legacyNote(note.outreachUnmatched, OUTREACH_UNMATCHED, '2026-09-11T11:00:00Z', { opportunity: legacy.opportunity })
  await legacyNote(note.outreachDoubled, OUTREACH_DOUBLED, '2026-09-12T11:00:00Z', { opportunity: legacy.opportunity })
  await legacyNote(note.both, BOTH, '2026-09-13T12:00:00Z', { opportunity: legacy.opportunity, company: legacy.company })
  await legacyNote(note.extracted, EXTRACTED, '2026-09-14T13:00:00Z', { company: legacy.company, extraction: EXTRACTION })
  await legacyNote(note.dismissed, DISMISSED, '2026-09-15T14:00:00Z', { opportunity: legacy.opportunity, dismissed: true })
  // 22:30 UTC on a Monday is 00:30 on the Tuesday in Europe/Stockholm, which
  // is the organization's own clock and the only one that may decide the day.
  await legacyNote(note.lateEvening, LATE_EVENING, '2026-09-21T22:30:00Z')
  // Unlinked, so the link arithmetic below is unchanged by them.
  await legacyNote(note.long, LONG, '2026-09-16T08:00:00Z')
  await legacyNote(note.malformedDate, MALFORMED_DATE, '2026-09-17T08:00:00Z')
  await legacyNote(note.malformedChannel, MALFORMED_CHANNEL, '2026-09-18T08:00:00Z')
  await legacyNote(note.malformedColleague, MALFORMED_COLLEAGUE, '2026-09-19T08:00:00Z')

  assert.equal(await count('notes'), SEEDED_NOTES)
  await pg.exec(await journalSql())
})
after(async () => { await pg.close() })

test('every legacy note arrives as one capture and one entry, keeping its id, its text and its timestamps', async () => {
  assert.equal(await count('captures'), SEEDED_NOTES)
  assert.equal(await count('journal_entries'), SEEDED_NOTES)
  assert.equal(await count('journal_entry_revisions'), SEEDED_NOTES,
    'a migrated entry has the same revision 1 the write service records for an entry typed today')

  const [matched] = await rows<{ n: number }>(
    `select count(*)::int as n from journal_entries e
       join captures c on c.id = e.id and c.organization_id = e.organization_id
       join notes n on n.id = e.id
      where e.capture_id = e.id
        and e.body = n.raw and c.original_text = n.raw
        and e.created_at = n.created_at and c.created_at = n.created_at and c.received_at = n.created_at
        and e.updated_at = n.updated_at and c.updated_at = n.updated_at
        and e.organization_id = n.organization_id and e.organization_id = $1
        and e.author_id is null and c.author_id is null
        and c.source = 'legacy' and c.processing_state = 'not_requested'
        and c.request_key = 'legacy:' || n.id::text
        and e.kind = 'update' and e.title is null and e.revision = 1`, [KHYTE])
  assert.equal(Number(matched.n), SEEDED_NOTES,
    'entry id = capture id = note id, with the text, the organization and both timestamps carried across unchanged')

  // Revision 1 is the entry as created, so a legacy entry and an entry typed
  // today read the same way through getEntry(): an empty history would
  // otherwise have to mean "never edited" for one and "migrated" for the
  // other, and a reader cannot tell those apart.
  const [revisions] = await rows<{ n: number }>(
    `select count(*)::int as n from journal_entry_revisions v
       join journal_entries e on e.id = v.entry_id and e.organization_id = v.organization_id
       join notes n on n.id = e.id
      where v.revision = 1
        and v.title is not distinct from e.title
        and v.body = e.body and v.kind = e.kind
        and v.occurred_precision = e.occurred_precision
        and v.occurred_on is not distinct from e.occurred_on
        and v.occurred_at is not distinct from e.occurred_at
        and v.performer is not distinct from e.performer
        and v.changed_by is null
        and v.changed_at = n.created_at`)
  assert.equal(Number(revisions.n), SEEDED_NOTES,
    'revision 1 holds the entry exactly as created, is attributed to nobody, and is stamped with the note\'s own created_at')

  // A22: nobody is invented. The old drawer never recorded who typed a note,
  // so attributing one now would be a guess written into the record forever.
  assert.equal((await rows('select 1 from journal_entries where author_id is not null')).length, 0)
  assert.equal((await rows('select 1 from journal_entry_revisions where changed_by is not null')).length, 0)
})

test('the three shapes are told apart, and each keeps only the date precision it actually has', async () => {
  const plain = await entry(note.plain)
  assert.equal(plain.legacy_kind, 'drawer_note')
  assert.equal(plain.origin, 'person', 'a line a person typed is theirs')
  assert.equal(plain.performer, null)
  assert.equal(plain.occurred_precision, 'exact')
  assert.equal(plain.occurred_at_is_created_at, true, 'the timestamp is all that was ever known about when it happened')
  assert.equal(plain.occurred_on, '2026-09-05')

  const nextStep = await entry(note.nextStep)
  assert.equal(nextStep.legacy_kind, 'next_step')
  assert.equal(nextStep.origin, 'system', 'the drawer wrote this line, not a person')
  assert.equal(nextStep.body, NEXT_STEP)
  assert.equal(nextStep.occurred_precision, 'exact')

  for (const [id, on, performer] of [
    [note.outreachMatched, '2026-09-10', 'erik'],
    [note.outreachUnmatched, '2026-09-11', 'hai'],
    [note.outreachDoubled, '2026-09-12', 'abdi'],
  ] as const) {
    const outreach = await entry(id)
    assert.equal(outreach.legacy_kind, 'outreach')
    assert.equal(outreach.origin, 'system')
    assert.equal(outreach.performer, performer, 'the colleague parsed out of the line performed the activity')
    assert.equal(outreach.occurred_precision, 'day', 'the line carries a date and nothing more precise')
    assert.equal(outreach.occurred_on, on)
    assert.equal(outreach.occurred_at_null, true, "precision 'day' forbids an instant, and the check constraint says so")
  }

  // Decision 7: the organization's clock, not the server's. 2026-09-21T22:30Z
  // is already 2026-09-22 in Europe/Stockholm.
  const late = await entry(note.lateEvening)
  assert.equal(late.occurred_precision, 'exact')
  assert.equal(late.occurred_on, '2026-09-22',
    "22:30 UTC belongs to the next day in the organization's timezone; the server's zone has no say")
  assert.equal(late.occurred_at_is_created_at, true)
})

test('a legacy note longer than a new capture may be is copied whole: capture, entry and revision', async () => {
  assert.equal(LONG.length, 20001)
  const [copied] = await rows<{ capture_length: number; entry_length: number; revision_length: number; identical: boolean }>(
    `select char_length(c.original_text) as capture_length, char_length(e.body) as entry_length,
            char_length(v.body) as revision_length,
            (c.original_text = n.raw and e.body = n.raw and v.body = n.raw) as identical
       from notes n
       join captures c on c.id = n.id
       join journal_entries e on e.id = n.id
       join journal_entry_revisions v on v.entry_id = e.id and v.revision = 1
      where n.id = $1 and c.source = 'legacy'`, [note.long])
  assert.ok(copied, 'the long note has a capture, an entry and a revision')
  assert.equal(copied.identical, true, 'lossless: the source text, byte for byte, in all three places')
  assert.equal(Number(copied.capture_length), 20001)
  assert.equal(Number(copied.entry_length), 20001)
  assert.equal(Number(copied.revision_length), 20001)
  const long = await entry(note.long)
  assert.equal(long.legacy_kind, 'drawer_note')
  assert.equal(long.origin, 'person')

  // The ceiling still binds everything that is NOT a migrated note: the
  // composer's promise, now the database's too, for new input only.
  await assert.rejects(pg.query(
    `insert into captures (organization_id, source, original_text, request_key) values ($1, 'typed', $2, $3)`,
    [KHYTE, LONG, `too-long-${randomUUID()}`]), /captures_original_text_check/)
  await assert.rejects(pg.query(
    `insert into captures (organization_id, source, original_text, request_key) values ($1, 'mcp', $2, $3)`,
    [KHYTE, LONG, `too-long-${randomUUID()}`]), /captures_original_text_check/)
})

test('a line shaped like outreach whose fields the tool never wrote is migrated as a person\'s note, and counted', async () => {
  for (const [id, raw, createdOn] of [
    [note.malformedDate, MALFORMED_DATE, '2026-09-17'],
    [note.malformedChannel, MALFORMED_CHANNEL, '2026-09-18'],
    [note.malformedColleague, MALFORMED_COLLEAGUE, '2026-09-19'],
  ] as const) {
    const malformed = await entry(id)
    assert.ok(malformed, `${raw} must be migrated, not abort the push`)
    assert.equal(malformed.body, raw, 'kept word for word')
    assert.equal(malformed.legacy_kind, 'drawer_note', raw)
    assert.equal(malformed.origin, 'person', `${raw}: nothing proves Donna wrote it, so it is what a person typed`)
    assert.equal(malformed.performer, null, `${raw}: no colleague is read out of a line that is not outreach`)
    assert.equal(malformed.occurred_precision, 'exact', `${raw}: its timestamp is all that is known`)
    assert.equal(malformed.occurred_at_is_created_at, true)
    assert.equal(malformed.occurred_on, createdOn, 'the day it was written, in Stockholm, not a date parsed out of the text')
    assert.equal((await links(id)).length, 0, `${raw}: no interaction is matched to a line that is not outreach`)
  }
  // The helper itself: a date, or null — never an exception.
  const [parsed] = await rows<{ good: string | null; bad: string | null; junk: string | null }>(
    `select public.journal_try_date('2026-09-10')::text as good, public.journal_try_date('2026-99-99')::text as bad,
            public.journal_try_date('not a date')::text as junk`)
  assert.deepEqual(parsed, { good: '2026-09-10', bad: null, junk: null })
})

test('an outreach line is linked to its interaction only when exactly one interaction can be it', async () => {
  const matched = await links(note.outreachMatched)
  assert.equal(matched.length, 2)
  const interactionLink = matched.find(l => l.target_type === 'interaction')
  assert.ok(interactionLink, 'the one line with a single matching interaction is linked to it')
  assert.equal(interactionLink.interaction_id, legacy.interaction)
  assert.equal(interactionLink.target_label, '2026-09-10 · email')
  assert.equal(interactionLink.relationship, 'about')
  const opportunityLink = matched.find(l => l.target_type === 'opportunity')
  assert.ok(opportunityLink)
  assert.equal(opportunityLink.opportunity_id, legacy.opportunity)
  assert.equal(opportunityLink.target_label, COMPANY_NAME, "a prospect is called by its company's name everywhere in this CRM")

  const unmatched = await links(note.outreachUnmatched)
  assert.deepEqual(unmatched.map(l => l.target_type), ['opportunity'],
    'no interaction matches this line, so nothing is linked rather than something plausible')

  const doubled = await links(note.outreachDoubled)
  assert.deepEqual(doubled.map(l => l.target_type), ['opportunity'],
    'two interactions match equally well; choosing one would be a coin toss recorded as a fact')

  // The note that carried both link columns gets both links, each with the
  // company's name as its label.
  const both = await links(note.both)
  assert.deepEqual(both.map(l => l.target_type), ['company', 'opportunity'])
  assert.equal(both.find(l => l.target_type === 'company')?.company_id, legacy.company)
  assert.equal(both.find(l => l.target_type === 'company')?.target_label, COMPANY_NAME)
  assert.equal(both.find(l => l.target_type === 'opportunity')?.target_label, COMPANY_NAME)

  assert.deepEqual((await links(note.extracted)).map(l => l.target_type), ['company'])
  assert.equal((await links(note.lateEvening)).length, 0, 'a note that named no record links to none')

  // 1 + 1 + 2 (matched: opportunity and interaction) + 1 + 1 + 2 + 1 + 1 + 0
  assert.equal(await count('journal_entry_links'), 10)
})

test('the unverified metadata is carried, never acted on, and the dismissed row stays dismissed', async () => {
  const extracted = await entry(note.extracted)
  assert.deepEqual(extracted.legacy_extraction, EXTRACTION,
    'old ai_extracted is unverified metadata: kept so nothing is lost, never retroactively executed')
  assert.equal(extracted.legacy_dismissed, false)

  const dismissed = await entry(note.dismissed)
  assert.equal(dismissed.legacy_dismissed, true, "today's visibility is preserved: a dismissed note stays out of the feed")
  assert.equal(dismissed.legacy_extraction, null)

  assert.equal((await rows('select 1 from journal_entries where legacy_applied')).length, 0)
  assert.equal((await rows('select 1 from journal_entries where legacy_extraction is not null')).length, 1)
  assert.equal((await rows('select 1 from journal_entries where legacy_dismissed')).length, 1)
})

test('the function reports the counts the tables actually show, and re-running it inserts nothing', async () => {
  const steady = await migrateNotes()
  assert.equal(steady.notes_seen, await count('notes'))
  assert.equal(steady.captures_inserted, 0, 'every capture already exists; `on conflict (id) do nothing` is what makes that true')
  assert.equal(steady.entries_inserted, 0)
  assert.equal(steady.revisions_inserted, 0, '`on conflict (entry_id, revision) do nothing` keeps revision 1 singular')
  assert.equal(steady.links_inserted, 0, 'the links are guarded by `where not exists`, not by luck')
  assert.equal(steady.with_extraction, 1)
  assert.equal(steady.dismissed, 1)
  assert.equal(steady.applied, 0)
  assert.equal(steady.outreach_total, 3)
  assert.equal(steady.outreach_linked, 1)
  assert.equal(steady.outreach_unmatched, 2, 'the gap is a number somebody can look at, not a silence')
  assert.equal(steady.outreach_malformed, MALFORMED, 'so is the number of lines that looked like outreach and were not')
  assert.equal(steady.notes_seen, await count('captures'))
  assert.equal(steady.notes_seen, await count('journal_entries'))
  assert.equal(steady.notes_seen, await count('journal_entry_revisions'))
  console.log(`[journal] journal_migrate_notes() on the migrated database: ${JSON.stringify(steady)}`)

  // What the old build writes between `db:push` and the Stage 2 deploy going
  // live. The function is re-runnable precisely so these are not lost, and the
  // counts it returns are the ones the tables moved by.
  const held = {
    notes: await count('notes'), captures: await count('captures'), entries: await count('journal_entries'),
    revisions: await count('journal_entry_revisions'), links: await count('journal_entry_links'),
  }
  const late = { company: randomUUID(), orphan: randomUUID() }
  await pg.query(`insert into notes (id, company_id, raw, created_at, updated_at)
    values ($1, $2, 'Written by the old build during the deploy window.', '2026-09-23T07:00:00Z', '2026-09-23T07:00:00Z')`, [late.company, legacy.company])
  await pg.query(`insert into notes (id, raw, created_at, updated_at)
    values ($1, '[2026-09-24 · meeting · unassigned] Nobody was credited.', '2026-09-24T07:00:00Z', '2026-09-24T07:00:00Z')`, [late.orphan])

  const caught = await migrateNotes()
  assert.equal(caught.notes_seen, held.notes + 2)
  assert.equal(caught.captures_inserted, 2)
  assert.equal(caught.entries_inserted, 2)
  assert.equal(caught.revisions_inserted, 2, 'each of them arrives with its revision 1, the same as an entry typed today')
  assert.equal(caught.links_inserted, 1, 'one company link; the outreach line names no prospect, so it can match no interaction')
  assert.equal(caught.outreach_total, 4)
  assert.equal(caught.outreach_linked, 1)
  assert.equal(caught.outreach_unmatched, 3)
  assert.equal(caught.outreach_malformed, MALFORMED, "'unassigned' is a value the tool writes, so the late line is outreach, not malformed")
  assert.equal(await count('captures'), held.captures + 2)
  assert.equal(await count('journal_entries'), held.entries + 2)
  assert.equal(await count('journal_entry_revisions'), held.revisions + 2)
  assert.equal(await count('journal_entry_links'), held.links + 1)
  // 'unassigned' is what the tool writes when it had nobody. It is not on the
  // roster, and turning a placeholder into a colleague is the invented
  // attribution Stage 1 forbade.
  assert.equal((await entry(late.orphan)).performer, null)
  assert.equal((await entry(late.orphan)).legacy_kind, 'outreach')
  console.log(`[journal] journal_migrate_notes() catching up two later notes: ${JSON.stringify(caught)}`)
})

test('row level security is on and every one of the four tables carries a membership policy', async () => {
  const JOURNAL_TABLES = ['captures', 'journal_entries', 'journal_entry_revisions', 'journal_entry_links']
  const secured = await rows<{ relname: string; relrowsecurity: boolean }>(
    `select relname, relrowsecurity from pg_class
      where relnamespace = 'public'::regnamespace and relname = any($1)`, [JOURNAL_TABLES])
  assert.equal(secured.length, 4)
  for (const table of secured) assert.equal(table.relrowsecurity, true, `${table.relname} must have row level security enabled`)

  const policies = await rows<{ tablename: string; policyname: string }>(
    `select tablename, policyname from pg_policies where schemaname = 'public' and tablename = any($1)`, [JOURNAL_TABLES])
  for (const table of JOURNAL_TABLES) {
    assert.ok(policies.some(p => p.tablename === table && p.policyname.startsWith("members manage their organization's")),
      `${table} needs the same membership policy shape every other organization-owned table has`)
  }
  // Dormant, like Stage 1's: with auth.uid() null nobody is a member of
  // anything, which is what the stub above makes true.
  assert.equal((await rows<{ m: boolean }>('select public.is_org_member($1) as m', [KHYTE]))[0].m, false)
})

test('the three parents a link can point at gained the (id, organization_id) key that makes a composite key possible', async () => {
  for (const name of ['leads_id_organization_key', 'tasks_id_organization_key', 'crm_interactions_id_organization_key']) {
    const [constraint] = await rows<{ contype: string }>('select contype from pg_constraint where conname = $1', [name])
    assert.ok(constraint, `${name} must exist: a composite foreign key needs a composite key to reference`)
    assert.equal(constraint.contype, 'u')
  }

  // A link names one record and says truthfully which kind it is. (Two
  // targets at once breaks both the one-target check and the type check of
  // whichever column target_type does not name, and Postgres is free to
  // report either, so the assertion names the class rather than the winner.)
  await assert.rejects(pg.query(
    `insert into journal_entry_links (organization_id, entry_id, target_type, company_id, opportunity_id, target_label)
     values ($1, $2, 'company', $3, $4, 'Two at once')`, [KHYTE, note.plain, legacy.company, legacy.opportunity]),
    /violates check constraint "journal_entry_links_/)
  await assert.rejects(pg.query(
    `insert into journal_entry_links (organization_id, entry_id, target_type, company_id, target_label)
     values ($1, $2, 'opportunity', $3, 'Mislabelled')`, [KHYTE, note.plain, legacy.company]),
    /journal_entry_links_company_type/)
})

test('applying the whole file a second time changes nothing — which is what a re-push after a rolled-back attempt does', async () => {
  const held = {
    captures: await count('captures'),
    entries: await count('journal_entries'),
    links: await count('journal_entry_links'),
    revisions: await count('journal_entry_revisions'),
    notes: await count('notes'),
  }
  await pg.exec(await journalSql())
  assert.deepEqual({
    captures: await count('captures'),
    entries: await count('journal_entries'),
    links: await count('journal_entry_links'),
    revisions: await count('journal_entry_revisions'),
    notes: await count('notes'),
  }, held, 'a second apply must insert nothing and drop nothing')

  // Not merely "the same number of links": no entry gained a duplicate of a
  // link it already had, which is the failure a count alone would hide.
  const duplicates = await rows<{ entry_id: string }>(
    `select entry_id from journal_entry_links
      group by entry_id, coalesce(company_id, contact_id, opportunity_id, lead_id, task_id, interaction_id)
     having count(*) > 1`)
  assert.equal(duplicates.length, 0)
  assert.equal((await entry(note.outreachMatched)).body, OUTREACH_MATCHED, 'nothing was rewritten either')
  assert.equal((await entry(note.long)).body, LONG)
  assert.equal((await entry(note.malformedDate)).legacy_kind, 'drawer_note')

  // The corrections themselves are idempotent: one length check, now scoped
  // to new input; one fingerprint column; one system_event column and its
  // two checks — however many times the file has run.
  const checks = await rows<{ conname: string; definition: string }>(
    `select conname, pg_get_constraintdef(oid) as definition from pg_constraint
      where conrelid in ('public.captures'::regclass, 'public.journal_entries'::regclass)
        and conname in ('captures_original_text_check', 'journal_entries_system_event_check', 'journal_entries_system_event_origin_check')
      order by conname`)
  assert.deepEqual(checks.map(c => c.conname),
    ['captures_original_text_check', 'journal_entries_system_event_check', 'journal_entries_system_event_origin_check'])
  assert.match(checks[0].definition, /legacy/, 'the capture ceiling exempts migrated notes')
  const columns = await rows<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and column_name in ('request_fingerprint', 'system_event') order by table_name`)
  assert.deepEqual(columns.map(c => `${c.table_name}.${c.column_name}`), ['captures.request_fingerprint', 'journal_entries.system_event'])
  assert.equal((await rows('select 1 from captures where request_fingerprint is not null')).length, 0,
    'a legacy capture was never a request, so it has no fingerprint')
  assert.equal((await rows('select 1 from journal_entries where system_event is not null')).length, 0,
    'a migrated next-step line keeps its full text and no system event')
})

test('a database that ran this file\'s earlier text is brought to the corrected constraint by the re-run', async () => {
  // The only database that ran the first text is the disposable local review
  // stack; this is what a re-run does there. Put back the old column check —
  // same name, legacy rows bounded too — and apply the file again.
  await pg.exec(`alter table public.captures drop constraint captures_original_text_check;
    alter table public.captures add constraint captures_original_text_check check (char_length(original_text) <= 20000) not valid;`)
  await pg.exec(await journalSql())
  const [check] = await rows<{ definition: string; validated: boolean }>(
    `select pg_get_constraintdef(oid) as definition, convalidated as validated from pg_constraint
      where conrelid = 'public.captures'::regclass and conname = 'captures_original_text_check'`)
  assert.match(check.definition, /legacy/, 'the older definition was replaced by name')
  assert.equal(check.validated, true)
  assert.equal((await entry(note.long)).body, LONG, 'and the long note is still there')
})

test('deleting the prospect keeps what was written about it, as a tombstone — which is what `notes` got wrong', async () => {
  const labelsBefore = (await rows<{ target_label: string }>(
    `select target_label from journal_entry_links where opportunity_id = $1 order by entry_id`, [legacy.opportunity])).map(l => l.target_label)
  assert.ok(labelsBefore.length > 0, 'there are opportunity links to lose')
  const entriesBefore = await count('journal_entries')

  await pg.query('delete from opportunities where id = $1', [legacy.opportunity])

  const tombstones = await rows<{ target_type: string; target_label: string; opportunity_id: string | null; organization_id: string }>(
    `select target_type, target_label, opportunity_id, organization_id from journal_entry_links
      where target_type = 'opportunity' order by entry_id`)
  assert.equal(tombstones.length, labelsBefore.length, 'the link rows survive the prospect')
  for (const link of tombstones) {
    assert.equal(link.opportunity_id, null, '`on delete set null (opportunity_id)` nulls the link')
    assert.equal(link.target_label, COMPANY_NAME, 'the record was called this at link time, and that is what is left of it')
    assert.equal(link.organization_id, KHYTE, 'the column list is what stops `set null` reaching organization_id')
  }
  assert.equal(await count('journal_entries'), entriesBefore, 'A20: the entry outlives the prospect')
  assert.equal((await entry(note.outreachMatched)).body, OUTREACH_MATCHED)

  // The legacy row this entry was copied from does NOT survive: notes' link
  // keys still cascade, exactly as Stage 1 left them, and this migration
  // deliberately changes nothing about that table. It is why the Journal
  // needed its own tables rather than an extension of `notes`.
  assert.equal((await rows('select 1 from notes where id = $1', [note.outreachMatched])).length, 0,
    'the legacy notes row cascades away with the prospect — untouched Stage 1 behaviour, and the reason the Journal is a separate table')
  assert.equal((await rows('select 1 from crm_interactions where id = $1', [legacy.interaction])).length, 1,
    'the interaction itself is history and survives; so does the link to it')
  assert.equal((await rows('select 1 from journal_entry_links where interaction_id = $1', [legacy.interaction])).length, 1)
})

test('a link cannot cross organizations, whatever the application forgets', async () => {
  // The guard refuses a second organization until the rollout cleanup has run.
  await finishRollout(pg, OTHER)
  await pg.query(`insert into organizations (id, name, slug) values ($1, 'Other AB', 'other')`, [OTHER])
  const [foreign] = await rows<{ id: string }>(`insert into companies (name, organization_id) values ('Other Co', $1) returning id`, [OTHER])

  const theirCapture = randomUUID()
  const theirEntry = randomUUID()
  await pg.query(`insert into captures (id, organization_id, source, original_text, request_key)
    values ($1, $2, 'typed', 'Their own entry.', 'other-1')`, [theirCapture, OTHER])
  await pg.query(`insert into journal_entries (id, organization_id, capture_id, origin, kind, body, occurred_precision, occurred_on)
    values ($1, $2, $3, 'person', 'update', 'Their own entry.', 'day', '2026-09-20')`, [theirEntry, OTHER, theirCapture])

  const foreignKey = /violates foreign key constraint/
  await assert.rejects(pg.query(
    `insert into journal_entry_links (organization_id, entry_id, target_type, company_id, target_label)
     values ($1, $2, 'company', $3, $4)`, [OTHER, theirEntry, legacy.company, COMPANY_NAME]), foreignKey)
  await assert.rejects(pg.query(
    `insert into journal_entry_links (organization_id, entry_id, target_type, company_id, target_label)
     values ($1, $2, 'company', $3, 'Other Co')`, [KHYTE, note.plain, foreign.id]), foreignKey)
  await assert.rejects(pg.query(
    `insert into journal_entry_links (organization_id, entry_id, target_type, interaction_id, target_label)
     values ($1, $2, 'interaction', $3, '2026-09-10 · email')`, [OTHER, theirEntry, legacy.interaction]), foreignKey)
  // And the entry itself cannot be borrowed: the composite key to
  // journal_entries answers for that one.
  await assert.rejects(pg.query(
    `insert into journal_entry_links (organization_id, entry_id, target_type, company_id, target_label)
     values ($1, $2, 'company', $3, 'Other Co')`, [OTHER, note.plain, foreign.id]), foreignKey)

  // A boundary, not a lock: their own link within their own organization works.
  await pg.query(`insert into journal_entry_links (organization_id, entry_id, target_type, company_id, target_label)
    values ($1, $2, 'company', $3, 'Other Co')`, [OTHER, theirEntry, foreign.id])
  assert.equal((await rows('select 1 from journal_entry_links where organization_id = $1', [OTHER])).length, 1)
  // Nor can a capture be claimed across the boundary.
  await assert.rejects(pg.query(
    `insert into journal_entries (organization_id, capture_id, origin, kind, body, occurred_precision, occurred_on)
     values ($1, $2, 'person', 'update', 'Borrowed', 'day', '2026-09-20')`, [KHYTE, theirCapture]), foreignKey)
})

test('the notes-drop follow-up picks up what the old build wrote last, then takes the table and the function with it', async () => {
  const held = {
    entries: await count('journal_entries'), captures: await count('captures'),
    revisions: await count('journal_entry_revisions'), links: await count('journal_entry_links'),
  }
  const last = { drawer: randomUUID(), nextStep: randomUUID() }
  // The rollout cleanup has run by now, so organization_id has no default and
  // must be named — which is the whole point of having dropped it.
  await pg.query(`insert into notes (id, organization_id, company_id, raw, created_at, updated_at)
    values ($1, $2, $3, 'One more before the cutover.', '2026-09-25T09:00:00Z', '2026-09-25T09:00:00Z')`, [last.drawer, KHYTE, legacy.company])
  await pg.query(`insert into notes (id, organization_id, raw, created_at, updated_at)
    values ($1, $2, 'Next step: Ring tillbaka', '2026-09-25T10:00:00Z', '2026-09-25T10:00:00Z')`, [last.nextStep, KHYTE])

  await dropNotes(pg)

  assert.equal(await count('journal_entries'), held.entries + 2, 'the last two notes arrived as entries rather than being dropped with the table')
  assert.equal(await count('captures'), held.captures + 2)
  assert.equal(await count('journal_entry_revisions'), held.revisions + 2, 'and with their revision 1, like every other entry')
  assert.equal(await count('journal_entry_links'), held.links + 1, 'the company link came with them')
  const drawer = await entry(last.drawer)
  assert.equal(drawer.body, 'One more before the cutover.')
  assert.equal(drawer.legacy_kind, 'drawer_note')
  assert.equal(drawer.origin, 'person')
  const nextStep = await entry(last.nextStep)
  assert.equal(nextStep.legacy_kind, 'next_step')
  assert.equal(nextStep.origin, 'system')
  const lateRevisions = await rows<{ entry_id: string; revision: number; body: string; changed_by: string | null; stamped_at_creation: boolean }>(
    `select v.entry_id, v.revision, v.body, v.changed_by, (v.changed_at = e.created_at) as stamped_at_creation
       from journal_entry_revisions v
       join journal_entries e on e.id = v.entry_id and e.organization_id = v.organization_id
      where v.entry_id = any($1) order by v.body`, [[last.drawer, last.nextStep]])
  assert.equal(lateRevisions.length, 2, 'the follow-up records revision 1 for the notes it catches up, not only the migration')
  for (const revision of lateRevisions) {
    assert.equal(revision.revision, 1)
    assert.equal(revision.changed_by, null)
    assert.equal(revision.stamped_at_creation, true)
  }
  assert.deepEqual(lateRevisions.map(v => v.body), ['Next step: Ring tillbaka', 'One more before the cutover.'])

  assert.equal((await rows<{ t: string | null }>("select to_regclass('public.notes') as t"))[0].t, null, 'public.notes is gone')
  assert.equal((await rows("select 1 from pg_proc where proname = 'journal_migrate_notes'")).length, 0,
    'the backfill has nothing left to read, so it goes with the table')
  assert.equal((await rows("select 1 from pg_proc where proname = 'journal_try_date'")).length, 0,
    'and its date parse goes after it')
  assert.equal((await rows<{ body: string }>('select body from journal_entries where id = $1', [note.long]))[0].body, LONG,
    'the long legacy note outlives the table it came from')
  // The Journal is untouched by the drop: no cascade reaches it, because
  // nothing in it ever referenced `notes`.
  assert.equal(await count('journal_entries'), held.entries + 2)
  assert.equal(await count('journal_entry_links'), held.links + 1)
  assert.equal((await rows<{ body: string }>('select body from journal_entries where id = $1', [note.outreachMatched]))[0].body, OUTREACH_MATCHED)
})
