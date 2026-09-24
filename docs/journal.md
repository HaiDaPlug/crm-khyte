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
                         source (typed|mcp|legacy), original_text (≤ 20 000 chars for
                         new input; legacy rows are exempt so nothing is truncated),
                         received_at, request_key (unique per organization),
                         request_fingerprint (sha256 of the explicit creation inputs,
                         what a retry is compared against), processing_state
                         (not_requested|queued|interpreting|ready|needs_clarification|
                         failed), deleted_at
journal_entries          id (= the note id for migrated rows), organization_id,
                         capture_id → captures (composite, cascade),
                         author_id → auth.users (set null), performer (crm_colleague),
                         origin (person|system), kind (conversation|observation|idea|
                         decision|update), title, body,
                         occurred_precision (exact|day|month|unknown), occurred_on, occurred_at,
                         revision, system_event (next_step_changed, only on system
                         entries; body is then the previous next step alone),
                         legacy_kind (drawer_note|next_step|outreach),
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
`request_fingerprint` (a hash of the deleted text, so it goes with it) and
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
  `on conflict (organization_id, request_key) do nothing` and stores a
  fingerprint of the explicit creation inputs (text, title, kind, precision,
  dates, performer, links, origin; never a generated default). A retry with
  the same key and the same fingerprint returns the original entry
  (`replayed`); the same key with anything changed, text or metadata, is
  `request_key_conflict`, and the existing entry is returned beside the error
  so the composer can show it and offer to save the changed input under a
  fresh key. Link targets are
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
taken from the browser. The one system line the browser can cause,
`changeNextStep`, is a single transaction on the direct pool: it reads the
prospect's current next step under a row lock, writes the new value, and
records the previous one as a system entry (`system_event =
next_step_changed`, body = the previous text, label rendered by the UI) with a
request key derived from the row's previous `updated_at`, so a repeated submit
replays and a later change gets its own line. Before any browser mutation
writes — create, edit, delete, link, unlink, next step — the transaction takes
the account advisory lock and re-verifies, in one statement, that the session
that authenticated the request is still live and that the membership is
active on the same credential generation; otherwise the write is refused as
`unauthorized` and nothing is acknowledged. That is the same gate the MCP
commit has had since Stage 1, now on the browser path too. System entries
cannot be edited (`system_entry`); they can be deleted.

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

