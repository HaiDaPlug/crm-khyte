import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import type { Database, Queryable, Row } from '../lib/crm/database'
import { CONTEXT_MISMATCH, scopeMismatch } from '../lib/actions/scope'
import {
  addLink,
  countEntries,
  createEntry,
  deleteEntry,
  editEntry,
  getEntry,
  listEntries,
  listExportEntries,
  removeLink,
  writeEntry,
  type JournalActor,
} from '../lib/journal/service'
import type { LinkTarget } from '../lib/journal/contracts'
import { applyMigrations, finishRollout } from './support/migrations'

/**
 * The Journal write service, against a real Postgres.
 *
 * PGlite is Postgres compiled to WebAssembly, so the composite foreign keys,
 * the `on delete set null (<column>)` column lists, the check constraints, the
 * partial unique indexes and `at time zone` all behave exactly as they will in
 * production. That matters more here than anywhere else in this codebase: half
 * of what lib/journal/service.ts promises — a link that survives its record's
 * deletion, a request key that cannot produce two entries, a day computed in
 * the organization's timezone — is the schema keeping the promise, not the
 * TypeScript.
 *
 * Every test below drives the real service functions. Nothing is mocked, no
 * Server Action is called (those are a session check in front of these), and
 * the two organizations are created the same way tests/mcp.test.ts creates
 * them: apply every migration, assert the rollout guard, finish the rollout,
 * and only then can a second organization exist at all.
 *
 * No .env files, remote database, production credentials, or network access.
 */

const pg = new PGlite()
const wrap = (client: Pick<PGlite, 'query'>): Queryable => ({
  async query<T extends Row>(sql: string, values: unknown[] = []) {
    return (await client.query<T>(sql, values)).rows
  },
})
const db: Database = { ...wrap(pg), transaction: run => pg.transaction(tx => run(wrap(tx))) }

/** Fixed by 20260920120000_organizations.sql — the organization the existing
 *  data belongs to in every environment. */
const KHYTE = '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10'
const OTHER_ORG = randomUUID()

/** Who is writing. `source` is the capture's provenance — how the text reached
 *  Donna — and never the contact channel. */
let actorA: JournalActor
let actorB: JournalActor

type Fixture = { companyId: string; contactId: string; opportunityId: string; leadId: string; taskId: string; interactionId: string }
let khyte: Fixture
let other: Fixture

const NORDVIK = 'Nordvik AB'
const FJALLVIND = 'Fjällvind Group'

const rows = <T extends Row>(sql: string, values: unknown[] = []) => db.query<T>(sql, values)
const count = async (sql: string, values: unknown[] = []) =>
  Number((await rows<{ n: number }>(`select count(*)::int as n ${sql}`, values))[0].n)

/** An account plus the membership the author's display name is read from. */
async function person(organizationId: string, displayName: string): Promise<string> {
  const userId = randomUUID()
  const email = `${userId.slice(0, 8)}@example.test`
  await rows('insert into auth.users (id, email) values ($1, $2)', [userId, email])
  await rows(
    `insert into organization_members (organization_id, user_id, role, status, email, display_name)
     values ($1, $2, 'member', 'active', $3, $4)`,
    [organizationId, userId, email, displayName]
  )
  return userId
}

/** One of everything a Journal entry can be linked to. Inserted directly:
 *  the rollout cleanup has taken the organization_id defaults off by the time
 *  these run, so every row names its organization or the insert fails. */
async function fixture(organizationId: string, companyName: string): Promise<Fixture> {
  const companyId = randomUUID()
  const contactId = randomUUID()
  const opportunityId = randomUUID()
  const leadId = randomUUID()
  const taskId = randomUUID()
  const interactionId = randomUUID()
  await rows('insert into companies (id, organization_id, name) values ($1, $2, $3)', [companyId, organizationId, companyName])
  await rows('insert into contacts (id, organization_id, company_id, name) values ($1, $2, $3, $4)', [contactId, organizationId, companyId, 'Anna Lind'])
  await rows('insert into opportunities (id, organization_id, company_id, contact_id) values ($1, $2, $3, $4)', [opportunityId, organizationId, companyId, contactId])
  await rows('insert into leads (id, organization_id, company_name) values ($1, $2, $3)', [leadId, organizationId, `${companyName} (lead)`])
  await rows('insert into tasks (id, organization_id, title) values ($1, $2, $3)', [taskId, organizationId, 'Send the proposal'])
  await rows(
    `insert into crm_interactions (id, organization_id, opportunity_id, company_id, contact_id, occurred_on, channel, summary, connection_id)
     values ($1, $2, $3, $4, $5, '2026-09-10', 'email', 'Sent the deck', $6)`,
    [interactionId, organizationId, opportunityId, companyId, contactId, randomUUID()]
  )
  return { companyId, contactId, opportunityId, leadId, taskId, interactionId }
}

/** A fresh prospect inside an organization, for a test that needs a target
 *  nothing else has written about. */
