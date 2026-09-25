# Donna — handoff after Stage 2

**Date:** 2026-09-25
**Branch:** `feat/journal` at `442bc34`, pushed, working tree clean, not merged to `master`
**Status:** Stage 2 (Journal and durable text capture) accepted as code by Astra on 2026-09-25, after four correction rounds. Stage 1 is still in PR #31, not merged. Nothing is deployed. Stage 3 not started.
**Blueprint:** [Donna-Product-Architecture-and-Fable-Handoff-v1.md](Donna-Product-Architecture-and-Fable-Handoff-v1.md)
**Stage 2 record:** [journal.md](journal.md) · **Stage 1 record:** [organization-foundation.md](organization-foundation.md) · **Previous handoff:** [donna-handoff-after-stage-1.md](donna-handoff-after-stage-1.md)

This document is for the agent that picks Donna up from here. It says where
the work stands, what has to happen before Stage 3 code is written (a deploy
sequence that is Hai's to run), what Stage 2 left behind and why, the traps
Stage 3 will meet in the code as it stands, and what the review process has
taught about how this project is judged. It was written by the agent that
built Stage 2; where it recommends, it says so, and the decision is Hai's.

---

## 1. Where things stand

| Stage | Purpose | State |
| --- | --- | --- |
| 1 | Organization foundation: identity, membership, organization scope on every path | Accepted 2026-09-21 (`4a95dc5`); PR #31 to master open, not merged, not deployed |
| 2 | Journal and durable text capture | Accepted 2026-09-25 (`442bc34`) on `feat/journal`; not merged, not deployed |
| 3 | Interpretation and authorized actions | Next. Deploy 1 and 2 first (Section 3), then plan and questions, then code |
| 4 | Voice | Not started |
| 5 | Memory and useful suggestions | Not started |

`feat/journal` was cut from `5b54cce`, which is Stage 1 merged with
`origin/master`. Its commits, each one review round:

| Commit | What it did |
| --- | --- |
| `a9b1e1b` | Stage 2 as built: Journal tables, service, Server Actions, MCP tool, composer, feed, drafts, migration with backfill of `notes`, follow-up that drops `notes` |
| `f36b90c` | Round 1 — Astra's eight findings (R1–R8): text kept while a save is pending, the editor pinned to the revision it opened on, browser mutations refused after revocation, the poller not consuming a colleague's line, and evidence wording |
| `b40ac63` | Round 2 — two text-loss cases in the composer and editor; only the words typed after a saved sentence stay in the box |
| `8082ed0` | Round 2 — the Journal actions report a dead session as `unauthorized` instead of throwing it (found on screen; a fourth scoping lint keeps it so) |
| `57f27fa` | Round 3 — drafts rebuilt around ownership: one storage slot per draft, one owner per tab, no rule that drops typed words; the choreography in `lib/journal/draft-box.ts` driven directly by the store suite |
| `442bc34` | Round 4 — the owner's copy of its draft is reconciled on mount, so a parked drawer no longer loses its words |

At acceptance Astra independently ran 188 automated tests, the typecheck and
the production build. Astra did not rerun the browser checks or the
real-PostgreSQL concurrency suite in the last two rounds; the record says
when each was last run and by whom. The two documented draft limits (Section
5) were judged non-blocking.

---

## 2. How this project is run

Hai's rules from Stage 1 stand; Stage 2 added to them. None are suggestions.

- **One stage per branch and session.** Use the `/implement` skill. Read the
  blueprint, the previous stage's record and this handoff, audit the branch,
  present a short plan, then put the questions that change the architecture
  to Hai with `AskUserQuestion` (rounds of up to four, recommended option
  first) before writing code. Do not re-ask canon that blueprint Section 2
  settles. Do not pull later-stage features into an earlier stage.
- **Agent budget.** One lead (you) owns the design and every decision. Shared
  contracts are fixed by you, in writing, before anyone implements. One
  implementer per phase; parallel implementers only with disjoint files.
  Review with a few reviewers of distinct scope, each followed by one
  *batched* skeptic that tries to refute every finding in that reviewer's
  list. Never fan out per finding: a 98-agent audit on Stage 2 was stopped
  mid-run and Hai's guidance is recorded in the project memory. The useful
  outcome is validated findings and resolved risks, not an agent count.
  Spawned agents run on Opus (`model: 'opus'`); your own replies stay at
  normal detail.
- **Ultracode is on.** Substantive work goes through the Workflow tool
  (contract → implement → review → verify), with you auditing the result.
  In Stage 2 the shape that worked: one Opus implementer per batch, then one
  Workflow per review pass. Implementers stall on long edits (the stream
  watchdog kills them after ten minutes without progress); resume them with
  `SendMessage` and ask for edits under about eighty lines and trimmed test
  output. The same agent carried all five round-3/4 batches; its context was
  worth keeping.
- **Reviews find real things every round.** Stage 2's draft model went
  through four review passes, and each found a new duplicate-filing or
  text-loss path in the newest code. Do not stop reviewing because the tests
  are green; stop when a pass returns only notes. Have reviewers drive the
  production module, not a stand-in — the first round-3 pass found the test
  stand-in already drifting from the component.
- **Commit and push only when asked.** Hai asks for a commit when the stage
  is ready for Astra, then for a push, then pastes Astra's findings back.
  Each review round is one bounded correction commit, verified, then pushed.
  A follow-up found before the push is folded in by amend; after the push it
  is a new commit.
- **Report in the Senior Engineer Implementation Report format**, and per
  stage return what blueprint Section 13 asks for. Say what was *not* run.
  Astra checks evidence against claims and finds the gap: in round 1 the
  PostgreSQL sentence and the manual-review wording were both corrected.
- **Secrets.** Never print, inspect or paste values from `.env.local`; key
  names only. Never edit it. Tests never load it and never contact a remote
  database. The only production contact allowed without Hai's explicit
  instruction is the read-only `npm run db:status`. The local review stack
  has its own throwaway env file under an untracked folder (Section 7).
- **Migrations ship with their code**, in the same deploy window, additive
  only. Never `--include-all`. A migration applied ahead of its code once
  dropped a column the deployed query still read and took the CRM down. The
  Stage 2 record's deploy order (Section 3) is written with that in mind.
- **Never invent account mappings.** Which email is Erik and which is Abdi
  is Hai's to state.
- **Hai signs in.** Never type a password in the browser; give Hai the URL
  and the account and wait. Hai's pronouns have not been stated; use
  they/them. Hai is `hai@khyteteam.com`.

Attribution for commits: end commit messages with
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (or the line your
own session specifies).

---

## 3. Before Stage 3 code: the deploy sequence

This is Hai's to run, in this order, and Stage 3 should not start on a
branch that assumes any of it happened until it has. Stage 3 branches from
the tip that has both stages merged.

1. **Merge PR #31** (Stage 1 to `master`). Then merge `feat/journal` (or open
   its PR); it already contains Stage 1.
