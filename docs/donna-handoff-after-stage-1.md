# Donna — handoff after Stage 1

**Date:** 2026-09-21
**Branch:** `feat/organization-foundation` at `4a95dc5`, pushed, working tree clean, not merged to `master`
**Status:** Stage 1 (organization foundation) accepted as code by Astra on 2026-09-21. Not deployed. Stage 2 not started.
**Blueprint:** [Donna-Product-Architecture-and-Fable-Handoff-v1.md](Donna-Product-Architecture-and-Fable-Handoff-v1.md)
**Stage 1 record:** [organization-foundation.md](organization-foundation.md)

This document is for the agent that picks Donna up from here. It says how
Hai runs the work, what Stage 1 left behind and why, what Stage 2 has to
deal with in the code as it stands, and what the later stages will need
from the ground being laid now. It was written by the agent that built
Stage 1, from its own investigation; where it recommends, it says so, and
the decision is Hai's.

---

## 1. Where things stand

Donna is the redesign of the Khyte CRM into a shared business workspace with
a context-aware colleague inside it. The product is settled in the blueprint:
Section 2 is canon, Section 13 is the five stage briefs, Section 12 the
acceptance scenarios (A01–A25) each stage must evidence. Hai and Astra (a
ChatGPT thread) own product and architecture decisions; the implementing
agent builds one stage at a time and Hai takes each stage back to Astra for
review before the next one starts.

| Stage | Purpose | State |
| --- | --- | --- |
| 1 | Organization foundation: identity, membership, organization scope on every path | Accepted 2026-09-21 (`4a95dc5`) |
| 2 | Journal and durable text capture | Next. Plan and questions first, then code |
| 3 | Interpretation and authorized actions | Not started; the largest stage |
| 4 | Voice | Not started |
| 5 | Memory and useful suggestions | Not started |

Astra's acceptance covers the code. Production rollout still follows the
deploy order in [organization-foundation.md](organization-foundation.md);
none of its five steps has been executed, and the migration
`20260920120000_organizations.sql` is still pending on the live project
(last checked with `npm run db:status` on 2026-09-20). Whether Stage 2
branches from `feat/organization-foundation` or from `master` after a merge
is Hai's call; ask at kickoff.

---

## 2. How this project is run

These are Hai's rules, learned over Stage 1. They are not suggestions.

- **One stage per branch and session.** Use the `/implement` skill. Read
  the blueprint and the Stage 1 record, audit the current branch, present a
  short plan, then put the questions that change the architecture to Hai
  with `AskUserQuestion` before writing code. Do not re-ask canon that
  Section 2 settles. Do not pull later-stage features into an earlier stage.
- **Spawned agents run on Opus.** Every `agent(...)` in a Workflow script
  and every Agent tool call passes `model: 'opus'`. Hai asked for this after
  a 60-agent Fable review; the concern is cost, not brevity. Keep your own
  messages at normal detail.
- **Ultracode is on** for this project: substantive work goes through the
  Workflow tool (understand → design → implement → adversarial review), with
  you defining contracts and auditing the result.
- **Commit and push only when asked.** Hai asks for a commit when the
  stage is ready for Astra, then for a push, then pastes Astra's findings
  back. Each review round is one bounded correction commit, verified, then
  pushed. Stage 1 took three rounds; that is normal.
- **Report in the Senior Engineer Implementation Report format**, and per
  stage return what the blueprint's Section 13 asks for: changed behaviour,
  files and migrations, tests actually run with results, migration and
  rollback implications, remaining risks, deviations from defaults, the
  exact next stage. Say what was *not* run. Astra checks evidence against
  claims and will find the gap.
- **Secrets.** Never print, inspect or paste values from `.env.local`; key
  names only. Tests never load `.env.local` and never contact a remote
  database. The only production contact allowed without Hai's explicit
  instruction is the read-only `npm run db:status`.
- **Migrations ship with their code**, in the same deploy window. A
  migration applied ahead of its code once dropped a column the deployed
  query still read and took the CRM down. Additive only; never drop or
  rename a column the deployed build might still select.
- **Never invent account mappings.** Which email is Erik and which is Abdi
  is Hai's to state. The migration creates no accounts.
- Hai is `hai@khyteteam.com`. Hai's pronouns have not been stated; use
  they/them.