async function prospect(organizationId: string, companyName: string): Promise<{ companyId: string; opportunityId: string }> {
  const companyId = randomUUID()
  const contactId = randomUUID()
  const opportunityId = randomUUID()
  await rows('insert into companies (id, organization_id, name) values ($1, $2, $3)', [companyId, organizationId, companyName])
  await rows('insert into contacts (id, organization_id, company_id, name) values ($1, $2, $3, $4)', [contactId, organizationId, companyId, 'Contact'])
  await rows('insert into opportunities (id, organization_id, company_id, contact_id) values ($1, $2, $3, $4)', [opportunityId, organizationId, companyId, contactId])
  return { companyId, opportunityId }
}

/** The one page shape every read returns, unwrapped or asserted loudly. */
async function page(actor: JournalActor, input: Record<string, unknown> = {}) {
  const result = await listEntries(db, { organizationId: actor.organizationId }, input)
  assert.ok(result.ok, `listEntries refused: ${result.ok ? '' : result.error}`)
  return result.page
}

/** A write that must have succeeded, with its entry. */
function written(result: Awaited<ReturnType<typeof createEntry>>) {
  assert.ok(result.ok, `write refused: ${result.ok ? '' : result.error}`)
  return result.entry
}

before(async () => {
  await pg.exec(`create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`)
  await applyMigrations(pg)
  // Asserts the rollout guard still refuses a second organization, then
  // applies the cleanup that retires it. Everything below therefore runs
  // against a database with no organization_id defaults left to hide a
  // forgotten stamp — the journal tables never had one at all.
  await finishRollout(pg, OTHER_ORG)
  await rows(`insert into organizations (id, name, slug) values ($1, 'Other AB', 'other')`, [OTHER_ORG])

  actorA = { organizationId: KHYTE, userId: await person(KHYTE, 'Erik'), source: 'typed' }
  actorB = { organizationId: OTHER_ORG, userId: await person(OTHER_ORG, 'Other Owner'), source: 'typed' }
  khyte = await fixture(KHYTE, NORDVIK)
  other = await fixture(OTHER_ORG, FJALLVIND)
})
after(async () => {
  await pg.close()
})

/* ———— writing ———— */

test('A01: a standalone entry is written with its capture, its first revision and nothing else', async () => {
  const requestKey = randomUUID()
  const entry = written(await createEntry(db, actorA, { requestKey, text: 'Called Nordvik, they want a demo.' }))

  assert.equal(entry.body, 'Called Nordvik, they want a demo.')
  assert.equal(entry.origin, 'person')
  assert.equal(entry.kind, 'update')
  assert.equal(entry.source, 'typed')
  assert.equal(entry.processingState, 'not_requested')
  assert.equal(entry.revision, 1)
  assert.equal(entry.title, null)
  assert.equal(entry.authorId, actorA.userId)
  assert.equal(entry.authorName, 'Erik')
  assert.equal(entry.links.length, 0)
  assert.equal(entry.deletedAt, null)

  // A typed capture starts as an instant, and its day is the organization's
  // day rather than the server's.
  assert.equal(entry.occurredPrecision, 'exact')
  assert.ok(entry.occurredAt, 'an exact entry must carry the instant')
  const stockholmToday = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date())
  assert.equal(entry.occurredOn, stockholmToday)

  // A08: the capture, the entry, its revision — and nothing anywhere else.
  assert.equal(await count('from captures where organization_id = $1 and request_key = $2', [KHYTE, requestKey]), 1)
  assert.equal(await count('from journal_entries where organization_id = $1 and capture_id = $2', [KHYTE, entry.captureId]), 1)
  assert.equal(await count('from journal_entry_revisions where organization_id = $1 and entry_id = $2', [KHYTE, entry.id]), 1)
  assert.equal(await count('from journal_entry_links where organization_id = $1 and entry_id = $2', [KHYTE, entry.id]), 0)
  assert.equal(await count('from notes where organization_id = $1', [KHYTE]), 0, 'the Journal writes nothing to the old notes table')
  assert.equal(await count('from crm_events where organization_id = $1', [KHYTE]), 0, 'a Journal entry is not an activity event')

  const [capture] = await rows<{ source: string; processing_state: string; original_text: string }>(
    'select source, processing_state, original_text from captures where id = $1 and organization_id = $2',
    [entry.captureId, KHYTE]
  )
  assert.equal(capture.source, 'typed')
  assert.equal(capture.processing_state, 'not_requested')
  // For a typed capture the body starts equal to the original text; no
  // cleanup happens in Stage 2.
  assert.equal(capture.original_text, entry.body)
})