2. **Deploy Stage 1** by the five steps in [organization-foundation.md](organization-foundation.md),
   including promoting the rollout cleanup follow-up
   (`supabase/followups/20260927120000_drop_organization_rollout.sql`) only
   after the Stage 1 build is verified. Stage 1's `npm run org:members` adds
   the real accounts; Hai states the mappings.
3. **Deploy Stage 2**, per the record's deploy order:
   - `npm run db:status` must list `20261001120000_journal.sql` as the only
     pending migration, sorting after every applied one. If the Stage 1
     cleanup was promoted with a later version, rename the journal file to
     sort later still before pushing. Then `npm run db:push`. The migration
     prints the backfill counts; record them in `journal.md`.
   - Deploy the Stage 2 build in the same window. Until it is live the old
     build keeps writing `notes`; nothing is lost.
   - After the deployed build is verified, and not in the same deploy,
     promote `supabase/followups/20261101120000_drop_notes.sql` into
     `supabase/migrations/` (renamed to sort after the journal migration) and
     push it. It re-runs the backfill, refuses to drop while any `notes` row
     lacks an entry, drops `notes`, then the function. Record its counts.
   - Rollback before that last step: redeploy the old build; `notes` is
     intact and the follow-up reconciles later. After it: forward only.
4. **Only then Stage 3.** Its first migration sorts after the promoted
   follow-ups.

---

## 4. What you inherit from Stage 2

Everything below is in the record with its reasons; this is the map.

**Data.** `captures` (one per submission: `source` typed|mcp|legacy, a
`request_key` unique per organization, a `request_fingerprint`, and
`processing_state`, `not_requested` on every row today), `journal_entries`
(origin person|system, kind, `occurred_precision` exact|day|month|unknown with
`occurred_on`/`occurred_at`, `revision`, `system_event`, the `legacy_*`
columns carried over from migrated notes, `deleted_at` for redaction),
`journal_entry_revisions`, `journal_entry_links` (typed target columns, a
tombstone label when the target goes, `relationship` written as `about`,
`evidence_*` columns written null). Composite `(id, organization_id)` keys,
RLS through `public.is_org_member`, as Stage 1 laid down. The backfill is
`journal_migrate_notes()`; `notes` still stands until the follow-up.