Attribution for commits from this point on: end commit messages with
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (or the
attribution line your own session specifies).

---

## 3. What you inherit from Stage 1

Read [organization-foundation.md](organization-foundation.md) in full; it
is the record. This section is the shorter map of the invariants Stage 2
must keep, with where each lives.

**Identity and scope.** `getAuthContext()` in `lib/auth/context.ts` joins
the session cookie (`khyte_session`, signed with `AUTH_SECRET`, hashed into
`app_sessions`) to an *active* `organization_members` row and returns
`AuthContext { sessionId, userId, organizationId, organization, viewer,
credentialGeneration }`. It is the only source of organization scope.
Server Actions get it through `requireAuth()` / `requireOwner()` in
`lib/auth/guard.ts`; MCP tools get an `Actor { connectionId, userId,
organizationId }` resolved from the bearer token in `lib/mcp/oauth.ts`
before any argument is parsed. Nothing takes an organization id from the
client as authority.

**The identity boundary for browser writes.** Every Server Action in
`app/actions/crm.ts`, `goals.ts` and `members.ts` takes a trailing
`ActionScope { organizationId, userId }` that the store sends from its own
snapshot; the server compares it with the session and answers
`context_mismatch` when they differ. The store (`lib/store/store.ts`) then
sets `identityChanged`, `SnapshotSync` reloads the page, and
`applyRemoteSnapshot` refuses any snapshot whose organization or viewer is
not the one it holds. New Server Actions follow the `run(table, scope, …)`
pattern in `app/actions/crm.ts`: scope check, then the write with
`.eq('organization_id', …)` and a `'row'` expectation so zero affected rows
is `not_found`, never a silent success.

**The database enforces the boundary.** All nineteen business and
integration tables carry `organization_id`. Parents expose `(id,
organization_id)` keys and children reference them with composite foreign
keys, so a cross-organization link cannot exist whatever the code forgets.
`tasks` uses `on delete set null (opportunity_id)` so a deleted deal unlinks
its task without moving it. RLS policies through `public.is_org_member`
exist but are dormant: reads use `SUPABASE_DB_URL` directly and writes use
the secret key, both of which bypass RLS, so scope is enforced in code and
covered by tests. Do not open a publishable-key path without revisiting
that.

**Credential generations.** `organization_members.credential_generation`
rotates on revoke, re-add and password reset. Wallpaper tokens and OAuth
codes and connections record the generation they were minted under and
stop verifying when it changes. Anything Stage 2 mints on a person's
behalf that must die with their membership should do the same.

**Lock order**, for anything that touches memberships or accounts:
organization advisory lock (`hashtext('khyte:org:<id>')`) → account
advisory lock (`hashtext('khyte:user:<id>')`) → row locks; peek without a
lock, take the locks, re-read `FOR UPDATE`, revalidate. Helpers are
`lockOrganization` and `lockAccount` in `lib/org/members.ts`. The MCP
`commitAction` takes the tools lock, then the account lock, then re-verifies
the connection and membership. Ordinary capture writes do not need these
locks; they need an idempotency key.

**Attribution has two columns.** `crm_events.recorded_by` is the account
that logged the event; `colleague` stays the roster label (`erik` / `abdi`
/ `hai`, the `crm_colleague` enum) that every counter and export reads. A
member is *mapped* to a label (`organization_members.colleague`, unique per
organization while active). Journal entries need the same split: the
authenticated author, and separately whoever performed the activity.

**Events.** `recordEvents(eventScope(context), …)` in `lib/db/events.ts`;
events are append-only facts with `subject_id` deliberately not a foreign
key. Current state is recomputed from the business tables; counts come
from events. Do not blend the two (see the AI Assistant design section of
[current_state.md](current_state.md), which predates the blueprint but
whose data-honesty rules still hold).

**The snapshot is whole-table.** `readSnapshot` in `lib/db/queries.ts`
loads every organization-scoped table into the client store on page load,
and `SnapshotSync` polls `/api/snapshot/version` every 12 seconds (a
`max(updated_at)` union over the same tables). `notes` is one of them. The
blueprint says the Journal is paginated independently and never shipped
whole in the snapshot or in every prompt; Stage 2 must give it its own read
path rather than adding tables to this list.

**Tests and how they run.**