test('A02: one entry with two links is one capture, and appears once under either target', async () => {
  const entry = written(
    await createEntry(db, actorA, {
      requestKey: randomUUID(),
      text: 'Met the CFO and the CEO.',
      kind: 'conversation',
      title: 'Nordvik meeting',
      performer: 'erik',
      links: [
        { type: 'opportunity', id: khyte.opportunityId },
        { type: 'company', id: khyte.companyId },
      ],
    })
  )

  assert.equal(entry.kind, 'conversation')
  assert.equal(entry.title, 'Nordvik meeting')
  assert.equal(entry.performer, 'erik')
  assert.equal(entry.links.length, 2)
  // A prospect is called by its COMPANY's name everywhere in this CRM, so both
  // links read the same way.
  for (const link of entry.links) assert.equal(link.targetLabel, NORDVIK)
  assert.equal(await count('from captures where organization_id = $1 and id = $2', [KHYTE, entry.captureId]), 1)

  const byOpportunity = await page(actorA, { targets: [{ type: 'opportunity', id: khyte.opportunityId }] })
  const byCompany = await page(actorA, { targets: [{ type: 'company', id: khyte.companyId }] })
  const byBoth = await page(actorA, {
    targets: [
      { type: 'opportunity', id: khyte.opportunityId },
      { type: 'company', id: khyte.companyId },
    ],
  })
  for (const [name, found] of [['opportunity', byOpportunity], ['company', byCompany], ['both', byBoth]] as const) {
    assert.equal(found.entries.filter(row => row.id === entry.id).length, 1, `${name} filter must return the entry exactly once`)
  }
  assert.equal(await countEntries(db, { organizationId: KHYTE }, [{ type: 'opportunity', id: khyte.opportunityId }]), 1)
})

test('every target type resolves to the label the CRM shows for that record', async () => {
  const entry = written(
    await createEntry(db, actorA, {
      requestKey: randomUUID(),
      text: 'One of everything.',
      links: [
        { type: 'company', id: khyte.companyId },
        { type: 'contact', id: khyte.contactId },
        { type: 'opportunity', id: khyte.opportunityId },
        { type: 'lead', id: khyte.leadId },
        { type: 'task', id: khyte.taskId },
        { type: 'interaction', id: khyte.interactionId },
      ],
    })
  )
  const labels = Object.fromEntries(entry.links.map(link => [link.targetType, link.targetLabel]))
  assert.deepEqual(labels, {
    company: NORDVIK,
    contact: 'Anna Lind',
    opportunity: NORDVIK,
    lead: `${NORDVIK} (lead)`,
    task: 'Send the proposal',
    // The same shape the notes backfill writes, so a migrated outreach line
    // and a new one read identically.
    interaction: '2026-09-10 · email',
  })
})

test('a retry with the same request key returns the same entry, marked replayed', async () => {
  const requestKey = randomUUID()
  const text = 'The line that was submitted twice.'
  const first = written(await createEntry(db, actorA, { requestKey, text }))

  const again = await createEntry(db, actorA, { requestKey, text })
  assert.ok(again.ok)
  assert.equal(again.replayed, true)
  assert.equal(again.entry.id, first.id)

  assert.equal(await count('from captures where organization_id = $1 and request_key = $2', [KHYTE, requestKey]), 1)
  assert.equal(await count('from journal_entries where organization_id = $1 and capture_id = $2', [KHYTE, first.captureId]), 1)
})

test('the same key with different text is a conflict, and reports the entry the key did produce', async () => {
  const requestKey = randomUUID()
  const first = written(await createEntry(db, actorA, { requestKey, text: 'What was actually saved.' }))

  const conflict = await createEntry(db, actorA, { requestKey, text: 'What the composer holds now.' })
  assert.equal(conflict.ok, false)
  assert.ok(!conflict.ok)
  assert.equal(conflict.error, 'request_key_conflict')
  // The composer needs this to say "this was already saved" with a link,
  // rather than leaving the writer to guess what happened to their text.
  assert.equal(conflict.existing?.id, first.id)
  assert.equal(conflict.existing?.body, 'What was actually saved.')
  assert.equal(await count('from journal_entries where organization_id = $1 and capture_id = $2', [KHYTE, first.captureId]), 1)
})

test('a transaction that fails after the capture insert leaves no rows behind', async () => {
  const requestKey = randomUUID()
  const capturesBefore = await count('from captures where organization_id = $1', [KHYTE])

  // The second statement inside the transaction is the one that throws. The
  // first is the capture insert, so by then a row exists and the rollback is
  // what has to remove it — PGlite, like postgres.js, rolls a transaction back
  // when its callback rejects, and the counts below are what says so.
  const failing: Database = {
    query: (sql, values) => db.query(sql, values),
    async transaction(run) {
      return pg.transaction(async tx => {
        let calls = 0
        return run({
          async query<T extends Row>(sql: string, values: unknown[] = []) {
            calls += 1
            if (calls === 2) throw new Error('connection lost mid-write')
            return (await tx.query<T>(sql, values)).rows
          },
        })
      })
    },
  }

  await assert.rejects(
    createEntry(failing, actorA, { requestKey, text: 'This must not survive.' }),
    /connection lost mid-write/
  )
  assert.equal(await count('from captures where organization_id = $1 and request_key = $2', [KHYTE, requestKey]), 0)
  assert.equal(await count('from captures where organization_id = $1', [KHYTE]), capturesBefore)
  assert.equal(await count('from journal_entries where organization_id = $1 and body = $2', [KHYTE, 'This must not survive.']), 0)
})