**Service** (`lib/journal/service.ts`). `writeEntry` is idempotent on the
request key: an identical retry replays the original entry (`replayed`), a
retry with different words answers `request_key_conflict` with the entry the
key produced. `WriteRefused` rolls back. `assertLiveSession` re-checks the
session and membership generation inside the transaction, under the account
lock (lock order organization → account → rows, `lockAccount`). Errors are a
closed set: `not_found | deleted | request_key_conflict | revision_conflict |
target_not_found | invalid | unavailable | system_entry | unauthorized`.
Reads are keyset-paged with a `JournalCoverage` stamp. `changeNextStep`
writes the prospect and its system line in one transaction.

**Server Actions** (`app/actions/journal.ts`). Auth → scope → configured →
service, in that order; errors are *reported*, never thrown. The session is
resolved with `getAuthContext()` and a missing one is reported as
`unauthorized` — `requireAuth()` throws, and a thrown action reaches the
browser as a message the store cannot read; the fourth scoping lint keeps
`requireAuth(` out of this file. New Server Actions in Stage 3 must follow
the same shape, and any new SQL file goes into the scoping lint's list with
its floors.

**MCP** (`lib/mcp`). `Plan.after` in `commitAction` is where a tool commit
does Journal work under the same account lock; `list_journal` and
`get_crm_record.journal` are the bounded reads; `log_outreach` writes a
system entry through the shared service. Receipts written before Stage 2
replay in the old `notes` shape.

**Client.** A normalized Journal slice (`journal.entries` + views of ids).
`JournalSync` polls `/api/journal/version` every twelve seconds, skips while
`document.hidden`, defers while somebody types (`journalTyping`, held while a
box has focus and for five seconds after a keystroke) and never marks a stamp
seen until the refresh applied. The composer and the card editor settle
answers against what the box holds when the answer arrives, never against the
closure (`settleSave`, `settleEditSave`). Drafts (`lib/journal/drafts.ts`,
`draft-box.ts`, `composer-state.ts`): one localStorage slot per draft keyed
`khyte:journal-draft:<org>:<user>:<surface>:<requestKey>`; one owner record
per tab and surface in sessionStorage carrying the tab's own copy of the
draft; `followStorage` (adopt | restore | fork | ignore) for live cross-tab
changes and `reconcileOnMount` for a surface coming back; a fork carries the
key it left (`forkedFrom`) so a Save of the same words replays rather than
duplicating; an answer or refusal reaching an unmounted box is handed to the
live box on the same surface when it holds the sent words. The invariant, held
across a drawer switch and a reload: no rule removes words typed in a tab and
not saved. Read the header comments in those three files before touching
them; every rule has a reason and a test.

**Tests.** `npm test` runs mcp 51, org 7, scoping 4, store 68,
journal:migration 14, journal 41; `npm run test:mcp:http` 3 after a build;
`npm run test:postgres` 5 (embedded PostgreSQL, two real connections; last
run in round 1, since no SQL changed afterwards). The store suite drives the
production `DraftBox` with one shared localStorage fake and one sessionStorage
fake per tab; keep that pattern rather than a stand-in. Screenshots from the
manual reviews are in `docs/review/stage-2/`.

---

## 5. Carried forward from Stage 2, deliberately

From the record's known limits and deviations:

- No interpretation, cleanup or extraction: `processing_state` is
  `not_requested` everywhere and the UI shows nothing for it. One capture
  produces one entry. The job runner (blueprint Section 14) is deferred to
  Stage 3 with `processing_state` as the only commitment.
- Links are made by the composer's context (the open prospect) and by the
  MCP tool; the link and unlink actions exist for a picker that does not
  exist yet. Link chips are labels, not navigation, until every record has a
  stable route.
- `month` and `unknown` precision have no UI; the composer writes `exact` or
  `day`.
- The Journal has no full-text search (Stage 5).
- "Capture revision" is encoded as entry revisions over an immutable
  capture; the blueprint's `channel` is `source` here because `channel`
  already means the contact channel on `crm_interactions`.
- Two draft limits, judged non-blocking: signing out in one tab leaves
  another open tab restoring its typed words under that identity until the
  next sweep; two tabs typing different words under one shared key end with
  two drafts, and nothing decides which was meant.
- Hai's idea, not scheduled: a chat bubble in a bottom corner replacing the
  removed dashboard chat panel. Do not build it into Stage 3 unasked.

---