| Suite | Command | What it proves |
| --- | --- | --- |
| `tests/mcp.test.ts` (44) | `npm run test:mcp` | Behaviour on PGlite: isolation, revocation, sessions, members, OAuth, wallpaper, recovery, races R1–R4 |
| `tests/organization-migration.test.ts` (7) | `npm run test:org` | The migration on a pre-migration schema: restart safety, counts, guard, composite keys |
| `tests/scoping.test.ts` (3) | `npm run test:scoping` | A source lint: every SQL statement against an organization-owned table names `organization_id` |
| `tests/store.test.ts` (2) | `npm run test:store` | The client store refuses a foreign snapshot |
| `tests/mcp-http.test.mjs` (3) | `npm run test:mcp:http` after `npm run build` | Streamable HTTP transport against the built app |
| `tests/mcp-postgres.test.ts` (4) | `npm run test:postgres` | The lock protocol on a real PostgreSQL with two connections |

`npm test` runs the first four. Server-only modules need
`--conditions=react-server`; the store suite needs
`tests/support/client-preload.cjs`. `tests/support/migrations.ts` migrates
PGlite the way the deploy will: every migration in order, assert the
rollout guard, then apply the cleanup from `supabase/followups/` or from
`supabase/migrations/` once promoted. `scripts/pg-concurrency.mjs` starts a
disposable embedded PostgreSQL (install once with
`npm install --no-save embedded-postgres`; it is deliberately not a
devDependency), migrates it the same way and runs the concurrency suite.
There is no Docker on Hai's machine and the local PostgreSQL install has no
server libraries; the embedded server is the working route.

**Documents to keep current.** `docs/current_state.md` gets a session
update at the top of each stage (the Stage 1 one is the model);
`docs/database.md` for schema and access rules; `docs/remote-mcp.md` for
tool contracts; `.env.example` for any new variable, with the reasoning in
the comment. `docs/aiLogic.md` is the pre-Donna extraction design and is
superseded by blueprint Section 5; nothing has marked it so yet.

---

## 4. Carried forward from Stage 1, deliberately

None of these blocks Stage 2. All of them are Hai's to schedule.

- **Deployment.** Steps 1–5 of the deploy order have not run. Step 2 needs
  Hai to state the erik / abdi account emails. `AUTH_PASSWORD` stays on the
  deployment until step 5. After step 5 the old build is not a rollback
  target.
- **The rollout cleanup lives in `supabase/followups/`.** It is promoted
  into `supabase/migrations/` only after the new build is verified live.
  Two things in the tests depend on its filename ending
  `drop_organization_rollout.sql`; see the trap in Section 5.3 before adding
  a Stage 2 migration.
- **Known limits** (recorded in the Stage 1 doc): fixed roster enum; no
  workspace switcher; no invitation flow, so `belongs_elsewhere` discloses
  that an account exists; no password-recovery email; RLS dormant; demo mode
  cannot be logged into; `supabase/seed.sql` predates the strategy boards
  and does not apply.
- **Not automated:** browser end-to-end flows and Server Actions through a
  real cookie; the CLI's recovery branches in `scripts/org-members.mjs` are
  syntax-checked and reasoned, not executed against a database.
- **Astra did not repeat the real-PostgreSQL run**; it reviewed the harness
  and the recorded 4/4. If a later change touches locking, run it again and
  say so.

---

## 5. Stage 2 — Journal and durable text capture

### 5.1 The brief

From blueprint Section 13: standalone and linked Journal entries, source
preservation, revisions, paginated views, author and date metadata, and a
shared write service. Replace visible Notes terminology in the affected
surfaces. Migrate old notes; keep unrelated CRM features stable. Add
durable processing state without mock intelligence.

Exit evidence: A01, A02, the capture-durability half of A08, A20, A22, A23;
truthful save errors with retained drafts; a mobile and desktop Journal
review. Text capture must remain useful with the model disabled.

Sections 4 (domain model), 5 (pipeline steps 1–3 and the lifecycle), 6
(Journal experience), 8 (retention) and 11 (migration steps 4–6) of the
blueprint are the design input. Section 14 lists the defaults Stage 2 is
expected to settle: the job execution model (with Stage 3) and the Journal
deletion policy.

### 5.2 What exists today that Stage 2 touches