test('a link target in another organization fails the whole write and acknowledges nothing', async () => {
  const requestKey = randomUUID()
  const refused = await createEntry(db, actorA, {
    requestKey,
    text: 'About a prospect that is not ours.',
    links: [{ type: 'opportunity', id: other.opportunityId }],
  })
  assert.ok(!refused.ok)
  assert.equal(refused.error, 'target_not_found')

  // Nothing acknowledged: not the entry, and not the capture whose insert
  // claimed the key. A capture with no entry would be a key the next retry
  // could not explain.
  assert.equal(await count('from captures where organization_id = $1 and request_key = $2', [KHYTE, requestKey]), 0)
  assert.equal(await count('from journal_entries where organization_id = $1 and body = $2', [KHYTE, 'About a prospect that is not ours.']), 0)

  // The key is therefore still free.
  const retried = written(await createEntry(db, actorA, { requestKey, text: 'About a prospect that is not ours.' }))
  assert.equal(retried.links.length, 0)
})

test('20,001 characters is refused as invalid; 20,000 is written', async () => {
  const tooLong = await createEntry(db, actorA, { requestKey: randomUUID(), text: 'a'.repeat(20001) })
  assert.ok(!tooLong.ok)
  assert.equal(tooLong.error, 'invalid')

  const atTheLimit = written(await createEntry(db, actorA, { requestKey: randomUUID(), text: 'b'.repeat(20000) }))
  assert.equal(atTheLimit.body.length, 20000)
})

/* ———— the organization's clock ———— */

test('22:30Z on a Monday is Tuesday in Stockholm, and the organization decides which', async () => {
  const [organization] = await rows<{ timezone: string }>('select timezone from organizations where id = $1', [KHYTE])
  assert.equal(organization.timezone, 'Europe/Stockholm', 'the migration gives every organization this default')

  const lateEvening = written(
    await createEntry(db, actorA, {
      requestKey: randomUUID(),
      text: 'Sent the summary just before midnight.',
      occurredAt: '2026-09-21T22:30:00Z',
    })
  )
  assert.equal(lateEvening.occurredPrecision, 'exact')
  assert.equal(lateEvening.occurredOn, '2026-09-22')

  // The same instant, a different organization, a different day — which is
  // what "the organization's timezone, not the server's" has to mean once
  // there are two of them.
  await rows(`update organizations set timezone = 'America/New_York' where id = $1`, [OTHER_ORG])
  try {
    const theirs = written(
      await createEntry(db, actorB, {
        requestKey: randomUUID(),
        text: 'The same moment, six hours earlier.',
        occurredAt: '2026-09-21T22:30:00Z',
      })
    )
    assert.equal(theirs.occurredOn, '2026-09-21')
  } finally {
    await rows(`update organizations set timezone = 'Europe/Stockholm' where id = $1`, [OTHER_ORG])
  }
})

test('a day the writer picked is a day, and carries no instant', async () => {
  const entry = written(
    await createEntry(db, actorA, { requestKey: randomUUID(), text: 'It happened last Thursday.', occurredOn: '2026-09-17' })
  )
  assert.equal(entry.occurredPrecision, 'day')
  assert.equal(entry.occurredOn, '2026-09-17')
  assert.equal(entry.occurredAt, null)
})

test('a caller that names its precision is obeyed, and an incoherent one is refused', async () => {
  // What log_outreach sends: the precision stated outright, with the date out
  // of the outreach line. An outreach line knows the day and nothing finer, so
  // the entry must not acquire an instant it never had.
  const stated = written(
    await createEntry(db, actorA, {
      requestKey: randomUUID(),
      text: 'Sent the deck.',
      occurredPrecision: 'day',
      occurredOn: '2026-09-10',
    })
  )
  assert.equal(stated.occurredPrecision, 'day')
  assert.equal(stated.occurredOn, '2026-09-10')
  assert.equal(stated.occurredAt, null)

  // `day` with no day is the one thing the table's check constraint cannot be
  // asked to sort out, so it is refused before anything is written.
  const dayWithoutDay = await createEntry(db, actorA, {
    requestKey: randomUUID(),
    text: 'Which day?',
    occurredPrecision: 'day',
  })
  assert.ok(!dayWithoutDay.ok)
  assert.equal(dayWithoutDay.error, 'invalid')

  // And `exact` with a day attached claims two different things: the day is
  // derived from the instant, so a supplied one could only disagree with it.
  const exactWithADay = await createEntry(db, actorA, {
    requestKey: randomUUID(),
    text: 'Both at once.',
    occurredPrecision: 'exact',
    occurredOn: '2026-09-10',
  })
  assert.ok(!exactWithADay.ok)
  assert.equal(exactWithADay.error, 'invalid')
})

/* ———— editing ———— */