## 6. Stage 3 — Interpretation and authorized actions

### 6.1 The brief

Blueprint Section 13: turn text into linked context and appropriate business
changes. Implement cleanup, structured interpretation, entity resolution,
bounded retrieval, clarification, action planning, transactional commands,
receipts and safe undo; adapt the MCP contracts to these domain rules. Exit
evidence: A03–A14, A25 and a model evaluation report; demonstrate exact
before/after changes and conflicts; verify UI and MCP follow the same rules.
Section 14 lists the defaults that need validation rather than renewed
discovery — the job runner, the commitment-to-task policy, model and provider
choice by measured bilingual performance and cost.

### 6.2 What exists today that Stage 3 touches

- `captures.processing_state` and its five values; `journal_entries.revision`
  with the revisions table for evidence spans to point at;
  `journal_entry_links.relationship` and `evidence_*`, written `about`/null so
  far; `month`/`unknown` precision for resolved dates; `legacy_kind`,
  `legacy_extraction`, `legacy_dismissed`, `legacy_applied` on migrated
  entries (the old notes' extraction, kept as data, never re-applied).
- `Plan.after` in `commitAction`: the only place a tool commit does Journal
  work, under the account lock and its revalidation.
- The composer's `CreateEntryInput` and the service's `writeEntry` are the
  single way text enters; Stage 3 reads captures and writes interpretations,
  it does not open a second door.
- The scoping lint (`tests/scoping.test.ts`) with its SQL file list and
  statement floors; the `unauthorized`-report lint on the Journal actions.

### 6.3 Traps found during Stage 2 that bite Stage 3

- **Idempotency is by request key and fingerprint.** Anything Stage 3 writes
  on behalf of a capture must be idempotent on the same terms, or a retried
  job produces a second interpretation. The service's replay path is the
  model to copy.
- **Lock order and revalidation.** Organization → account → rows, and the
  session re-checked inside the transaction. A job runner that writes without
  a session needs an actor of its own (`source: 'mcp'`-like), and the
  service's `unauthorized` gate must not be bypassed for browser-originated
  work.
- **Reported, never thrown.** Any new Server Action resolves the session with
  `getAuthContext()` and reports `unauthorized`; the lint will catch
  `requireAuth(` in the Journal actions file, but not in a new file — extend
  it.
- **The store acts on codes.** `unauthorized` keeps drafts and reloads;
  `context_mismatch` clears them; everything else is a sentence next to the
  text. New refusal kinds need a code, a sentence in both languages
  (`lib/i18n/translations.ts`), and a place in `isIdentityRefusal` or beside
  it.
- **Text belongs to whoever typed it.** Interpretation must never replace the
  entry's text; it writes beside it (the blueprint's cleanup is a projection,
  the capture is immutable). Anything that rewrites `journal_entries.body`
  goes through a revision.
- **Hidden tabs do not poll.** A job that finishes while the tab is hidden
  shows up on the next visibility change; do not design a UI that assumes a
  live push.
- **The dashboard has no chat panel.** Stage 2 removed the scripted one. The
  interpretation surface is Stage 3's to design with Hai (kickoff question),
  not to reinstate.
- **Model credentials stay server-side** and out of every log; the secrets
  rule applies to any new key name too.

### 6.4 A recommended shape

Recommendation, not decision: a `jobs` table (organization-scoped, additive)
driven after commit in the same process for the first cut, with
`processing_state` advanced under the account lock and the interpretation
written as a separate row family that points at `(entry_id, revision)`; small
provider adapters chosen by a measured bilingual evaluation recorded in the
stage doc; clarification as a Journal system line with a link, so the
conversation stays in the Journal; undo as an inverse command recorded with
its receipt, never a row delete. Put the first stage doc's decision table
together the way `journal.md` does: numbered decisions, each with its
question and Hai's answer.

### 6.5 Questions to put to Hai before coding

1. Job runner: in-process after commit, a queue table with a cron, or an
   external worker — and what happens to a job when the deploy restarts.
2. Provider and model: which to evaluate, on what Swedish/English corpus,
   with what budget; where the evaluation report lives.
3. What Stage 3 does with the entries that already exist, including the
   migrated notes' `legacy_extraction`: nothing, on demand, or a backfill.
4. Where interpretation shows: on the card, in the drawer, in a panel; and
   what "clarification" looks like when the model is unsure.
5. The commitment-to-task policy default (Section 14): direct instructions
   auto-execute, reported commitments stay context — confirm or change.