**The `notes` table** (`supabase/migrations/20260819120000_init.sql`):
`id`, `owner_id` (retired, never populated), `opportunity_id`,
`company_id`, `raw`, `ai_extracted jsonb`, `dismissed`, `applied`,
`created_at`, `updated_at`, plus `organization_id` from Stage 1. Both link
columns are composite same-organization foreign keys **with `on delete
cascade`** (`20260920120000_organizations.sql`, the `notes_*_fkey`
constraints): deleting a prospect or company deletes its notes today. That
is the A20 problem. Stage 1 fixed the same thing for tasks with `on delete
set null`; the blueprint wants a tombstone link for Journal evidence.
`notes_organization_idx (organization_id, created_at desc)` exists.

**Three kinds of rows already live in `notes`.** Stage 2's migration has to
label them honestly rather than treat them all as a person's entry:

1. Entries typed in the prospect drawer (`DetailDrawer.tsx`, `addNoteEntry`
   around line 101). No author was ever recorded; A22 says they stay
   author-unknown.
2. System lines the drawer writes when a next step changes: `Nästa steg: …`
   / `Next step: …` (`DetailDrawer.tsx` around line 258, copy key
   `nextStepLogged`).
3. Synthetic timeline lines written by the MCP `log_outreach` tool:
   `[<date> · <channel> · <colleague>] <summary>` (`lib/crm/service.ts`
   around line 279), inserted beside the real record of the interaction in
   `crm_interactions` (`occurred_on`, `channel`, `summary`, `followed_up_by`,
   source identity, unique on source message). The note is a display
   duplicate of the interaction.

Whether any row carries `ai_extracted` is unknown until rehearsal; the only
producer was the unreferenced mock, so expect none, but count rather than
assume (blueprint Section 11 step 5: historical extraction is unverified
metadata, never retroactively executed).

**The `Note` type and mapper.** `lib/types/index.ts` (`interface Note`,
around line 87) and `fromNoteRow` / `toNoteInsert` / `toNoteUpdate` in
`lib/db/mappers.ts` (around lines 265–300).

**Write path today.** Store actions `addNote`, `dismissNote`, `applyNote`,
`deleteNote` in `lib/store/store.ts` (around lines 758–830) call the Server
Actions `createNote`, `updateNote`, `deleteNote` in `app/actions/crm.ts`
(around lines 642–690). `applyNote` is the first-match path the blueprint
names for removal (it finds a company by name, then the first opportunity of
that company); it and `dismissNote` are called only from
`SuggestionPreviewCard.tsx`, which no page renders. Stage 3 owns the
replacement of the apply semantics, but nothing stops Stage 2 from deleting
dead code once the new write service exists.

**The mock.** `components/crm/CaptureBox.tsx` fakes an 800 ms extraction
and attaches a random `mockExtractions` entry to any text over 30
characters; `components/crm/SuggestionPreviewCard.tsx` renders it;
`lib/mock-data/notes.ts` seeds demo notes with `aiExtracted`. None of the
three is referenced by a page. Retire them; do not activate them.

**The dashboard chat** (`app/dashboard/page.tsx`): component-state
messages with keyword-matched scripted replies (around lines 39–95, copy
under `dashboard.replies`), and a microphone button using the browser's
`SpeechRecognition` (around line 325). Nothing it does is saved. The
blueprint's main-workspace composer (Section 6) replaces this. Voice is
Stage 4 and must go through the server pipeline with server-side
credentials, so the browser recogniser has no future; whether Stage 2
removes the button or leaves an honest disabled state is a question for
Hai (A24 forbids fake transcripts either way).

**The prospect timeline.** `components/crm/NotesTimeline.tsx` (63 lines)
renders `raw`, a timestamp and a delete button; it is used only from
`DetailDrawer.tsx` (line 670), whose inline composer is the "Prospect
Journal with inline composer" the blueprint asks to evolve. The drawer's
`notes` prop is a live store selection, so a new Journal slice has to feed
it the same way or the drawer changes shape.

**Readers of `notes` outside the UI.**

- `lib/db/queries.ts`: the whole-table snapshot (`select * from notes …`,
  around line 139) and the version probe (around line 453).
- `lib/crm/service.ts` `getRecord`: prospects return the latest 20
  non-dismissed notes (around line 74). The blueprint wants bounded history
  with cursors and coverage, not "latest 20" (A21 is Stage 5, but the read
  contract is set here).