test('an edit writes revision 2 and keeps the wording it replaced', async () => {
  const entry = written(await createEntry(db, actorA, { requestKey: randomUUID(), text: 'First wording.' }))

  const edited = await editEntry(db, actorA, entry.id, { body: 'Second wording.', title: 'Nordvik', expectedRevision: 1 })
  assert.ok(edited.ok)
  assert.equal(edited.entry.revision, 2)
  assert.equal(edited.entry.body, 'Second wording.')
  assert.equal(edited.entry.title, 'Nordvik')

  const detail = await getEntry(db, { organizationId: KHYTE }, entry.id)
  assert.ok(detail.ok)
  // The capture is immutable: what arrived is still exactly what arrived.
  assert.equal(detail.entry.originalText, 'First wording.')
  assert.equal(detail.entry.revisions.length, 2)
  assert.deepEqual(detail.entry.revisions.map(revision => revision.revision), [1, 2])
  assert.equal(detail.entry.revisions[0].body, 'First wording.')
  assert.equal(detail.entry.revisions[1].body, 'Second wording.')
  assert.equal(detail.entry.revisions[1].changedBy, actorA.userId)
})

test('a stale expectedRevision is a conflict, not a silent overwrite', async () => {
  const entry = written(await createEntry(db, actorA, { requestKey: randomUUID(), text: 'Contended.' }))
  const first = await editEntry(db, actorA, entry.id, { body: 'Mine.', expectedRevision: 1 })
  assert.ok(first.ok)

  const stale = await editEntry(db, actorA, entry.id, { body: 'Theirs.', expectedRevision: 1 })
  assert.ok(!stale.ok)
  assert.equal(stale.error, 'revision_conflict')

  const detail = await getEntry(db, { organizationId: KHYTE }, entry.id)
  assert.ok(detail.ok)
  assert.equal(detail.entry.body, 'Mine.', 'the first edit must still stand')
  assert.equal(detail.entry.revisions.length, 2, 'a refused edit appends no revision')
})

test('an edit of a deleted entry reports deleted, and of a foreign id reports not_found', async () => {
  const entry = written(await createEntry(db, actorA, { requestKey: randomUUID(), text: 'About to go.' }))
  assert.ok((await deleteEntry(db, actorA, entry.id)).ok)

  const afterDelete = await editEntry(db, actorA, entry.id, { body: 'Too late.', expectedRevision: 1 })
  assert.ok(!afterDelete.ok)
  assert.equal(afterDelete.error, 'deleted')

  const nowhere = await editEntry(db, actorA, randomUUID(), { body: 'Nobody.', expectedRevision: 1 })
  assert.ok(!nowhere.ok)
  assert.equal(nowhere.error, 'not_found')
})

/* ———— links ———— */

test('links are added and removed on an existing entry, and a foreign target is refused', async () => {
  const target = await prospect(KHYTE, 'Linkable AB')
  const entry = written(await createEntry(db, actorA, { requestKey: randomUUID(), text: 'Linked later.' }))

  const linked = await addLink(db, actorA, entry.id, { type: 'opportunity', id: target.opportunityId })
  assert.ok(linked.ok)
  assert.equal(linked.entry.links.length, 1)
  assert.equal(linked.entry.links[0].targetLabel, 'Linkable AB')

  // Adding the same link twice is not an error — the partial unique index
  // already says one link per entry per record.
  const again = await addLink(db, actorA, entry.id, { type: 'opportunity', id: target.opportunityId })
  assert.ok(again.ok)
  assert.equal(again.entry.links.length, 1)

  const foreign = await addLink(db, actorA, entry.id, { type: 'opportunity', id: other.opportunityId })
  assert.ok(!foreign.ok)
  assert.equal(foreign.error, 'target_not_found')

  const unlinked = await removeLink(db, actorA, entry.id, linked.entry.links[0].id)
  assert.ok(unlinked.ok)
  assert.equal(unlinked.entry.links.length, 0)

  const gone = await removeLink(db, actorA, entry.id, linked.entry.links[0].id)
  assert.ok(!gone.ok)
  assert.equal(gone.error, 'not_found')
})

test('A20: deleting a prospect nulls the link target, keeps the label and keeps the entry', async () => {
  const doomed = await prospect(KHYTE, 'Doomed AB')
  const entry = written(
    await createEntry(db, actorA, {
      requestKey: randomUUID(),
      text: 'Everything we learned about Doomed AB.',
      links: [{ type: 'opportunity', id: doomed.opportunityId }],
    })
  )

  // The old notes table's link keys cascade, so this same deletion still takes
  // its notes with it — which is the behaviour the Journal exists to correct.
  await rows('delete from opportunities where id = $1 and organization_id = $2', [doomed.opportunityId, KHYTE])

  const detail = await getEntry(db, { organizationId: KHYTE }, entry.id)
  assert.ok(detail.ok, 'the entry must survive its prospect')
  assert.equal(detail.entry.body, 'Everything we learned about Doomed AB.')
  assert.equal(detail.entry.links.length, 1)
  assert.equal(detail.entry.links[0].targetId, null, 'the target column is nulled')
  assert.equal(detail.entry.links[0].targetType, 'opportunity', 'what kind of thing it was is kept')
  assert.equal(detail.entry.links[0].targetLabel, 'Doomed AB', 'and what it was called is kept')

  // The column list on the foreign key is what makes this a tombstone rather
  // than a row moved out of its workspace.
  const [link] = await rows<{ organization_id: string }>(
    'select organization_id from journal_entry_links where entry_id = $1 and organization_id = $2', [entry.id, KHYTE]
  )
  assert.equal(link.organization_id, KHYTE)
})