6. Undo semantics and retention: how long, who may, what a receipt shows.
7. Which MCP contracts change, and whether the mobile MCP client is in scope.
8. Which acceptance scenarios (A03–A14, A25) come first.

### 6.6 Exit evidence to produce

The Section 13 return, the A-scenarios named above with executed evidence,
the model evaluation report, the PGlite suites extended (journal + a new
interpretation suite), the scoping lint covering every new SQL file, the
two-connection PostgreSQL run for every new lock path, the manual review on
the local stack with screenshots, and a stage doc in the shape of
`journal.md`.

---

## 7. Working the repository

| Task | Command |
| --- | --- |
| Typecheck | `npx tsc --noEmit -p .` |
| Build | `npm run build` |
| Unit and behaviour suites | `npm test` (mcp, org, scoping, store, journal:migration, journal) |
| One suite | `npm run test:store`, `npm run test:journal`, … |
| HTTP transport suite | `npm run build` then `npm run test:mcp:http` |
| Real-PostgreSQL concurrency | `npm install --no-save embedded-postgres` once, then `npm run test:postgres` |
| Pending migrations, read-only | `npm run db:status` |
| Apply migrations (only when Hai says so) | `npm run db:push` |
| Members from the terminal | `npm run org:members -- list \| add \| revoke \| reset-password …` |

**Local review stack** (decision 18: Docker, no staging project). Docker
Desktop is installed per user (`%LOCALAPPDATA%\Programs\DockerDesktop`, not
on PATH). Supabase CLI via `npx --no-install supabase --workdir <scratch>`
against a scratch copy of `supabase/config.toml` (seed disabled, project id
`crm-khyte-local`) plus the migrations, started with
`-x studio,realtime,storage-api,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,postgres-meta`;
`db reset --yes` puts it on the current migrations. The local stack lacks the
hosted default grants: run `grant usage on schema public …; grant all on all
tables/sequences/functions in schema public to anon, authenticated,
service_role` or REST writes answer "permission denied". Write the CLI's
keys into an untracked `.local-review/.env.local`, copy
`scripts/org-members.mjs` and `scripts/supabase.mjs` next to it (the CLI
reads the env file beside its own folder), seed one owner with `add --role
owner --colleague hai --password <generated>` and keep that password in a
scratch file, never in the repo. Run the dev server with that env exported
in the shell (shell env wins over `.env.local`). The Stage 2 sessions kept a
`local-up.mjs` in the session scratchpad that did all of this; it is not in
the repository — rewrite it from this paragraph. Tear down with `supabase
stop` (the data volume survives) and remove `.local-review/`.

**Chrome review.** Hai must sign in; give the URL and the account. Keep the
review tab in its own window: a hidden tab freezes screenshots, swallows
keystrokes and does not poll. When the tab is hidden anyway, drive the page
through its own handlers from `javascript_tool` (React-compatible input:
set the value through `HTMLTextAreaElement.prototype`'s setter, then dispatch
`input`), and say so in the record. Network conditions: wrap `window.fetch`
for requests carrying a `Next-Action` header. Watch memory: the build, the
stack, the dev server and Chrome together have made the harness kill
background shells; run the build after the suites, not alongside.

**Windows notes.** PowerShell 5.1 (no `&&`); Git Bash for POSIX scripts.
Bash heredocs in this harness drop one level of backslash escaping — write
file contents literally, never as JS-escaped strings inside a node script,
or use the Write tool for long prose. tsx cannot run top-level `await` in a
`.ts` scratch file; use `.mts`. Stray embedded-postgres processes hold ports
after a killed run; stop them before `test:postgres`.

---

## 8. What Astra looks for

Stage 1's pattern (concurrency across two real connections, identity
boundaries on every path, honesty after partial failure, executed evidence
over reasoned evidence) held. Stage 2 added four more questions Astra asked of
every round:

- **Text under every timing.** A save whose answer is slow, lost or refused;
  typing during the flight; two tabs; a reload; a drawer parked elsewhere.
  Astra reproduced each case through the component handlers or the
  production module, and a documented limit that contradicted the capture
  guarantee was not accepted as a limit.
- **Identity, not text.** Whose words are these, and which key are they
  filed under? Every draft defect traced to a rule that compared text where
  it should have compared ownership.
- **Silent duplicates count.** A second entry filed without the person
  seeing the conflict strip is a defect; one filed through the strip is a
  documented choice.
- **Evidence matches the run.** Test counts, what was and was not rerun, and
  whether the browser and PostgreSQL runs were repeated or only reported.

Build Stage 3 with those asked of every write path — and of every job that
runs without a person in front of it — before Astra asks them.