- `lib/mcp/export.ts` (around line 72) and `lib/export-prospects.ts`
  (`notesFor`, around line 381): the prospect CSV export flattens notes
  into a column. `tests/mcp.test.ts` has three export tests that will tell
  you if this breaks.
- The MCP tool descriptions in `lib/mcp/server.ts` and
  `docs/remote-mcp.md` mention notes by name.

**Copy.** `lib/i18n/translations.ts` holds `crm.notes`, `crm.capture` and
`crm.suggestion` in Swedish (around line 517) and English (around line
862), plus the drawer's `addNote` and `nextStepLogged`. The Swedish word is
also "journal"; the sidebar and any page titles are where the terminology
becomes visible.

**Time.** `instrumentation.ts` pins the server to `Europe/Stockholm`, and
`organizations.timezone` exists since Stage 1 (Khyte is
`Europe/Stockholm`). Event dates and date precision (blueprint Section 4)
should resolve against the organization's timezone, not the server's, so a
second organization is not silently Swedish.

**Idempotency pattern to reuse.** The MCP service derives deterministic ids
from `requestId` (`generatedId` in `lib/crm/service.ts`) and stores
receipts in `crm_tool_receipts` so a retry returns the original result
(A09). A capture's client-generated request key should work the same way:
a unique index on `(organization_id, request_key)` and an insert that
returns the existing row on conflict.

### 5.3 Traps found during Stage 1 that bite Stage 2

- **Migration filenames and the promoted cleanup.** `migrationFiles()` in
  `tests/support/migrations.ts` applies migrations in filename order but
  *truncates the list* at the cleanup file once it is promoted into
  `supabase/migrations/` (`files.slice(0, promoted)`). The cleanup is
  currently named `20260927120000_…`. A Stage 2 migration named with a later
  timestamp would therefore never be applied by the PGlite suites after
  promotion, while `db:push` would apply it. `scripts/pg-concurrency.mjs`
  already does the right thing (filter the cleanup out, apply everything
  else, then the cleanup). Align the helper to that before adding a
  migration, or name Stage 2's migration so it sorts before the cleanup and
  say so in the deploy notes. The first option is the durable one.
- **The scoping lint's table list comes from the cleanup file.**
  `organizationTables()` in `tests/scoping.test.ts` reads the nineteen
  `alter column organization_id drop default` statements and asserts
  exactly nineteen. New Journal tables will not be in that file (they are
  born without a default), so the lint would not check statements against
  them. Extend the source of the list (for example, also collect tables
  whose `create table` in any migration declares an `organization_id`
  column) rather than relaxing the count.
- **New tables never carry a rollout default.** The default on the nineteen
  existing tables exists only to let the old build insert during the
  deploy window. A table created in Stage 2 has no old readers; give it
  `organization_id uuid not null references organizations (id)` with no
  default, and composite keys to any parent it links.
- **The rollout guard blocks a second organization** until the cleanup
  runs. Suites that need two organizations call `finishRollout` first;
  copy that pattern from `tests/mcp.test.ts`.
- **`--conditions=react-server`** is required to import `server-only`
  modules in tests; the store suite must not have it. If a new module is
  needed by both, split it as `lib/org/administration.ts` was split from
  `app/actions/members.ts`.
- **PGlite has no pgcrypto**; `readSql` strips the extension line. Prefer
  `gen_random_uuid()` (built in) and avoid other extensions.
- **`AuthContext` is React-cached per request** (`getAuthContext`), and
  the Zustand store is per request (`lib/store/provider.tsx`). A long
  Journal list must not be held in the request-scoped store as a whole.
- **`updated_at` triggers** (`set_updated_at`) exist on every table; a
  new table wants one too if it is to take part in any version probe.

### 5.4 A recommended shape

A proposal to put in front of Hai, not a decision. It follows blueprint
Section 4 and keeps Stage 3's needs in view.

- **Tables**, all organization-scoped with composite keys:
  `captures` (author, channel `text` for now, original text, `received_at`,
  `request_key` unique per organization, processing state);
  `journal_entries` (capture, title, body, entry kind
  `conversation | observation | idea | decision | update`, `occurred_on`
  with a precision column, `revision`, author, `legacy_kind` for migrated
  rows); `journal_entry_revisions` (who changed what, when, from which
  revision); `journal_entry_links` (entry → target with a target type
  restricted to the existing entities, the target id as a composite
  same-organization key with `on delete set null`, and a retained target
  label so the row survives as a tombstone).