/* ———— deletion ———— */

test('deleting an entry redacts every copy of its text and leaves its metadata standing', async () => {
  const canary = `redaction-canary-${randomUUID()}`
  const entry = written(
    await createEntry(db, actorA, {
      requestKey: randomUUID(),
      text: canary,
      title: canary,
      links: [{ type: 'company', id: khyte.companyId }],
    })
  )
  // An edit first, so there are two revisions to redact rather than one.
  assert.ok((await editEntry(db, actorA, entry.id, { body: `${canary} — revised`, expectedRevision: 1 })).ok)
  // A migrated row's unverified extraction is content too, and it is the field
  // a reader would not think of.
  await rows(`update journal_entries set legacy_extraction = '{"company":"Nordvik"}'::jsonb where id = $1 and organization_id = $2`, [entry.id, KHYTE])

  const deleted = await deleteEntry(db, actorA, entry.id)
  assert.ok(deleted.ok)
  assert.equal(deleted.entry.body, '')
  assert.equal(deleted.entry.title, null)
  assert.ok(deleted.entry.deletedAt, 'the stamp that says something was removed stays')

  const [row] = await rows<{ legacy_extraction: unknown; deleted_by: string; revision: number }>(
    'select legacy_extraction, deleted_by, revision from journal_entries where id = $1 and organization_id = $2', [entry.id, KHYTE]
  )
  assert.equal(row.legacy_extraction, null)
  assert.equal(row.deleted_by, actorA.userId)
  assert.equal(Number(row.revision), 2, 'the revision number is metadata and is kept')

  // The text is in no table: not the entry, not the capture, not a revision.
  const like = `%${canary}%`
  assert.equal(await count('from journal_entries where organization_id = $1 and (body like $2 or coalesce(title, $3) like $2)', [KHYTE, like, '']), 0)
  assert.equal(await count('from captures where organization_id = $1 and original_text like $2', [KHYTE, like]), 0)
  assert.equal(await count('from journal_entry_revisions where organization_id = $1 and (body like $2 or coalesce(title, $3) like $2)', [KHYTE, like, '']), 0)

  // The links are record names, not Journal content, and are deliberately left
  // alone — clearing them would blank the tombstone on a company that is
  // still there.
  assert.equal(deleted.entry.links.length, 1)
  assert.equal(deleted.entry.links[0].targetLabel, NORDVIK)

  // Out of the feed unless it is asked for.
  const visible = await page(actorA, { limit: 100 })
  assert.equal(visible.entries.some(found => found.id === entry.id), false)
  const withDeleted = await page(actorA, { limit: 100, includeDeleted: true })
  assert.equal(withDeleted.entries.some(found => found.id === entry.id), true)
})

test('deleting twice is the same state and the same answer; a foreign id is not_found', async () => {
  const entry = written(await createEntry(db, actorA, { requestKey: randomUUID(), text: 'Deleted twice.' }))
  const first = await deleteEntry(db, actorA, entry.id)
  assert.ok(first.ok)
  const second = await deleteEntry(db, actorA, entry.id)
  assert.ok(second.ok)
  assert.equal(second.entry.deletedAt, first.entry.deletedAt, 'the first deletion is when it happened')

  const nowhere = await deleteEntry(db, actorA, randomUUID())
  assert.ok(!nowhere.ok)
  assert.equal(nowhere.error, 'not_found')
})

/* ———— reading ———— */

test('A23: a three-page cursor walk is stable under an insert between pages', async () => {
  const target = await prospect(KHYTE, 'Paged AB')
  const targets: LinkTarget[] = [{ type: 'opportunity', id: target.opportunityId }]
  const written7: string[] = []
  for (let i = 1; i <= 7; i += 1) {
    const entry = written(
      await createEntry(db, actorA, { requestKey: randomUUID(), text: `Page walk ${i}`, links: targets })
    )
    written7.push(entry.id)
  }

  const first = await page(actorA, { limit: 3, targets })
  assert.equal(first.entries.length, 3)
  assert.equal(first.coverage.returned, 3)
  assert.equal(first.coverage.hasMore, true)
  assert.ok(first.nextCursor)
  assert.equal(first.coverage.oldestCreatedAt, first.entries[2].createdAt)
  assert.ok(Date.parse(first.coverage.loadedAt) > 0)

  // Written between page one and page two. It is NEWER than every cursor in
  // play, so it belongs above the window and must not push a row the reader
  // has already passed onto a page they will never ask for again.
  const interloper = written(
    await createEntry(db, actorA, { requestKey: randomUUID(), text: 'Written mid-walk', links: targets })
  )

  const second = await page(actorA, { limit: 3, targets, cursor: first.nextCursor })
  assert.equal(second.entries.length, 3)
  assert.equal(second.coverage.hasMore, true)
  const third = await page(actorA, { limit: 3, targets, cursor: second.nextCursor })
  assert.equal(third.entries.length, 1)
  assert.equal(third.coverage.hasMore, false)
  assert.equal(third.nextCursor, null)

  const walked = [...first.entries, ...second.entries, ...third.entries].map(entry => entry.id)
  assert.equal(new Set(walked).size, 7, 'no entry is seen twice')
  assert.equal(walked.includes(interloper.id), false, 'the mid-walk entry stays above the window')
  assert.deepEqual([...walked].sort(), [...written7].sort(), 'every entry written before the walk is seen exactly once')

  // Newest first, and the interloper is at the top of a fresh read.
  const fresh = await page(actorA, { limit: 3, targets })
  assert.equal(fresh.entries[0].id, interloper.id)
  assert.equal(await countEntries(db, { organizationId: KHYTE }, targets), 8)
})

