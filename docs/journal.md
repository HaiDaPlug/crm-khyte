# Journal and durable text capture — Donna Stage 2

**Date:** 2026-09-22
**Branch:** `feat/journal` (from `5b54cce`, Stage 1 merged with master; PR #31 carries Stage 1 to master)
**Blueprint:** [Donna-Product-Architecture-and-Fable-Handoff-v1.md](Donna-Product-Architecture-and-Fable-Handoff-v1.md), Section 13, Stage 2
**Previous stage:** [organization-foundation.md](organization-foundation.md) and [donna-handoff-after-stage-1.md](donna-handoff-after-stage-1.md)

This is the review handoff for the second stage of the Donna redesign: a
Journal that is a useful daily home for thoughts before any AI acts on them.
Text is captured durably, kept with its author and its date, linked to the
business records it concerns, revised with history, and read in pages. Nothing
here interprets anything; the processing state exists so that Stage 3 has a
column to write, and it says `not_requested` on every row this stage creates.

Decisions taken with Hai on 2026-09-22 before implementation:

| # | Question | Decision |
| --- | --- | --- |
| 1 | Branch | Stage 1 merged to master first (PR #31); Stage 2 on `feat/journal` from the merged tip |
| 2 | Old notes | New tables with the same ids; `notes` left standing, read by nothing, dropped by a later follow-up |
| 3 | Deleting a prospect (A20) | Unlink and keep: the link becomes a tombstone with the prospect's name; the entry survives |
| 4 | The MCP `log_outreach` timeline note | Becomes a Journal entry written through the shared service: origin system, linked to the prospect and the interaction, author = the connection's account, performer = the named colleague |
| 5 | Deleting an entry | Redact the content, keep the non-content metadata and a `deleted_at` stamp |
| 6 | An author's account disappears | The text stays; the author becomes unknown (`on delete set null`) |
| 7 | Which clock decides a Journal day | The organization's timezone, from this stage on: migration, composer default, display |
| 8 | Linking migrated outreach lines to their interaction | Match the structured fields in SQL; link only a unique match; report matched and unmatched counts |
| 9 | Dashboard | The scripted chat panel is removed; the composer and recent entries take its place. Hai's later idea, not this stage: a chat bubble in a bottom corner |
| 10 | Microphone button | Removed. Voice is Stage 4 and goes through the server |
| 11 | Unsent drafts | Kept in browser storage keyed by organization and viewer, with the request key; cleared on identity change and sign-out |
| 12 | No database configured | The composer refuses with an honest message and keeps the draft |
| 13 | Export note fields | Count only entries a person wrote; `docs/export-schema.md` says so |
| 14 | Deploy | Stage 1 deploys first |
| 15 | Jobs | `processing_state` column only. The job runner from blueprint Section 14 is deliberately deferred to Stage 3 (below) |
| 16 | Copy | "Journal" everywhere in both languages |
| 17 | Mobile bottom bar | `/journal` takes pipeline's slot: dashboard · journal · prospects · tasks; pipeline stays under More |
| 18 | Manual review environment | The local Supabase stack through Docker, seeded with one organization; no staging project |

---

## What changed, in one paragraph

Every thought typed into the CRM is now a capture that is saved before it is
acknowledged, and a Journal entry that carries who said it, when it happened,
which records it concerns and every wording it has had. Entries stand alone or
link to several records through typed links that survive the record's
deletion as tombstones. The prospect drawer's notes timeline, the dashboard's
scripted chat and the MCP tool's synthetic timeline line are all replaced by
the same write service and the same paginated read path; the Journal is never
shipped whole in the snapshot. Old notes were migrated into the new tables
with their ids, text and dates, their authors honestly unknown.

---

## Data model

```
captures                 id, organization_id, author_id → auth.users (set null),
                         source (typed|mcp|legacy), original_text (≤ 20 000 chars),
                         received_at, request_key (unique per organization),
                         processing_state (not_requested|queued|interpreting|ready|
                         needs_clarification|failed), deleted_at
journal_entries          id (= the note id for migrated rows), organization_id,
                         capture_id → captures (composite, cascade),
                         author_id → auth.users (set null), performer (crm_colleague),
                         origin (person|system), kind (conversation|observation|idea|
                         decision|update), title, body,
                         occurred_precision (exact|day|month|unknown), occurred_on, occurred_at,
                         revision, legacy_kind (drawer_note|next_step|outreach),
                         legacy_extraction, legacy_dismissed, legacy_applied,
                         deleted_at, deleted_by
journal_entry_revisions  entry_id (composite, cascade), revision, the entry's title/body/
                         kind/dates/performer AT that revision, changed_by, changed_at
journal_entry_links      entry_id (composite, cascade), target_type, one typed target
                         column per kind (company_id, contact_id, opportunity_id, lead_id,
                         task_id, interaction_id) each a composite same-organization key
                         with `on delete set null (<column>)`, target_label (kept as the
                         tombstone), relationship (about|mentions|evidence_for),
                         evidence_revision/start/end (null in this stage), created_by
```

Every table has `organization_id uuid not null references organizations (id)`
with no default, a `(id, organization_id)` key where it is a parent, RLS
enabled with the `members manage their organization's <table>` policy through
`public.is_org_member`, and `set_updated_at` where it has `updated_at`.
`leads`, `tasks` and `crm_interactions` gained the `(id, organization_id)` key
they lacked so links can reference them.

**Two kinds of time.** `created_at` is when the entry was written; the
`occurred_*` triple is when the thing it describes happened. `exact` carries an
instant; `day` and `month` carry a calendar date resolved in the organization's
timezone and no instant; `unknown` carries neither. This stage writes `exact`
(the composer's default: now) and `day` (a date the person picked; every
migrated outreach line). `month` and `unknown` exist so Stage 3 can record
"last spring" without a migration. This is the encoding of the blueprint's
"occurred_at/date precision" and "unknown historical dates remain unknown".

**Two kinds of person.** `author_id` is the authenticated account that wrote
the entry. `performer` is the roster label of whoever did the thing described,
when it differs, as it does for an outreach the MCP tool logs on a colleague's
behalf. Canon 7 asks for exactly this split; `crm_events.recorded_by` versus
`colleague` is the Stage 1 precedent.

**Revisions.** The capture's `original_text` is immutable. Edits happen on the
entry, bump `revision`, and write a snapshot row, so the history is complete
from revision 1 (which the migration also writes for migrated entries).
Stage 3 will interpret a named entry revision whose body stays resolvable
forever. The blueprint says "capture revision"; this is where those revisions
live. Recorded as a deviation in wording, not in substance.

**Links.** Typed columns rather than a `{type, id}` pair, because a single
polymorphic column cannot carry composite same-organization keys to six
parents, and blueprint Section 4 rejects untyped pairs. A row with every target
column null and a `target_label` is a tombstone: the record was deleted, the
entry remembers what it was about. `relationship` and the evidence span
columns exist now so A19 and Stage 5 have them on every row from the first
one; this stage writes `about` and null spans.

**Deletion policy (blueprint Section 14, settled here).** Deleting an entry
blanks `body`, `title`, `legacy_extraction`, the capture's `original_text` and
every revision's `title`/`body`, and stamps `deleted_at`/`deleted_by`. It keeps
the ids, the organization, the author, the timestamps, the kind and the links,
so Stage 5 can propagate the deletion and the fact of the entry is auditable.
It does not reach: the links' `target_label` (a record's name, not Journal
content); the legacy `notes` table until its follow-up drops it; and
`crm_tool_receipts`. A receipt holds the parameters of the operation it
records, and for `log_outreach` that includes the summary the caller sent,
which is both the interaction's `summary` and the body of the system entry
the tool wrote — the same string Stage 1 already receipted. What a receipt
never holds after this stage is the Journal page: the in-transaction prospect
read it embeds omits `journal`, so no other person's entries and no later
edits are frozen into it. Deleting an entry therefore blanks the Journal and
the capture but deliberately leaves the operation's own parameters in the
receipt, which is the audit record of what the tool was asked to do.

**Deferred: the job runner.** Blueprint Section 14 leaves "durable
Postgres-backed jobs/outbox with worker leases; select deployment-compatible
runner" to Stage 2–3. This stage commits to `processing_state` and nothing
else: no jobs table, no outbox row, no runner. Stage 3 chooses the runner for
the deployment target (the environment notes assume Vercel) and adds the
tables it needs then.

---

## Write path

One service, `lib/journal/service.ts`, Next-free, taking the `Database`
adapter at its entry points and a `Queryable` inside transactions, like
`lib/org/administration.ts`:

- `writeEntry(tx, actor, input, options)` inserts the capture with
  `on conflict (organization_id, request_key) do nothing`. A retry with the
  same key and the same text returns the original entry (`replayed`); the same
  key with different text is `request_key_conflict`, and the existing entry is
  returned beside the error so the composer can show it. Link targets are
  resolved with scoped selects that also fetch the label; a target that is not
  in the organization fails the whole write and nothing is acknowledged. The
  entry, its revision 1 and its links go in the same transaction. `options`
  (`origin`, `captureId`, `entryId`) is the server-only door the MCP path and
  the drawer's next-step line use; the browser never reaches it.
- `editEntry` is optimistic: `where revision = expected and deleted_at is
  null`; zero rows is decided three ways by reading the row back:
  `not_found`, `deleted`, or `revision_conflict`.
- `deleteEntry` is the redaction above, idempotent, `not_found` for a
  cross-organization id.
- `addLink` / `removeLink` (Server Actions `linkJournalEntry` /
  `unlinkJournalEntry`) and `countEntries` exist and are tested, but no
  surface calls them yet: the composer links through its context, and a free
  link-picker is a later stage. They are listed here so the endpoints are
  known to be intended.
- `listEntries` orders by `created_at desc, id desc` with a keyset cursor,
  fetches one more than asked, filters by any-of link targets through an
  `exists` subquery so an entry linked to a prospect and to its company appears
  once, excludes deleted and `legacy_dismissed` rows, and returns a coverage
  statement `{ returned, hasMore, oldestCreatedAt, loadedAt }`.

Server Actions in `app/actions/journal.ts` run the same four checks in the same
order as `app/actions/crm.ts`: session, then the `ActionScope` the tab sent
compared with the session (`context_mismatch` before any read; the comparison
now lives in `lib/actions/scope.ts` and is shared with crm.ts and goals.ts),
then the unconfigured refusal (`unavailable` for writes; an empty page whose
coverage says `unavailable` for reads), then the service. `origin` is never
taken from the browser; `logNextStepEntry` sets `system` server-side.

The MCP tool `log_outreach` writes its Journal entry inside `commitAction`'s
transaction through a `Plan.after` hook that runs after the plan's statements
and before the receipt's prospect read, under the same locks as before. The
entry's id is the deterministic id the timeline note would have had, and the
request key is the tool's `requestId`, so the receipt path and the request key
agree about retries. A failed Journal write aborts the whole commit: no
interaction, no opportunity change, no receipt.

## Read path

The Journal is not in the snapshot and never will be. `loadJournalPage` and
`loadJournalEntry` are the browser's reads; `get_record` (prospect) carries a
first page with `nextCursor` and `coverage`, and the new read tool
`list_journal` pages the organization's Journal or one record's, so MCP and
the UI sit on the same bounded read. The client store holds a normalized
slice: one copy of each entry, and views (`dashboard`, `journal`,
`prospect:<id>`) that hold ids, a cursor and coverage, so an edit in the drawer
is the edit on `/journal`. A separate version signal, `loadJournalVersion` and
`/api/journal/version`, is polled by the Journal surfaces that are on screen;
a changed stamp re-reads the first page of each such view and, when the reader
has paged further, merges it in front of what is already loaded rather than
cutting the list back to one page. Views a surface no longer shows are
released and not polled. Nothing refreshes while a composer or a card editor
has focus. The CRM snapshot no longer includes `notes`.

The contacted-prospect export, in the browser and through the MCP tool, now
reads Journal entries linked to the prospect or its company through the same
service; `note_count`, `last_note_date`, `note_history` and the note point of
`engagement_depth` count only entries a person wrote (decision 13), and a new
`journal_quality` column beside `history_quality` says `unavailable`, with
those columns blank rather than zero, when the Journal could not be read.
[export-schema.md](export-schema.md) carries the contract.

Drafts live in `localStorage` under a key that names the organization, the
viewer and the surface, together with the request key minted for them, so a
retry after a reload is the same capture. They are cleared when the store
learns its identity changed, when the person signs out, and (for any foreign
identity) when a composer mounts.

## Migration of `notes`

`public.journal_migrate_notes()` is created by the migration and run by it; the
notes-drop follow-up runs it again before dropping the table, so rows the old
build writes between `db:push` and the cutover, or during a rollback, are
picked up. It is idempotent. For every `notes` row it writes a capture
(`source = legacy`, `request_key = 'legacy:<id>'`), an entry with the same id
and text, `author_id = null` (A22), revision 1, and links to the opportunity
and company it named. Three shapes are labelled by `legacy_kind`: a drawer
entry (`origin = person`), a `Nästa steg: …` / `Next step: …` line and a
`[<date> · <channel> · <colleague>] <summary>` outreach line (both
`origin = system`). Outreach lines take the parsed date at `day` precision and
link to the one `crm_interactions` row that matches every parsed field;
ambiguous and unmatched lines stay unlinked, and the counts say how many. Other
rows take `created_at` as an `exact` occurrence with `occurred_on` resolved in
the organization's timezone. `ai_extracted`, `dismissed` and `applied` are
carried as `legacy_*` metadata; a dismissed row stays hidden as it was.
`notes` itself is not modified.

The function returns its counts as JSON and the migration prints them.
Rehearsal on PGlite (`tests/journal-migration.test.ts`): nine seeded notes of
every shape → nine captures, nine entries, nine revisions, ten links, one
interaction link; applied a second time → nothing changes; two notes written
afterwards → picked up by the follow-up, which then drops the table.

---

## Deploy order

Stage 1 deploys first (decision 14) and its five steps, including the promoted
rollout cleanup, are complete before any of this.

1. `npm run db:status` must list `…_journal.sql` as the only pending migration,
   and its version must sort after every applied one. The file is
   `20261001120000_journal.sql`; if the cleanup was promoted with a later
   version, rename the journal file later still before pushing. Never
   `--include-all`. Then `npm run db:push`. The migration prints the backfill
   counts; record them here.
2. Deploy the Stage 2 build in the same window. Until it is live the old
   build keeps writing `notes`; those rows are not lost (step 3).
3. After the deployed build is verified, and not in the same deploy: promote
   `supabase/followups/20261101120000_drop_notes.sql` into
   `supabase/migrations/` (rename to sort after the journal migration if
   needed) and push it. It re-runs the backfill, refuses to drop while any
   `notes` row lacks an entry, drops `notes`, then drops the function. Record
   its counts.

**Rollback before step 3.** Redeploy the old build. It resumes writing and
reading `notes`, which still exists with every row it had. The Journal rows
stay in place, untouched, for the return of the new build; the follow-up
reconciles whatever the old build wrote meanwhile. **After step 3, forward
only**: the old build selects from a table that no longer exists.

---

## Exit evidence (2026-09-22, on this branch)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | 0 errors |
| MCP behaviour: the Journal write inside `commitAction`, replay, preview, the request-key collision that aborts a commit, receipts without Journal text, `get_crm_record.journal` with a cursor, `list_journal` paging and isolation, the export counting person-written entries only, the bulk path without the Journal read, `journal_quality` | `npm run test:mcp` | 50 / 50 |
| Stage 1 migration rehearsal, rollout guard and follow-up | `npm run test:org` | 7 / 7 |
| Scoping lint: 25 organization-owned tables (the four Journal tables joined automatically), 36 Server Action statements over 12 tables, 89 SQL statements over six files including `lib/journal/service.ts` | `npm run test:scoping` | 3 / 3 |
| Client store: normalized Journal slice, view filing, edit across views, optimistic delete with restore on refusal and on a rejected promise, coverage accumulation, poller merge for paged views, view release, drafts keyed by identity and cleared on identity change and sign-out, the mount sweep, a throwing storage, `formatJournalDate` / `formatJournalDateTime` in the organization's zone, `buildExportRows` over Journal entries | `npm run test:store` | 20 / 20 |
| Journal migration rehearsal: nine legacy notes of every shape, ids and dates preserved, authors unknown, precision and Stockholm days, the unique interaction match linked, `legacy_*` carried, revision 1 written, RLS and policies on all four tables, the file applied twice, the follow-up catching up two late notes and dropping `notes` | `npm run test:journal:migration` | 11 / 11 |
| Journal service: A01, A02 (once with either target), A08 durability, A20 tombstone (with the legacy `notes` row still cascading, stated), A23 read-back and a three-page cursor walk stable under an insert, retry → `replayed`, changed text → `request_key_conflict` with `existing`, a transaction that fails after the capture insert leaving nothing, redaction reaching every content column, edit → revision 2, `revision_conflict`, `deleted`, `not_found`, two organizations invisible to each other, `author_id` nulled when the account goes, the 22:30Z day, `target_not_found`, the 20 000-character bound, explicit precision honoured and incoherent precision refused, `scopeMismatch` | `npm run test:journal` | 27 / 27 |
| Production build | `npm run build` | passes (compiled in 27 s; a first attempt earlier the same day was stopped by the machine running out of memory and was repeated) |
| HTTP transport against the built server | `npm run test:mcp:http` | 3 / 3 |
| Real multi-connection PostgreSQL 18.4, migrated including the journal migration and the rollout cleanup: owner vs owner, claim vs claim, exchange vs revoke, commit vs token revoke, with `commitAction` now carrying the `Plan.after` Journal write | `npm run test:postgres` | 4 / 4, no deadlock |
| Manual desktop and phone-width review of the composer, feed, drawer, dashboard, bottom bar, touch targets and inputs | local Supabase stack through Docker (decision 18), Chrome, 2026-09-22 | done; see *Manual review* below and `docs/review/stage-2/` |

**Manual review (2026-09-22).** Environment: the Supabase CLI's local stack
in Docker Desktop (database, gateway, auth and REST only), migrated from this
branch's `supabase/migrations/` including the journal migration, with one
organization (Khyte, created by the Stage 1 migration), one owner account
seeded through a copy of `scripts/org-members.mjs`, and two prospects seeded by
SQL; the dev server ran against it with the local keys set in the process
environment only, and the review was driven in Chrome at 1536 px and at a
500 px viewport. Screenshots are in `docs/review/stage-2/`
(`desktop-journal-tombstones.jpg`, `desktop-dashboard-recent.jpg`,
`phone-dashboard.jpg`, `phone-journal.jpg`, `phone-drawer-top.jpg`,
`phone-drawer-journal.jpg`). Checked, in order:

- The dashboard shows the composer under the greeting with "Journal · Khyte",
  the kind selector, the date field, the Ctrl/⌘+Enter hint and an honest empty
  feed ("Inget skrivet ännu"); the scripted chat and the microphone are gone.
- Saving from `/journal` with Ctrl+Enter: the status line says "Sparat", the
  composer clears, the coverage line moves to "Visar 1", and the card shows
  author, date and time, the source chip "Skriven" and the kind.
- Editing the entry with a title: saved at revision 2; "Visa historiken" lists
  Version 1 and Version 2 with their times; the entry and its title survive a
  reload (A23).
- An unsent draft: typed text is stored under
  `khyte:journal-draft:<organization>:<user>:journal` with a 36-character
  request key and comes back into the composer after a reload; clearing the
  text removes the key.
- The prospect drawer: the Journal section with the inline composer replaces
  the notes timeline; an entry written there is saved with a "Nordvik AB"
  chip and appears on `/journal` and the dashboard with the same chip (one
  entry, several views). Changing the next step writes a compact "Automatisk
  rad" entry, "Nästa steg: Skicka offert", linked to the prospect.
- Deleting an entry uses the in-card confirm ("Ta bort det här inlägget?");
  the coverage line drops; in the database the body, title, capture text and
  revision are blank and the row remains.
- Deleting the prospect: the dialog says the Journal entries are kept and
  marked as removed; afterwards `/journal` shows "Nordvik AB · borttagen" on
  both entries, and in the database every link has its target nulled with the
  label retained (A20).
- Phone width (500 px viewport): the bottom bar is Översikt · Journal ·
  Prospekt · Uppgifter · Mer; the page title comes from the nav dictionary;
  the composer's textarea, select and date input are 16 px; no horizontal
  overflow; every card control and the Save button measure 44 px; the drawer
  is full width with squared edges and its Journal section and composer are
  reachable by scrolling.

Two things the review surfaced that are not Stage 2 defects: the local stack
does not carry the table grants to `anon`, `authenticated` and `service_role`
that hosted Supabase applies by default, so the first REST write from the app
answered "permission denied for table opportunities" until the grants were
issued on the local database (the Journal's own writes, which use the direct
pool, were unaffected); and the dev overlay reports one hydration warning
caused by a browser extension injecting an attribute into `<body>`, not by
the app. Not exercised by hand: the failed-save state of the composer
(covered by the store suite), `request_key_conflict` on screen (covered by
the store suite), the bulk MCP path (covered by the MCP suite).

**What the automated evidence does and does not establish.** The PGlite
suites run on a single connection: they prove the service rules, the
migration, the MCP command path and the client store sequentially, and the
scoping lint covers the browser write path structurally. The Server Actions
are not exercised through a real cookie; their scope comparison is unit-tested
in `lib/actions/scope.ts` and every action follows the same four-step shape as
`app/actions/crm.ts`. Genuine concurrency across two connections is what
`npm run test:postgres` adds and it is still to be run for this branch. No
browser end-to-end flow is automated; the manual review is the evidence for
the composer's failure states on screen.

**Review history.** A three-lens design review of the spec (Astra's four
questions, the blueprint, the codebase) raised 42 issues that were folded into
the second draft before any migration was written, among them the migration
timestamp that `supabase db push` would have refused, the browser CSV export
that would have silently lost its note columns, and the receipt that could
have claimed a Journal entry never written. A three-lens code review of the
finished tree raised 26 surviving issues: two blockers (a rejected Server
Action promise skipped every recovery path in the store and left the composer
on "Saving…" forever) and eleven should-fix items (the coverage line after
Load more, the poller cutting a paged feed back to one page, an unreadable
Journal exported as zero notes, the entry card's stuck buttons, an unpersisted
fresh request key, the card editor not holding the poller, views never
released, the receipts sentence in the docs), all fixed in one correction
round with two owners; of the thirteen judgment calls, the replay guard in
`plan.after`, the Journal read moved outside the commit transaction and
skipped for bulk rows, the safety rule's wording, the Swedish entry noun
("inlägg", so a Journal entry and the record's own Notes field are separable),
the `context_mismatch` copy, the card's live region and the history
timestamps' timezone were taken; the rest are recorded under known limits.

## The exact next stage

Stage 3, interpretation and authorized actions (blueprint Section 13). What
it inherits from here: `captures.processing_state` and its five defined
values; `journal_entries.revision` with the full revisions table to point
spans at; `journal_entry_links.relationship` and the `evidence_*` columns,
written as `about` and null so far; `month` and `unknown` precision for
resolved dates; `Plan.after` in `commitAction` as the place a tool commit
does Journal work; `list_journal` and `get_crm_record.journal` as the bounded
read; the job-runner decision from blueprint Section 14, which Stage 2
deliberately left open with `processing_state` as its only commitment.

---

## Known limits of this stage

- No interpretation, no cleanup of prose, no extraction: `processing_state`
  is `not_requested` on every row and the UI shows nothing for it.
- One capture produces one entry; multi-topic splitting waits for Stage 3.
- Links are made by the composer's context (the open prospect) and by the MCP
  tool; there is no free link-picker in the card yet beyond what the context
  supplies. The link and unlink Server Actions exist for it.
- Link chips on a card are labels, not navigation. The blueprint's entry
  anatomy asks for navigable chips; that arrives with the stage that gives
  every record a stable route to open it from anywhere (the prospects page
  opens a drawer per row today, with no addressable target).
- `month` and `unknown` precision have no UI; the composer writes `exact` or
  `day`.
- Receipts written before this stage still embed the old `notes` shape when
  replayed.
- The Journal has no full-text search; Stage 5.

---

## Deviations from the blueprint's defaults

- "Capture revision" is encoded as entry revisions over an immutable capture
  (above).
- The blueprint's `channel` on a capture is called `source` here, because
  `channel` already means the contact channel on `crm_interactions`.
- The job runner (Section 14) is deferred to Stage 3 with `processing_state`
  as the only commitment.