- **Processing state** as a column with an explicit "not requested" value
  for Stage 2. Nothing in Stage 2 processes anything; `queued`,
  `interpreting`, `ready`, `needs_clarification`, `failed` are defined now
  and written by Stage 3. The UI shows no AI status for an entry whose
  state is "not requested".
- **One write service** in `lib/journal/` (pure of Next, taking `Database`
  and an actor, like `lib/org/administration.ts`), used by the Server
  Action and, later, by MCP and the internal agent. Acknowledge only after
  the capture row and the entry row have committed in one transaction.
- **A read path with cursors**: a Server Action or route that returns a
  page of entries for the organization, optionally filtered by a linked
  target, with a cursor and a coverage statement; a small store slice for
  the pages currently on screen; the prospect drawer reads its filtered
  view through the same path. `notes` leaves the snapshot and the version
  probe once the migration has run, and the Journal gets its own version
  signal or none (a page shows what it loaded and when).
- **Migration of `notes`**: same ids, same text, same `created_at` as
  `received_at` *and* as the entry's occurrence date at day precision
  (that is what the timestamp meant); author unknown; kind `update` for
  drawer entries; the two system-generated shapes marked by `legacy_kind`
  and, for the outreach lines, linked to their `crm_interactions` row by
  the deterministic id relation (`generatedId(requestId, 'note')` and
  `generatedId(requestId, 'interaction')` share a `requestId`; the receipt
  has it). Run it twice in the migration suite, as
  `tests/organization-migration.test.ts` does for Stage 1. Keep the
  `notes` table in place, read by nothing, until the deployed build is
  verified; drop it in a later follow-up, never in the same deploy.
- **The `log_outreach` synthetic note** becomes a Journal entry written
  through the shared service (kind `update`, linked to the prospect and the
  interaction, author = the connection's account, performer = the named
  colleague), or stops being written at all now that the interaction
  itself can be shown. Either is defensible; ask.

### 5.5 Questions to put to Hai before coding

1. Branch from `feat/organization-foundation` or from `master` after
   merging Stage 1? Is the Stage 1 deploy happening before Stage 2 lands?
2. Migrate `notes` in place (keep the table as the entry table and extend
   it) or into new tables with the same ids? The recommendation is new
   tables with the same ids and the old table left standing until the
   build is verified.
3. What does deleting a prospect do to its Journal evidence: unlink and
   keep (tombstone), or archive? The blueprint's default is unlink and
   keep.
4. The dashboard: does the composer replace the chat panel entirely in
   Stage 2, and does the microphone button go now or become an honest
   disabled control until Stage 4?
5. The `log_outreach` timeline note: convert, or stop writing it?
6. Terminology in Swedish: "Journal" everywhere the UI now says
   "Anteckningar"?
7. Deployment target for later background work: the environment notes
   assume Vercel (`.env.example`, `docs/database.md`). Stage 2 only needs a
   state column, but the job runner choice in blueprint Section 14 is due
   by Stage 3 and shapes whether captures get an outbox row now.

### 5.6 Exit evidence to produce