test('an unreadable cursor is refused rather than silently ignored', async () => {
  const bad = await listEntries(db, { organizationId: KHYTE }, { cursor: 'not-a-cursor' })
  assert.ok(!bad.ok)
  assert.equal(bad.error, 'invalid')
})

test('the origins filter separates what a person wrote from what Donna wrote', async () => {
  const target = await prospect(KHYTE, 'Origins AB')
  const targets: LinkTarget[] = [{ type: 'opportunity', id: target.opportunityId }]
  const mine = written(await createEntry(db, actorA, { requestKey: randomUUID(), text: 'I wrote this.', links: targets }))
  const hers = written(
    await createEntry(db, actorA, { requestKey: randomUUID(), text: 'Next step: send the quote', links: targets }, { origin: 'system' })
  )
  assert.equal(hers.origin, 'system')

  const people = await page(actorA, { targets, origins: ['person'] })
  assert.deepEqual(people.entries.map(entry => entry.id), [mine.id])
  const both = await page(actorA, { targets })
  assert.equal(both.entries.length, 2)
})

test('a dismissed legacy entry stays out of the feed, exactly as a dismissed note did', async () => {
  const target = await prospect(KHYTE, 'Dismissed AB')
  const targets: LinkTarget[] = [{ type: 'opportunity', id: target.opportunityId }]
  const entry = written(await createEntry(db, actorA, { requestKey: randomUUID(), text: 'A suggestion nobody wanted.', links: targets }))
  await rows('update journal_entries set legacy_dismissed = true where id = $1 and organization_id = $2', [entry.id, KHYTE])

  const visible = await page(actorA, { targets })
  assert.equal(visible.entries.length, 0)
  assert.equal(await countEntries(db, { organizationId: KHYTE }, targets), 0)
})

test('an account that disappears leaves its text standing and its author unknown', async () => {
  const userId = await person(KHYTE, 'Departing Colleague')
  const actor: JournalActor = { organizationId: KHYTE, userId, source: 'typed' }
  const entry = written(await createEntry(db, actor, { requestKey: randomUUID(), text: 'Written by someone who left.' }))
  assert.equal(entry.authorName, 'Departing Colleague')

  await rows('delete from auth.users where id = $1', [userId])

  const detail = await getEntry(db, { organizationId: KHYTE }, entry.id)
  assert.ok(detail.ok)
  assert.equal(detail.entry.body, 'Written by someone who left.', 'the text stays')
  assert.equal(detail.entry.authorId, null, 'the author becomes unknown')
  assert.equal(detail.entry.authorName, null)
  const [capture] = await rows<{ author_id: string | null }>(
    'select author_id from captures where id = $1 and organization_id = $2', [entry.captureId, KHYTE]
  )
  assert.equal(capture.author_id, null)
})

/* ———— the export read ———— */

test('the export counts person-written entries only, through either the prospect or its company', async () => {
  const target = await prospect(KHYTE, 'Exported AB')
  const mine = written(
    await createEntry(db, actorA, {
      requestKey: randomUUID(),
      text: 'They asked for a proposal.',
      links: [{ type: 'opportunity', id: target.opportunityId }],
    })
  )
  // Linked to the company alone — it still belongs to the prospect's history,
  // which is what notesFor did with companyId before.
  const viaCompany = written(
    await createEntry(db, actorA, {
      requestKey: randomUUID(),
      text: 'Something about the whole company.',
      links: [{ type: 'company', id: target.companyId }],
    })
  )
  // Both links at once: one entry, counted once.
  const both = written(
    await createEntry(db, actorA, {
      requestKey: randomUUID(),
      text: 'Linked to both.',
      links: [
        { type: 'opportunity', id: target.opportunityId },
        { type: 'company', id: target.companyId },
      ],
    })
  )
  // Donna's own line: not a note anybody wrote (decision 13).
  written(
    await createEntry(
      db,
      actorA,
      { requestKey: randomUUID(), text: 'Next step: send the quote', links: [{ type: 'opportunity', id: target.opportunityId }] },
      { origin: 'system' }
    )
  )
  const removed = written(
    await createEntry(db, actorA, {
      requestKey: randomUUID(),
      text: 'Deleted before the export.',
      links: [{ type: 'opportunity', id: target.opportunityId }],
    })
  )
  assert.ok((await deleteEntry(db, actorA, removed.id)).ok)

  const grouped = await listExportEntries(db, { organizationId: KHYTE }, [target.opportunityId])
  const ids = (grouped[target.opportunityId] ?? []).map(entry => entry.id)
  assert.deepEqual([...ids].sort(), [mine.id, viaCompany.id, both.id].sort())
  assert.equal(ids.length, 3, 'an entry linked to both the prospect and its company is counted once')

  const entry = grouped[target.opportunityId].find(found => found.id === mine.id)
  assert.equal(entry?.body, 'They asked for a proposal.')
  assert.ok(entry?.createdAt && Date.parse(entry.createdAt) > 0)
  assert.ok(entry?.occurredOn)

  assert.deepEqual(await listExportEntries(db, { organizationId: KHYTE }, []), {})
  assert.deepEqual(await listExportEntries(db, { organizationId: OTHER_ORG }, [target.opportunityId]), {},
    'another organization sees none of it')
})