Drafts live in `localStorage`, one slot per draft, under a key that names the
organization, the viewer, the surface and the draft's own request key; the tab
remembers in `sessionStorage` which draft its box holds, so a retry after a
reload is the same capture and two tabs never overwrite each other's words
(correction round 3, below). They are cleared when the store
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
| MCP behaviour: the Journal write inside `commitAction`, replay, preview, the request-key collision that aborts a commit, receipts without Journal text, `get_crm_record.journal` with a cursor, `list_journal` paging and isolation, the export counting person-written entries only, the bulk path without the Journal read, `journal_quality` | `npm run test:mcp` | 51 / 51 |
| Stage 1 migration rehearsal, rollout guard and follow-up | `npm run test:org` | 7 / 7 |
| Scoping lint: 25 organization-owned tables (the four Journal tables joined automatically), 36 Server Action statements over 12 tables, 91 SQL statements over six files including `lib/journal/service.ts`; from the second round: the Journal actions resolve the session without throwing and report `unauthorized` | `npm run test:scoping` | 4 / 4 |
| Client store: normalized Journal slice, view filing, edit across views, optimistic delete with restore on refusal and on a rejected promise, coverage accumulation, poller merge for paged views, view release, drafts keyed by identity and cleared on identity change and sign-out, the mount sweep, a throwing storage, `formatJournalDate` / `formatJournalDateTime` in the organization's zone, `buildExportRows` over Journal entries, and from the correction pass: the save settlement (unchanged, changed, other surface), the edit session (base captured, incoming revision does not move it, rebase), the poller decision (applied advances, deferred and failed retry), the range refresh dropping a deleted entry and updating an edited one, `changeNextStep` optimistic and restored, `unauthorized` keeping drafts while `context_mismatch` clears them; from the second round: the editor's save settlement (unchanged closes, changed keeps the newer words on the saved revision), the stored-draft settlement across tabs (equal → cleared, advanced by another tab → kept and adopted, both changed → this tab's words under a fresh key), the two-tab replay that fails without the fix, the adopt-from-storage guard; from the third round: per-key draft slots with per-tab ownership, the draft box choreography driven directly against fake storages (restore and fork, let-go keys, the fork origin carried in the slot, the hand-over to a live box, typed words in the owner record), Astra's two cases end to end, and every duplicate path the four review passes found | `npm run test:store` | 59 / 59 |
| Journal migration rehearsal: nine legacy notes of every shape, ids and dates preserved, authors unknown, precision and Stockholm days, the unique interaction match linked, `legacy_*` carried, revision 1 written, RLS and policies on all four tables, the file applied twice, the follow-up catching up two late notes and dropping `notes`; from the correction pass: a 20 001-character legacy note migrated losslessly, an outreach-shaped line with an invalid date migrated as an ordinary entry and counted malformed, the earlier length check swapped for the named constraint | `npm run test:journal:migration` | 14 / 14 |
| Journal service: A01, A02 (once with either target), A08 durability, A20 tombstone (with the legacy `notes` row still cascading, stated), A23 read-back and a three-page cursor walk stable under an insert, retry → `replayed`, changed text → `request_key_conflict` with `existing`, a transaction that fails after the capture insert leaving nothing, redaction reaching every content column, edit → revision 2, `revision_conflict`, `deleted`, `not_found`, two organizations invisible to each other, `author_id` nulled when the account goes, the 22:30Z day, `target_not_found`, the 20 000-character bound, explicit precision honoured and incoherent precision refused, `scopeMismatch`; from the correction pass: a real session revoked, re-added, reset or expired is `unauthorized` on every mutation with no row changed while a live one writes and an MCP actor is not gated; retries with changed kind, date, title, performer or links are `request_key_conflict` while an identical retry replays once; `changeNextStep` writes the prospect and the system line in one transaction, logs nothing for an empty previous value, replays a repeated transition, edits of system entries are `system_entry` | `npm run test:journal` | 41 / 41 |
| Production build | `npm run build` | passes (compiled in 27 s; a first attempt earlier the same day was stopped by the machine running out of memory and was repeated) |
| HTTP transport against the built server | `npm run test:mcp:http` | 3 / 3 |
| Real multi-connection PostgreSQL 18.4, migrated including the journal migration and the rollout cleanup: owner vs owner, claim vs claim, exchange vs revoke, commit vs token revoke, with `commitAction` now carrying the `Plan.after` Journal write, plus the browser Journal write versus `revokeMember` in both orders (the write that holds the account lock finishes and the next is refused; a revoke that finishes first refuses the pending write) | `npm run test:postgres` | 5 / 5, no deadlock |
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
  text removes the key (since round 3 the request key is the slot key's last
  segment, one slot per draft).
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
`app/actions/crm.ts`. That gap is exactly where the on-screen finding of the
second round lived: a session that had ended reached the browser as a thrown
error, not as the `unauthorized` code the store acts on. Genuine concurrency across two connections is what
`npm run test:postgres` adds (5 / 5 above). No browser end-to-end flow is
automated. The manual review covered the happy paths and the deletion paths
on screen; the composer's failed-save and conflict states were exercised only
by the store suite in the first pass and are exercised on screen in the
correction pass below.

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

**Correction round 1 — Astra's review of `a9b1e1b` (2026-09-23).** Eight
findings, none of them reopening a decision; all eight corrected in one pass
with two owners (server and client) and regression coverage at the layer that
owns each bug:

- *R1, lost text after a delayed save (P1).* The composer now freezes a
  snapshot at submit and settles the answer against what the box holds when
  it arrives: unchanged → clear and "Sparat"; changed since → keep the newer
  text under a freshly minted request key and say the earlier text was saved;
  a different surface → leave the current composer alone and settle only the
  old surface's stored draft. The textarea stays writable during a save. Pure
  logic in `lib/journal/composer-state.ts`, tested in the store suite.
- *R2, an open editor adopting a teammate's revision (P1).* The card captures
  its base revision when the editor opens and always submits that; an
  incoming revision never moves it. On `revision_conflict` the local draft
  stays, the latest wording is shown, Save is disabled, and one button
  rebases onto the latest version knowingly; `deleted` and `system_entry`
  close the editor with their copy. The store re-reads the entry on a
  conflict so the rebase has the real latest revision.
- *R3, browser mutations after revocation (P1).* Every browser Journal
  mutation transaction now takes the account advisory lock and verifies in
  one statement that the authenticating session is live and the membership
  active on the same credential generation (`assertLiveSession` in
  `lib/org/members.ts`), refusing `unauthorized` otherwise with nothing
  written; the MCP commit keeps its own gate. Covered by service tests for
  revoke, revoke and re-add, password reset, sign-out everywhere, expiry, a
  session from another organization, and by a fifth real-PostgreSQL scenario
  on two connections in both orders.
- *R4, a change consumed but not applied (P2).* `refreshJournalViews` reports
  applied, deferred or failed; the poller advances its seen version only on
  applied and retries the same stamp otherwise, and runs a check as soon as
  typing stops.
- *R5, paged feeds keeping deleted text (P2).* A poller refresh of a
  multi-page view re-reads the whole loaded range through the cursors,
  replaces the ids with the fresh sequence, rewrites every returned entry and
  drops the ones no longer returned (walking a little past the old range so a
  new entry at the top does not push the reader's last entry out). Explicit
  Refresh and first load still read one page.
- *R6, retry identity ignoring metadata (P2).* Captures store a fingerprint
  of the explicit creation inputs; a retry replays only against that, and any
  changed metadata is `request_key_conflict` with the existing entry offered.
  Deleting an entry clears its fingerprint with its text.
- *R7, valid legacy content aborting the migration (P2).* The 20 000-character
  limit now exempts `source = legacy`; outreach-shaped lines are recognised
  only when the date parses (`journal_try_date`), the channel and the
  colleague are known values, otherwise they migrate as ordinary entries and
  are counted `outreach_malformed`. Both fixtures migrate losslessly and the
  file still applies twice.
- *R8, system provenance enforced only by the UI (P2).* `logNextStepEntry` is
  gone. `changeNextStep` is one server transaction that reads the prospect's
  next step under a row lock, writes the new value and records the previous
  one as a system entry whose `system_event` is `next_step_changed`, body
  the previous text alone, label rendered by the UI, request key derived from
  the row's previous `updated_at`; `editEntry` refuses system entries.

Decisions taken during the round, recorded here so they are not mistaken for
oversights: an expired or revoked session (`unauthorized`) reloads the page
but keeps this person's unsent drafts, since they are keyed to that person
and the composer sweeps any other identity's drafts on mount, while
`context_mismatch` (another identity already acting here) and sign-out still
clear them; in demo mode the next step behaves like every other CRM field and
keeps its value; the conflict strip's discard path is the editor's existing
Cancel; a save that fails after the drawer has moved to another prospect
keeps its draft and key in storage but shows no error in the new prospect's
box. Evidence wording corrected as Astra asked: the PostgreSQL sentence, and
the manual review now says which states were seen on screen.

*On screen, correction round (2026-09-23, local stack rebuilt on the
corrected migration, Chrome at 1400 × 900; screenshots `round1-*.jpg` in
`docs/review/stage-2/`).* Network conditions were produced by wrapping the
page's `fetch` for Server Action requests only.
- Delayed save (R1): with responses held for six seconds, "Första tanken."
  was submitted and " Viktig ny detalj." typed while it was pending; the box
  stayed writable and said "Sparar…"; when the answer came the card showed
  only "Första tanken.", the composer kept the full newer text under a new
  36-character request key, and the status line said the first text was
  saved and the later text still there.
- Failed save: with requests failing, saving showed the inline error naming
  the cause with "Texten ligger kvar" and a Retry button, the toast, and the
  draft intact in storage; with the network restored, Retry saved it, the
  box cleared, the feed went to "Visar 2" and the stored draft was removed.
- Revision conflict (R2): the editor was opened on revision 1, the draft
  changed, a teammate's revision 2 was written directly to the database, and
  Save sent `expectedRevision: 1`; the answer was a conflict, the editor kept
  the local draft with "Din text ligger kvar", showed "Senaste versionen ·
  Version 2" with the teammate's wording, and offered "Utgå från den senaste
  versionen"; the database still held revision 2 unchanged. After the rebase
  the same draft saved as revision 3, and the history reads 1, 2, 3.
- Not exercised on screen: the poller applying a change after typing ends
  (R4) and a revocation refusing a pending browser write (R3). Both were
  planned next, but the review machine's drive filled up during the session
  (Docker's VM disk was the last straw), the local database container lost
  its port and the Docker VM went read-only. R4 is covered by the poller
  decision and store tests; R3 by the service tests for every mutation and by
  the two-connection PostgreSQL scenario in both orders. Both were exercised
  on screen in the second round, below.

**Correction round 2 — Astra's review of `f36b90c` (2026-09-24).** Two
text-loss cases remained, both client-side and both reproduced by Astra
through the component handlers; the other findings were confirmed closed.

- *Editing an entry while Save is pending.* The editor stayed writable but a
  successful save closed it and discarded words typed after the press. The
  card now snapshots the editor at the press and settles the answer against
  what the editor holds when it arrives (`settleEditSave`): unchanged → the
  editor closes; changed → it stays open with the newer words, its base moves
  to exactly the revision the save produced (a new `saved` step in the edit
  session, deliberately not the "latest seen" rebase, so it never silently
  builds on a colleague's edit that arrived meanwhile), and a status line says
  the earlier wording is saved and the newer text is not yet.
- *Two tabs sharing one stored draft.* Both tabs on a surface read and write
  the same storage key, so a delayed save in one tab, finding its own box
  unchanged, cleared the stored draft another tab had since advanced; a
  reload then lost that text. The composer now settles against storage as
  well as its own box (`settleStoredDraft`): the stored draft is cleared only
  when it still equals the snapshot in request key, text, kind and date; a
  draft advanced by another tab is left in place and, when this tab's own
  box is unchanged, adopted into it with its request key; when both changed,
  this tab keeps its words under a fresh key and storage is neither cleared
  nor overwritten. A `storage` listener lets an idle tab (no focus in its
  box) take up what another tab typed, with a guard that never overwrites the
  only copy of this tab's own words. A tab that then saves under a key another
  tab already consumed gets `request_key_conflict` and the existing conflict
  strip.
- *What stays in the box after a delayed save* (found by Hai on screen during
  this round). Round 1 kept everything the box held, the saved sentence
  included, so a second save would have filed it twice, and a fast answer and a
  slow one ended in different boxes. Now, when the writer simply kept typing,
  the saved sentence leaves the box and only the words after it stay
  (`typedSince`; whitespace and sentence punctuation typed right after the
  saved words go with them); when the sent words were edited rather than
  continued, or the kind or date changed, the whole text stays because the
  saved and the newer words can no longer be told apart. The same rule at any
  network speed.
- *A revoked member's pending save* (found on screen during this round's
  revocation check, step 5 below). The actions' own contract is that errors
  are reported, never thrown — but the session itself was resolved with
  `requireAuth()`, which throws, so a save that reached the server after the
  account had been revoked came back not as `unauthorized` but as a thrown
  `Unauthorized` (in production, an opaque digest). The store cannot read that
  as "this tab is finished": the composer showed "Det gick inte att spara:
  Unauthorized. Texten ligger kvar." with a Retry that could never succeed, a
  toast said the change "syns här men ligger inte i databasen", and the tab
  stayed on the Journal instead of reloading to the sign-in page. The
  service's own re-check under the account lock (R3) was never reached: the
  gate had already thrown. Every Journal action now resolves the session with
  `getAuthContext()` and returns `{ ok: false, error: 'unauthorized' }`
  without one, ahead of the scope and configuration checks, and a fourth
  scoping lint keeps `requireAuth()` out of `app/actions/journal.ts`. The code
  itself moved to `lib/actions/scope.ts` beside `context_mismatch`, where the
  server can import it; the composer re-exports it. The store's side —
  `unauthorized` keeps this person's drafts and reloads the page, which the
  server then sends to sign in — was already in place and is covered by the
  store suite. The corrected path was replayed on screen after a fresh
  sign-in (last bullet of the on-screen paragraph below).

Evidence: typecheck and build pass (the build rerun after the action-file
change); mcp 51, org 7, scoping 4 (one new), store 36 (five new),
journal:migration 14, journal 41, mcp:http 3. The PostgreSQL suite was not
rerun for this round: no SQL changed.

*On screen, round 2 (2026-09-24, the same local stack, Chrome at 1920 × 855).*
The review tab sat in Hai's own browser window behind their working tab for
most of the pass, so steps 3–5 were driven through the page's own handlers
from the developer console rather than the keyboard, and screenshots exist
for steps 1–2 only (`round2-*.jpg` in `docs/review/stage-2/`). Network
conditions were produced as in round 1 by wrapping the page's `fetch` for
Server Action requests only.
- Delayed save at both speeds: "Snabb mening." then " Fortsättning snabb."
  with no delay, and "Långsam mening." then " Fortsättning långsam." with the
  answer held six seconds. Both ended the same way: the card shows the sent
  sentence, the box holds only the continuation, the stored draft holds the
  same words under a new key, and the line reads "Det du skrev först är
  sparat. Det du skrivit sedan ligger kvar."
- Editor save while typing: the entry "Långsam mening." was opened,
  " Redigerad del. Nyare ord." typed, Save pressed with the answer held six
  seconds and " Efter spara." typed meanwhile. The editor stayed open with all
  four sentences, the line said "Den tidigare formuleringen är sparad. Det du
  skrivit sedan ligger kvar och är inte sparat än.", and after Cancel the card
  read "Långsam mening. Redigerad del. Nyare ord." with its history links.
- Two tabs, one draft, both settlements. (a) Tab A held "Utkast från flik A."
  with focus in its box and saved with the answer held; tab B appended " Mer
  från flik B." meanwhile. A's answer found its own box unchanged and storage
  advanced: the box adopted B's words under B's key, storage was left intact,
  and the line said the first text was saved. Save on the adopted words
  answered the conflict strip ("Det här utkastet är redan sparat, i en
  tidigare version." with "Spara den här versionen som ett nytt inlägg"),
  which filed them as a new entry and emptied the box in both tabs. (b) Tab B,
  with no focus in its box, saved "Rad från B." with the answer held; tab A
  appended " Fortsatt i A." meanwhile; B took the words up through the
  `storage` listener while the save was in flight, and when the answer came B
  kept "Fortsatt i A." under a fresh key, storage held the same, A followed to
  the same words, the card read "Rad från B.", and a reload of B came back with
  "Fortsatt i A." under that key.
- A line arriving while typing (R4): with focus in A's box, tab B saved
  "Kollegans rad medan A skriver."; A's poll fetched the new stamp and
  deferred — the feed stayed at "Visar 9" without the line for fifteen
  seconds; on blur, the release check ran within five seconds and the feed
  went to "Visar 11" with both new lines. The poller skips its checks while
  `document.hidden` is true, and this tab was hidden, so `document.hidden`
  was overridden to false for this step alone; the hidden-tab gate itself was
  seen in round 1.
- Revocation with a save pending (R3): "Fortsatt i A." was submitted with the
  request held 25 seconds before leaving the browser; `revoke --email
  review@local.test` ran meanwhile (a second owner had to be added first —
  the CLI refuses to revoke the last one), and the request left three seconds
  after the revoke finished. The write was refused and nothing was filed, the
  box kept its text, and the other tab's next navigation met the sign-in gate
  — but the composer showed the generic retry rather than "Du loggas in
  igen…" and the tab did not reload: the finding above. The account was
  re-added afterwards.
- Replay after the fix, fresh sign-in: "Rad skriven strax innan kontot
  spärras." was submitted with the request held thirty seconds, the account
  was revoked ten seconds in, and the request left twenty seconds after the
  revoke. Within the next twenty seconds the tab had reloaded to the sign-in
  page; the stored draft still held the sentence under its key; the database
  held no entry with that text and no capture from the attempt (live entries
  still 11). The "Du loggas in igen…" line itself was not caught between the
  answer and the reload — it is the store suite's `signedOut` state — but the
  outcome it announces was: nothing filed, the page at sign-in, the text kept.

**Correction round 3 — Astra's review of `8082ed0` (2026-09-24).** The editor
and the authentication fixes were accepted. Two composer cases remained, both
reproduced through the component handlers, and both with the same root: a
draft was identified by its text, never by who owned it.

- *An old save truncating a new draft.* Save "Call Erik", empty the box, type
  "Call Erik tomorrow": when the old answer arrived, the remainder rule saw a
  text that began with the sent words and cut the new draft to "tomorrow", in
  the box and in storage. The rule now applies only while the box still
  carries the request key that was sent — the same draft, continued. A box on
  another key is another draft, whatever its words begin with: it keeps its
  whole text and its own key.
- *Divergent drafts in two tabs.* One storage slot per surface could hold one
  tab's words; when two tabs held different unsaved text, the other version
  lived in memory alone and a reload lost it, and the `storage` listener's
  guard — adopt when this box equals what storage held before the other tab
  wrote — was exactly backwards: equality with the overwritten value meant
  this tab's words had just been removed from storage, and adopting removed
  them from memory too. The draft store is rebuilt around ownership:
  - Every draft has its own slot, `khyte:journal-draft:<org>:<user>:<surface>:<requestKey>`.
    A tab writes and clears only the slot of the key its box holds. Two tabs
    with different words end in two slots.
  - Every tab remembers, in `sessionStorage` (per tab, survives a reload), the
    key its box holds and the words it typed there. On mount the box takes
    its own draft back, typed words counted as typed only while the slot still
    holds them; a fresh tab takes the newest draft on the surface — the one a
    closed tab left behind, or a mirror of what another open tab is typing —
    and a tab with no draft at all starts empty.
  - The box knows whether its words were typed here (`typedHere`, with the
    text as of the last local keystroke) or merely mirrored from storage, and
    which keys it has finished with (saved, emptied, moved away from). The
    cross-tab rules (`followStorage`) are written from one invariant, held as
    worded while the tab's composer is on the surface: no rule removes, from
    the box or from storage, words typed in this tab and not saved. An empty
    box follows what another tab starts, except under a key it has itself
    finished with. A mirror follows its source, including when the source is
    saved or emptied. A box whose typed words the other tab continued — a
    typo fixed there included, as long as this tab's own words still stand at
    the front — adopts the continuation and still counts them as typed here.
    When another tab removes the slot under this box's key, the box writes
    its words back under the same key. Only a write of different words under
    this box's key makes it fork to a fresh key; the other tab keeps the old
    one, both survive a reload, and the fork carries the key it left in its
    own slot (`forkedFrom`), so whoever later saves those words — the forking
    tab, the same tab after a reload, a tab that mirrored the fork — sends
    them under the original key: the server replays the entry if that key
    already filed those words, files them once if nobody did, or answers
    `request_key_conflict` and the strip if different words were filed. "Save
    this version as a new entry" on shared forked words goes out under the
    fork key every holder shares, so the second holder replays rather than
    files again. No path files the same sentence twice without the strip.
  - A save clears the slot under the sent key while it holds the sent words,
    and the box's own slot while it holds exactly the box's words, so a stray
    full stop typed after Save does not leave a saved sentence in storage. The
    words after the saved sentence stay in this box only when they were typed
    here, never when they were mirrored from another tab, whose words they
    remain. A slot another tab typed on under the sent key is left to that tab, whose
    own save then meets `request_key_conflict`. A save whose box was re-keyed
    by a fork while it was in flight is still settled as the draft it sent,
    and so is a Retry after a lost answer. An answer, or a refusal, that
    reaches an instance the drawer has since left is handed to the live box
    on the same surface when that box holds the sent words or a continuation
    of them, and otherwise settles only the slots it came from. The round-2
    "adopt the other tab's words into the box that saved" branch is gone: the
    words belong to the tab that typed them.
  - The choreography — mount, keystroke, storage event, Save, answer,
    unmount — lives in one plain module, `lib/journal/draft-box.ts`, which the
    component calls and the store suite drives directly against a fake
    localStorage and one fake sessionStorage per tab. The first pass of this
    round tested a hand-copied stand-in of the component instead, and the
    review found the copy already drifting; the module is what closed that.
  - The single legacy slot from earlier builds is migrated into its own slot
    the first time a composer mounts on that surface, and the legacy key is
    removed only after the write went through. A slot write that fails (a
    full quota) never lets the old slot go. Stage 2 is not deployed, so no
    production draft exists yet.
- *Known limits, stated rather than hidden.* Signing out in one tab removes
  this identity's slots; a tab that still holds typed words writes them back
  under that identity until the next composer mount by another identity
  sweeps them — as a keystroke did before this round. While a tab's drawer is
  on another prospect, nothing there is live to restore that prospect's draft
  if another tab empties it. Two tabs that both type different words under one
  shared key end with two drafts; nothing decides for the person which
  version was meant.

Evidence: typecheck and build pass; mcp 51, org 7, scoping 4, store 59,
journal:migration 14, journal 41, mcp:http 3. No server file changed; the
PostgreSQL suite was not rerun. The correction went through four review
passes (two scoped reviewers with a batched skeptic each, then three single
reviewer-plus-skeptic passes on each correction batch; the fourth pass's
four small items were applied and verified without a further pass): Astra's cases
confirmed closed each time, and seeded random fuzzing over two and three tabs
(75 000 walks in the first pass, 16 000 with reloads and remounts in the last)
found no sequence that lost typed words. The passes surfaced and closed: the
removal refill loop (a saved mirror's owner forked to a fresh key and the
saver adopted the fork back, so both boxes refilled with saved words), the
stale slot after a punctuation-only continuation, a fork during an in-flight
save settled as another draft, a fork on a typo fix in the other tab, the
fork's origin living only in memory (a reload or a mirroring tab filed the
sentence twice), refusals dropped after the drawer came back, and the
extraction's away-and-back regression — plus notes on the hand-over deciding
by key alone, typedHere across a reload, failed writes, unstamped slots, stale
comments and test routing.

*On screen, round 3 (2026-09-24, local stack rebuilt on the same migrations).*
Both tabs sat behind Hai's working tab, so every step was driven through the
page's own handlers from the developer console, with the box, the storage
slots (`khyte:journal-draft:…:<requestKey>`), the per-tab owner record and the
feed read back after each step; the dev server was the one the earlier rounds
used, on the rebuilt database (no entries at the start).
- *Astra's case 1.* "Call Erik" was submitted with the answer held six
  seconds, the box emptied (its slot and owner record went with it) and
  "Call Erik tomorrow" typed under a new key. When the answer came the box
  still held "Call Erik tomorrow", its slot held the same under that key, the
  line said the first text was saved and the newer kept, and the card read
  "Call Erik". Feed: 1.
- *Astra's case 2.* Tab A typed "Call" (K1). Tab B opened and mirrored it
  (owner record K1, no typed words). B typed "Call Erik"; A adopted the
  continuation with its own typed words still "Call". A rewrote to "Meet
  Erik": B forked "Call Erik" to K2 with `forkedFrom` K1, leaving two slots.
  B reloaded and came back with "Call Erik" under K2; A reloaded and came back
  with "Meet Erik" under K1. Nothing was lost.
- *The fork's origin.* B saved its forked words: the request went out under
  K1, "Call Erik" was filed once, B cleared and said Saved, and its K2 slot
  was released while A's K1 slot stayed. A saved "Meet Erik" under K1: the
  strip ("Det här utkastet är redan sparat, i en tidigare version.") with
  "Spara den här versionen som ett nytt inlägg", which filed it under a fresh
  key and cleared the box. Feed: 3, one per draft.
- *The refill loop the first review found.* A typed "Call Erik" (K5); the
  empty B mirrored it and saved; B cleared and released the slot. A got the
  removal and restored its words under the same key K5, and B stayed empty
  with "Sparat" instead of taking the words back. A then saved: the same key
  replayed the entry, the box cleared, and a reload showed 4 entries — one
  for this draft, not two.

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