Deterministic suites on PGlite for: a standalone entry (A01); one entry
with two valid links and no duplicated source (A02); a capture that commits
even when nothing further runs (A08's durability half); prospect deletion
leaving the entry and a tombstone link (A20); legacy notes migrated with
text, dates and unknown authors, twice (A22); persistence across reload
(A23, at least through the read path returning what was written); a retry
with the same request key returning the same entry; a save that fails
reporting failure and the client keeping the draft. Extend the scoping lint
to the new tables. Keep every Stage 1 suite green and run the
real-PostgreSQL suite if any lock path changed. Manual review of the
composer and the Journal on a phone-width viewport and on desktop, with
what was checked written down.

---

## 6. Stages 3–5: what to keep in mind while building Stage 2

**Stage 3 — interpretation and authorized actions.** Everything Stage 2
stores must carry provenance Stage 3 can point at: the capture revision,
source spans over the original text, and the entry's revision at the time
of interpretation. The shared command layer already exists for MCP
(`lib/crm/contracts.ts` schemas, `lib/crm/service.ts` `prepare` /
`previewAction` / `commitAction`, receipts, `expectedVersion` checks,
`lib/mcp/security.ts` preview tokens); the blueprint says adapt MCP to the
domain model rather than design around the MCP schema, so expect these
contracts to change shape, not to be discarded. `applyNote` in the store is
removed here at the latest. The reported-commitment policy (Section 5's
matrix) is an explicit, inspectable setting, not a default in a prompt.
Undo is a compensating command with its own receipt. The provider goes
behind a small adapter with model and prompt versions recorded; choose
models from official documentation at the time. Model evaluation uses a
curated bilingual utterance set and is reported separately from the
deterministic suites. Exit evidence is A03–A14 and A25.

**Stage 4 — voice.** Transcription happens server-side through the same
capture pipeline; the browser recogniser in the dashboard is not a
starting point. Audio is temporary by default with a documented TTL. Upload
bounds, cancellation, interrupted-upload retry and honest failure states
(A24) are the bulk of the work; fidelity on Swedish/English switching, names
and negations decides the provider. Measure and publish latency by segment.

**Stage 5 — memory and suggestions.** Summaries are rebuildable projections
with source ids and versions; assertions track validity and supersession;
suggestions deduplicate by organization, type, target and evidence change,
with dismiss and snooze. The repeated-need threshold starts at three
distinct customers. Retrieval uses exact lookups and indexed text search
first; semantic indexing only when evaluated examples justify it. The
current-state-versus-events rule in [current_state.md](current_state.md)
applies to every number a suggestion cites. Correction or deletion of a
source must propagate (A19), which is why Stage 2's links and revisions
need stable ids now.

Sizing, as told to Hai after Stage 1: Stage 1 was roughly a fifth of the
whole, and Stage 3 is the largest of the remaining four.

---

## 7. Working the repository

| Task | Command |
| --- | --- |
| Typecheck | `npx tsc --noEmit` |
| Build | `npm run build` |
| Unit and behaviour suites | `npm test` (mcp, org, scoping, store) |
| HTTP transport suite | `npm run build` then `npm run test:mcp:http` |
| Real-PostgreSQL concurrency | `npm install --no-save embedded-postgres` once, then `npm run test:postgres` |
| Pending migrations, read-only | `npm run db:status` |
| Apply migrations (only when Hai says so) | `npm run db:push` |
| Members from the terminal | `npm run org:members -- list \| add \| revoke \| reset-password …` |

Adding a migration: a new file in `supabase/migrations/` with a timestamp
later than `20260920120000`, additive, `organization_id` without default on
new tables, composite keys to parents, RLS enabled with a membership policy
through `public.is_org_member` (copy the Stage 1 policy shape), an
`updated_at` trigger, and the deploy order written into the stage doc.
Then the migration helper and the scoping lint (Section 5.3) before the
first test.

Adding a PGlite suite: copy the setup from `tests/mcp.test.ts` (PGlite in
memory, `applyMigrations`, `finishRollout` if two organizations are needed,
a `Database` adapter over PGlite, `connect()` for a real OAuth principal),
add an npm script with `--conditions=react-server`, and add it to `npm
test`.

Windows notes: the shell is PowerShell 5.1 (no `&&`); Git Bash is
available for POSIX scripts. tsx cannot run top-level `await` in a `.ts`
scratch file; use `.mts` inside the repository. ESM absolute imports on
Windows need `file://` URLs.

---

## 8. What Astra looks for

Three review rounds on Stage 1 found, in order: credentials revived by a
re-add; MCP writes continuing after a revocation; the client store merging
another identity's snapshot; two organizations claiming one account without
serialization; a last-owner check outside the lock; the cleanup migration
placed where `db:push` would apply it early; missing rollback notes; member
actions without the scope check; a lock order that could deadlock between
token exchange and revoke; `revokeToken` outside the account lock; recovery
that inferred the outcome from the exception instead of reading the
database; and finally a reconciliation that accepted *any* membership as
its own rather than the one it wrote. Each round also checked that the
evidence table matched commands actually run.

The pattern: concurrency across two real connections, identity boundaries
on every path including the ones nobody clicks, honesty after partial
failure, and executed evidence over reasoned evidence. Build Stage 2 with
those four questions asked of every write path before Astra asks them.