/* ———— two organizations ———— */

test('a second organization can neither read nor write the first one\'s Journal', async () => {
  const requestKey = randomUUID()
  const mine = written(
    await createEntry(db, actorA, {
      requestKey,
      text: 'Khyte only.',
      links: [{ type: 'opportunity', id: khyte.opportunityId }],
    })
  )

  // Read: not in their feed, not by id, not through a target id they were
  // handed. An id from another organization looks exactly like an id from
  // nowhere.
  const theirFeed = await page(actorB, { limit: 100 })
  assert.equal(theirFeed.entries.some(entry => entry.id === mine.id), false)
  const byTarget = await page(actorB, { targets: [{ type: 'opportunity', id: khyte.opportunityId }] })
  assert.equal(byTarget.entries.length, 0)
  const read = await getEntry(db, { organizationId: OTHER_ORG }, mine.id)
  assert.ok(!read.ok)
  assert.equal(read.error, 'not_found')
  assert.equal(await countEntries(db, { organizationId: OTHER_ORG }, [{ type: 'opportunity', id: khyte.opportunityId }]), 0)

  // Write: edit, delete and link all refuse, and nothing changes.
  const edited = await editEntry(db, actorB, mine.id, { body: 'Ours now.', expectedRevision: 1 })
  assert.ok(!edited.ok)
  assert.equal(edited.error, 'not_found')
  const linked = await addLink(db, actorB, mine.id, { type: 'opportunity', id: other.opportunityId })
  assert.ok(!linked.ok)
  assert.equal(linked.error, 'not_found')
  const unlinked = await removeLink(db, actorB, mine.id, mine.links[0].id)
  assert.ok(!unlinked.ok)
  assert.equal(unlinked.error, 'not_found')
  const deleted = await deleteEntry(db, actorB, mine.id)
  assert.ok(!deleted.ok)
  assert.equal(deleted.error, 'not_found')

  const after = await getEntry(db, { organizationId: KHYTE }, mine.id)
  assert.ok(after.ok)
  assert.equal(after.entry.body, 'Khyte only.')
  assert.equal(after.entry.deletedAt, null)
  assert.equal(after.entry.revision, 1)
  assert.equal(after.entry.links.length, 1)

  // The request key is unique per organization, so reusing it writes their own
  // entry rather than returning this one.
  const theirs = written(await createEntry(db, actorB, { requestKey, text: 'Their own text, same key.' }))
  assert.notEqual(theirs.id, mine.id)
  assert.equal(theirs.organizationId, OTHER_ORG)
  assert.equal(await count('from captures where request_key = $1', [requestKey]), 2)
})

/* ———— the scope check the actions run first ———— */

test('scopeMismatch refuses every disagreement and passes only an exact match', () => {
  const context = { organizationId: KHYTE, userId: 'f1a4e6c2-1111-4111-8111-111111111111' }
  const elsewhere = { organizationId: randomUUID(), userId: randomUUID() }

  assert.equal(scopeMismatch(context, { organizationId: context.organizationId, userId: context.userId }), null)

  for (const [name, scope] of [
    ['another organization', { organizationId: elsewhere.organizationId, userId: context.userId }],
    ['another person', { organizationId: context.organizationId, userId: elsewhere.userId }],
    ['both', elsewhere],
  ] as const) {
    const refusal = scopeMismatch(context, scope)
    assert.deepEqual(refusal, { ok: false, error: CONTEXT_MISMATCH }, `${name} must be refused`)
  }
  assert.equal(CONTEXT_MISMATCH, 'context_mismatch', 'the client store matches on this string')
})

/* ———— the inner write, inside somebody else\'s transaction ———— */

test('writeEntry enlists in a caller transaction, and a caller rollback takes the entry with it', async () => {
  const requestKey = randomUUID()
  await assert.rejects(
    db.transaction(async tx => {
      const result = await writeEntry(tx, actorA, { requestKey, text: 'Written inside a bigger write.' })
      assert.ok(result.ok)
      // What the MCP path does when anything after the Journal write fails:
      // no interaction, no prospect change, no entry.
      throw new Error('the surrounding action failed')
    }),
    /the surrounding action failed/
  )
  assert.equal(await count('from captures where organization_id = $1 and request_key = $2', [KHYTE, requestKey]), 0)
  assert.equal(await count('from journal_entries where organization_id = $1 and body = $2', [KHYTE, 'Written inside a bigger write.']), 0)
})
