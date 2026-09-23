-- ---------------------------------------------------------------------------
-- The Journal — durable text capture (Stage 2)
--
-- Stage 1 gave every record an organization. This migration gives the
-- organization somewhere to put what people actually say. Four tables:
--
--   captures                 the text exactly as it arrived, never rewritten.
--                            One row per thing a person (or the MCP tool)
--                            said, with the request key that makes a retry
--                            return the same row instead of a second one.
--   journal_entries          the entry that text became: kind, body, when it
--                            happened, who wrote it and who performed it.
--                            One capture -> one entry in Stage 2.
--   journal_entry_revisions  a snapshot of an entry AT each revision, row 1
--                            being "as created". Append-only. This is what
--                            "preserve user edits as revisions" means here:
--                            the capture's original_text is immutable, edits
--                            happen on the entry, and every past wording
--                            stays resolvable forever.
--   journal_entry_links      an entry's links to CRM records, as typed
--                            columns rather than a polymorphic pair, each a
--                            composite same-organization key.
--
-- THE DECISIONS THIS IMPLEMENTS
--
-- * Author and performer are two different people (Stage 1's split between
--   crm_events.recorded_by and the crm_colleague roster label). `author_id`
--   is the account that said it; `performer` is the roster label credited
--   with the activity. Both are nullable: a migrated note has no known
--   author, and an account that disappears leaves the text standing with
--   `on delete set null`.
--
-- * Event time is a triple, not a timestamp. `occurred_precision` says how
--   much of the date is actually known; `occurred_on` is the day in the
--   ORGANIZATION's timezone (not the server's), and `occurred_at` is the
--   instant, present only when the precision is 'exact'. Stage 2 writes
--   'exact' and 'day'; 'month' and 'unknown' exist so Stage 3 can record a
--   date it only half knows rather than inventing one.
--
-- * Deleting a prospect must not delete the evidence. Every link's target
--   foreign key is `on delete set null (<column>)` — the COLUMN LIST form,
--   which is mandatory here: a plain `set null` would try to null
--   `organization_id` as well and move the row out of its workspace. What
--   survives is a tombstone: the target column null, `target_type` and
--   `target_label` (the record's name at link time) kept, the entry intact.
--   This is the one behaviour the old `notes` table got wrong — its link
--   keys cascade, so deleting a deal deletes what was written about it.
--
-- * `processing_state` is a column and nothing else. Stage 2 writes
--   'not_requested' only and shows no AI status for it; the other values are
--   declared now and written by Stage 3. No jobs table until then.
--
-- * No default on any `organization_id`. The rollout default on the nineteen
--   Stage 1 tables exists only so the pre-Stage-1 build could keep inserting
--   during its deploy window, and the rollout guard re-arms on any column
--   that still has one. These tables have no older readers, so a forgotten
--   stamp must fail loudly rather than file a row under Khyte.
--
-- FILENAME RULE — READ BEFORE PUSHING. This version must sort AFTER the
-- promoted rollout cleanup (`supabase/followups/20260927120000_drop_
-- organization_rollout.sql` today, possibly a newer version when it is
-- promoted into supabase/migrations/). `supabase db push` refuses a local
-- migration older than the newest applied remote one, and `--include-all` is
-- never used here — it would apply the follow-up ahead of its code, which is
-- the single thing that arrangement exists to prevent. If the cleanup is
-- promoted with a later timestamp than this file, RENAME this file to a later
-- one before pushing. It is unapplied until then, and every suite finds it by
-- content rather than by name, so a rename costs nothing.
--
-- `notes` IS LEFT STANDING. It keeps its table, its columns and its cascade
-- keys; nothing here drops or rewrites a single row of it. The backfill below
-- copies out of it, and the deployed Stage 2 build simply stops reading it.
-- Dropping a table the running build might still select is how this CRM went
-- down once before, so the drop is a separate follow-up
-- (supabase/followups/20261101120000_drop_notes.sql), promoted only after the
-- Stage 2 build is verified live.
--
-- RESTART SAFETY. Every statement here can run twice: `if not exists`,
-- `create or replace`, guarded `do $do$` blocks for constraints, policies and
-- triggers, `on conflict (id) do nothing` and `where not exists` in the
-- backfill. `supabase db push` runs the file in one transaction, so a failure
-- rolls it back whole — but the migration suite applies this file twice on
-- purpose, and a second push after a partial rollback must be a no-op.
--
-- EDITED IN PLACE, BEFORE ANY DEPLOY (Stage 2 correction pass, 2026-09-23).
-- This file had not been pushed to any hosted database when the review asked
-- for four corrections, so they were made here rather than in a second
-- migration — the same thing Stage 1 did with its own file before its deploy.
-- The only database that ever ran the earlier text is the disposable local
-- review stack. What changed, each statement restart-safe on a fresh database
-- AND on one that ran the earlier text:
--
--   * captures.original_text's 20 000-character ceiling applies to new input
--     only (source <> 'legacy'). A legacy note of any length is copied whole;
--     refusing it would abort the whole push over a note that is valid today.
--     The constraint is reconciled by name in a guarded block below.
--   * captures.request_fingerprint (add column if not exists): the hash of a
--     write's explicit inputs, so a retry under the same request key is only
--     a replay when it asks for the same entry, not merely the same text.
--   * journal_entries.system_event (add column if not exists): which change a
--     system entry records. 'next_step_changed' is the one value today; the
--     entry's body is then the PREVIOUS next step alone and the UI supplies
--     the label. Null for every person entry and every legacy row.
--   * public.journal_try_date(text) and the outreach parse that uses it: a
--     line shaped like outreach but carrying an impossible date, or a channel
--     or colleague the tool never wrote, is migrated as an ordinary legacy
--     entry and counted as `outreach_malformed` instead of aborting the push
--     on a failed cast.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Parent keys the links need
--
-- Stage 1 gave companies, contacts, opportunities and the strategy tables an
-- (id, organization_id) key. Leads, tasks and interactions never needed one
-- because nothing referenced them; a Journal entry can be linked to all three,
-- and a composite foreign key needs a composite key to point at.
-- ---------------------------------------------------------------------------

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_id_organization_key') then
    alter table public.leads add constraint leads_id_organization_key unique (id, organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_id_organization_key') then
    alter table public.tasks add constraint tasks_id_organization_key unique (id, organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_interactions_id_organization_key') then
    alter table public.crm_interactions add constraint crm_interactions_id_organization_key unique (id, organization_id);
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- captures — the text as it arrived
-- ---------------------------------------------------------------------------

create table if not exists public.captures (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id),
  -- Null = unknown. Migrated notes never recorded who typed them, and an
  -- account that is deleted leaves its text behind rather than taking it.
  author_id        uuid references auth.users (id) on delete set null,
  -- How the text entered Donna. Deliberately NOT called `channel`: on
  -- crm_interactions that word means the contact channel (email, phone …),
  -- and one word meaning two things is how a query ends up asking the wrong
  -- question.
  source           text not null check (source in ('typed', 'mcp', 'legacy')),
  -- The ceiling is for new input only: see captures_original_text_check.
  original_text    text not null,
  received_at      timestamptz not null default now(),
  -- Client-generated for a typed capture, the MCP requestId for a tool call,
  -- 'legacy:<note id>' for a migrated row. With the unique index below it is
  -- what makes a retry return the original entry instead of a duplicate.
  request_key      text not null,
  -- Stage 2 writes 'not_requested' only. The rest are Stage 3's.
  processing_state text not null default 'not_requested'
    check (processing_state in ('not_requested', 'queued', 'interpreting', 'ready', 'needs_clarification', 'failed')),
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint captures_organization_request_key_key unique (organization_id, request_key),
  constraint captures_id_organization_key unique (id, organization_id),
  -- 20 000 characters is the composer's promise and the write service's zod
  -- limit, and it binds everything typed or sent by a tool. A migrated note is
  -- exempt: it is already somebody's text, the old drawer set no limit on it,
  -- and a backfill that refused it would abort the whole push over one long
  -- note that is perfectly valid where it stands.
  constraint captures_original_text_check check (source = 'legacy' or char_length(original_text) <= 20000)
);

comment on table public.captures is
  'The text exactly as it arrived, never rewritten. One row per thing said; (organization_id, request_key) makes a retry idempotent.';

-- A database that ran this file's earlier text has a column-level check under
-- the same name that bounded legacy rows too. Replaced by name when it is
-- that older definition, added when it is missing, left alone otherwise — so
-- a fresh database, a re-run and the old local stack all end in one state.
do $do$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.captures'::regclass and conname = 'captures_original_text_check'
                and pg_get_constraintdef(oid) not like '%legacy%') then
    alter table public.captures drop constraint captures_original_text_check;
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.captures'::regclass and conname = 'captures_original_text_check') then
    alter table public.captures add constraint captures_original_text_check
      check (source = 'legacy' or char_length(original_text) <= 20000);
  end if;
end
$do$;

-- What a retry has to match to be a replay. A sha256 over the write's
-- EXPLICIT inputs — text, title, kind, the occurrence the caller named (never
-- a default the server generated), performer, origin and the sorted link set
-- — computed by lib/journal/service.ts. The same key with the same text but a
-- different kind, date, title, performer or link set is a different request,
-- and answering it with the first entry would drop what the second one said.
-- Null on legacy rows, which were never written through a request, so a key
-- that meets one is a conflict rather than a guess.
alter table public.captures add column if not exists request_fingerprint text;

-- ---------------------------------------------------------------------------
-- journal_entries — what the text became
-- ---------------------------------------------------------------------------

create table if not exists public.journal_entries (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id),
  capture_id         uuid not null,
  -- Who said it (an account), separate from who performed the activity (a
  -- roster label). Stage 1's crm_events.recorded_by / colleague split.
  author_id          uuid references auth.users (id) on delete set null,
  performer          crm_colleague,
  -- 'system' = a line Donna wrote on someone's behalf: next-step lines and
  -- outreach lines, legacy and new. Never client-supplied; the write service
  -- sets it server-side.
  origin             text not null check (origin in ('person', 'system')),
  kind               text not null check (kind in ('conversation', 'observation', 'idea', 'decision', 'update')),
  title              text,
  body               text not null,
  -- Creation time is created_at. Event time is this triple: how precisely the
  -- date is known, the day in the organization's timezone, and the instant
  -- when there is one.
  occurred_precision text not null default 'day'
    check (occurred_precision in ('exact', 'day', 'month', 'unknown')),
  occurred_on        date,
  occurred_at        timestamptz,
  revision           integer not null default 1 check (revision >= 1),
  -- Set only on rows the notes backfill produced; null for anything written
  -- through the Journal itself.
  legacy_kind        text check (legacy_kind in ('drawer_note', 'next_step', 'outreach')),
  -- The old notes.ai_extracted. Unverified metadata from a pipeline that was
  -- never run in anger; carried so nothing is lost, never acted on, redacted
  -- when the entry is deleted.
  legacy_extraction  jsonb,
  -- The old notes.dismissed / notes.applied. Dismissed rows stay out of the
  -- feed and the export, which is exactly what they did before.
  legacy_dismissed   boolean not null default false,
  legacy_applied     boolean not null default false,
  deleted_at         timestamptz,
  deleted_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint journal_entries_occurred_check check (
       (occurred_precision = 'exact' and occurred_at is not null and occurred_on is not null)
    or (occurred_precision in ('day', 'month') and occurred_at is null and occurred_on is not null)
    or (occurred_precision = 'unknown' and occurred_at is null and occurred_on is null)
  ),
  constraint journal_entries_id_organization_key unique (id, organization_id),
  constraint journal_entries_capture_id_fkey foreign key (capture_id, organization_id)
    references public.captures (id, organization_id) on delete cascade
);

-- Which change a system entry records, when Donna wrote it on somebody's
-- behalf. 'next_step_changed' means the body is the PREVIOUS next step, alone:
-- the label ("Nästa steg" / "Next step") is the reader's dictionary's, not
-- stored copy in one language. Null for person entries, for the outreach line
-- and for every legacy row — a migrated next-step line keeps its full text,
-- label and all, exactly as it was written.
alter table public.journal_entries
  add column if not exists system_event text
    constraint journal_entries_system_event_check check (system_event in ('next_step_changed'));

-- Only Donna records a system event. A person entry carrying one would read
-- as a line nobody typed.
do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.journal_entries'::regclass and conname = 'journal_entries_system_event_origin_check') then
    alter table public.journal_entries add constraint journal_entries_system_event_origin_check
      check (system_event is null or origin = 'system');
  end if;
end
$do$;

create index if not exists journal_entries_feed_idx
  on public.journal_entries (organization_id, created_at desc, id desc);

comment on table public.journal_entries is
  'One entry per capture in Stage 2. created_at is when it was written; the occurred_* triple is when it happened, in the organization timezone.';

-- ---------------------------------------------------------------------------
-- journal_entry_revisions — the entry AT each revision
--
-- Append-only, so no updated_at and no trigger. Row 1 is the entry as
-- created; every edit appends the next. A Stage 3 interpretation names an
-- entry revision, and that wording has to stay resolvable forever.
-- ---------------------------------------------------------------------------

create table if not exists public.journal_entry_revisions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id),
  entry_id           uuid not null,
  revision           integer not null check (revision >= 1),
  title              text,
  body               text not null,
  kind               text not null check (kind in ('conversation', 'observation', 'idea', 'decision', 'update')),
  occurred_precision text not null check (occurred_precision in ('exact', 'day', 'month', 'unknown')),
  occurred_on        date,
  occurred_at        timestamptz,
  performer          crm_colleague,
  changed_by         uuid references auth.users (id) on delete set null,
  changed_at         timestamptz not null default now(),
  constraint journal_entry_revisions_entry_revision_key unique (entry_id, revision),
  constraint journal_entry_revisions_entry_id_fkey foreign key (entry_id, organization_id)
    references public.journal_entries (id, organization_id) on delete cascade
);

comment on table public.journal_entry_revisions is
  'Append-only snapshot of an entry at each revision. Row 1 is as created. The capture original_text is immutable; edits happen here.';

-- ---------------------------------------------------------------------------
-- journal_entry_links — typed columns, not a polymorphic pair
--
-- A polymorphic (target_type, target_id) pair cannot carry a foreign key, so
-- the database could not refuse a cross-organization link and a deleted
-- record would leave a dangling id nothing notices. One nullable column per
-- entity, each with a composite same-organization key, is what makes both
-- impossible. The checks keep exactly one of them populated and keep
-- target_type honest about which.
-- ---------------------------------------------------------------------------

create table if not exists public.journal_entry_links (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id),
  entry_id          uuid not null,
  target_type       text not null
    check (target_type in ('company', 'contact', 'opportunity', 'lead', 'task', 'interaction')),
  company_id        uuid,
  contact_id        uuid,
  opportunity_id    uuid,
  lead_id           uuid,
  task_id           uuid,
  interaction_id    uuid,
  -- The record's name at link time. This is what survives when the record
  -- does not: the tombstone reads "Nordvik AB (removed)" rather than going
  -- blank.
  target_label      text not null,
  relationship      text not null default 'about'
    check (relationship in ('about', 'mentions', 'evidence_for')),
  -- A span into the entry body at a named revision. Stage 3 writes these;
  -- null throughout Stage 2.
  evidence_revision integer,
  evidence_start    integer,
  evidence_end      integer,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint journal_entry_links_entry_id_fkey foreign key (entry_id, organization_id)
    references public.journal_entries (id, organization_id) on delete cascade,
  -- `set null (<column>)` — Postgres 15+ — nulls the link only. A plain
  -- `set null` would null organization_id too and move the row out of its
  -- workspace, which is why the column list is not optional here.
  constraint journal_entry_links_company_id_fkey foreign key (company_id, organization_id)
    references public.companies (id, organization_id) on delete set null (company_id),
  constraint journal_entry_links_contact_id_fkey foreign key (contact_id, organization_id)
    references public.contacts (id, organization_id) on delete set null (contact_id),
  constraint journal_entry_links_opportunity_id_fkey foreign key (opportunity_id, organization_id)
    references public.opportunities (id, organization_id) on delete set null (opportunity_id),
  constraint journal_entry_links_lead_id_fkey foreign key (lead_id, organization_id)
    references public.leads (id, organization_id) on delete set null (lead_id),
  constraint journal_entry_links_task_id_fkey foreign key (task_id, organization_id)
    references public.tasks (id, organization_id) on delete set null (task_id),
  constraint journal_entry_links_interaction_id_fkey foreign key (interaction_id, organization_id)
    references public.crm_interactions (id, organization_id) on delete set null (interaction_id),
  -- At most one target column. Zero is a tombstone: the record is gone and
  -- target_type plus target_label are what is left of it.
  constraint journal_entry_links_one_target check (
    num_nonnulls(company_id, contact_id, opportunity_id, lead_id, task_id, interaction_id) <= 1
  ),
  constraint journal_entry_links_company_type     check (company_id is null     or target_type = 'company'),
  constraint journal_entry_links_contact_type     check (contact_id is null     or target_type = 'contact'),
  constraint journal_entry_links_opportunity_type check (opportunity_id is null or target_type = 'opportunity'),
  constraint journal_entry_links_lead_type        check (lead_id is null        or target_type = 'lead'),
  constraint journal_entry_links_task_type        check (task_id is null        or target_type = 'task'),
  constraint journal_entry_links_interaction_type check (interaction_id is null or target_type = 'interaction')
);

-- One link per entry per record. Partial, so the tombstones (every column
-- null) never collide with each other.
create unique index if not exists journal_entry_links_entry_company_idx
  on public.journal_entry_links (entry_id, company_id) where company_id is not null;
create unique index if not exists journal_entry_links_entry_contact_idx
  on public.journal_entry_links (entry_id, contact_id) where contact_id is not null;
create unique index if not exists journal_entry_links_entry_opportunity_idx
  on public.journal_entry_links (entry_id, opportunity_id) where opportunity_id is not null;
create unique index if not exists journal_entry_links_entry_lead_idx
  on public.journal_entry_links (entry_id, lead_id) where lead_id is not null;
create unique index if not exists journal_entry_links_entry_task_idx
  on public.journal_entry_links (entry_id, task_id) where task_id is not null;
create unique index if not exists journal_entry_links_entry_interaction_idx
  on public.journal_entry_links (entry_id, interaction_id) where interaction_id is not null;

-- The two reads that exist: a prospect's Journal and a company's.
create index if not exists journal_entry_links_organization_opportunity_idx
  on public.journal_entry_links (organization_id, opportunity_id) where opportunity_id is not null;
create index if not exists journal_entry_links_organization_company_idx
  on public.journal_entry_links (organization_id, company_id) where company_id is not null;

comment on table public.journal_entry_links is
  'An entry to a CRM record, one typed column per entity. Deleting the record nulls the column and leaves target_type and target_label as a tombstone.';

-- ---------------------------------------------------------------------------
-- updated_at triggers
--
-- On the three tables that have an updated_at. journal_entry_revisions is
-- append-only and deliberately has neither.
-- ---------------------------------------------------------------------------

do $do$
begin
  if not exists (select 1 from pg_trigger where tgname = 'captures_set_updated_at' and tgrelid = 'public.captures'::regclass) then
    create trigger captures_set_updated_at
      before update on public.captures
      for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'journal_entries_set_updated_at' and tgrelid = 'public.journal_entries'::regclass) then
    create trigger journal_entries_set_updated_at
      before update on public.journal_entries
      for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'journal_entry_links_set_updated_at' and tgrelid = 'public.journal_entry_links'::regclass) then
    create trigger journal_entry_links_set_updated_at
      before update on public.journal_entry_links
      for each row execute function set_updated_at();
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- Row Level Security — membership, the same shape as Stage 1
--
-- Dormant today for the same reason as every other table: reads go straight
-- to Postgres and writes use the secret key, both of which bypass RLS. The
-- policies still describe the real access rule, so the day a publishable-key
-- path is opened they already say the right thing.
-- ---------------------------------------------------------------------------

alter table public.captures                enable row level security;
alter table public.journal_entries         enable row level security;
alter table public.journal_entry_revisions enable row level security;
alter table public.journal_entry_links     enable row level security;

do $do$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'captures'
                 and policyname = 'members manage their organization''s captures') then
    create policy "members manage their organization's captures" on public.captures
      for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'journal_entries'
                 and policyname = 'members manage their organization''s journal entries') then
    create policy "members manage their organization's journal entries" on public.journal_entries
      for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'journal_entry_revisions'
                 and policyname = 'members manage their organization''s journal entry revisions') then
    create policy "members manage their organization's journal entry revisions" on public.journal_entry_revisions
      for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'journal_entry_links'
                 and policyname = 'members manage their organization''s journal entry links') then
    create policy "members manage their organization's journal entry links" on public.journal_entry_links
      for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- public.journal_migrate_notes() — the notes backfill, as a re-runnable
-- function rather than a one-shot block
--
-- WHY A FUNCTION. Between `db:push` and the Stage 2 build going live, the old
-- build keeps writing `notes`; so does a rollback to it. A one-shot backfill
-- would miss exactly those rows. This function is called once here and again
-- by supabase/followups/20261101120000_drop_notes.sql, which refuses to drop
-- the table while any notes row still has no entry. Idempotent by
-- construction: `on conflict (id) do nothing` on the two id-preserving
-- inserts, `on conflict (entry_id, revision) do nothing` on the revision row,
-- `where not exists` on the links.
--
-- A MIGRATED ENTRY LOOKS LIKE ANY OTHER. The write service records revision 1
-- of every entry it creates, so the backfill records one too: same title,
-- body, kind, occurrence triple and performer as the entry, `changed_by` null
-- because nobody is known to have written it, `changed_at` the note's own
-- created_at. Without it a legacy entry would come back from getEntry() with
-- an empty history, and "no revisions" would have to mean two different
-- things depending on where the entry came from.
--
-- THREE SHAPES LIVE IN `notes`, and labelling them all as a person's entry
-- would be a lie the Journal then repeats forever:
--   1. drawer_note — typed by a person in the prospect drawer. No author was
--      ever recorded, so the entry is author-unknown rather than attributed
--      to whoever runs the migration.
--   2. next_step   — written by the drawer when a next step changed
--                    ('Nästa steg: …' / 'Next step: …').
--   3. outreach    — written by the MCP log_outreach tool beside the real
--                    interaction ('[<date> · <channel> · <colleague>] <text>').
-- The last two are origin 'system'.
--
-- A LINE SHAPED LIKE OUTREACH IS NOT NECESSARILY OUTREACH. The shape is a
-- regular expression, and a person can type `[2026-99-99 · email · hai] …` into
-- the drawer as easily as the tool can write a real one. A line counts as
-- outreach only when every field it carries is one the tool could have
-- written: a date that exists (public.journal_try_date, which answers null
-- rather than aborting the push on a failed cast), a channel from
-- crm_interactions' own list, and a roster label or 'unassigned'. Anything
-- else is migrated as what it demonstrably is — a line somebody typed, a
-- drawer_note with origin 'person' and its created_at as an exact occurrence —
-- and counted as `outreach_malformed`, so the number of lines that looked like
-- outreach and were not is on record rather than silently reclassified.
--
-- DATES. A drawer note's timestamp is all that was ever known, so the entry
-- takes it as an exact instant and its day is computed in the ORGANIZATION's
-- timezone (`at time zone o.timezone`) — a note written at 22:30 UTC on a
-- Monday belongs to Tuesday in Stockholm, and the server's own zone is not
-- the right authority for a second organization. An outreach line carries a
-- real date in its text, and nothing more precise, so it gets 'day'.
--
-- THE INTERACTION LINK. An outreach line is a display duplicate of a
-- crm_interactions row, but nothing ever recorded which one: the tool wrote
-- both and kept no reference. The link is therefore reconstructed by matching
-- the structured fields parsed out of the text against the interactions of the
-- same organization, and is written ONLY when exactly one interaction
-- matches. Two matches is not a coin toss, and the counts below report every
-- line that went unlinked so the gap is a number somebody can look at rather
-- than a silence.
--
-- `notes` rows are never modified or deleted here.
-- ---------------------------------------------------------------------------

-- A text-to-date cast that answers null instead of raising. `'2026-99-99'::date`
-- aborts the statement, and inside the backfill that would abort the whole
-- migration — one malformed legacy line holding every other row hostage.
-- Dropped by the notes-drop follow-up together with the backfill it serves.
create or replace function public.journal_try_date(p_value text)
returns date
language plpgsql
stable
as $fn$
begin
  return p_value::date;
exception when others then
  return null;
end
$fn$;

comment on function public.journal_try_date(text) is
  'The notes backfill''s date parse: the date, or null when the text is not one. Dropped with journal_migrate_notes() by the notes-drop follow-up.';

create or replace function public.journal_migrate_notes()
returns jsonb
language plpgsql
as $fn$
declare
  r                    record;
  v_seen               integer := 0;
  v_captures           integer := 0;
  v_entries            integer := 0;
  v_revisions          integer := 0;
  v_links              integer := 0;
  v_extraction         integer := 0;
  v_dismissed          integer := 0;
  v_applied            integer := 0;
  v_outreach           integer := 0;
  v_outreach_linked    integer := 0;
  v_outreach_unmatched integer := 0;
  v_outreach_malformed integer := 0;
  v_outreach_date      date;
  v_rows               integer;
  v_is_outreach        boolean;
  v_is_next_step       boolean;
  v_legacy_kind        text;
  v_origin             text;
  v_performer          crm_colleague;
  v_precision          text;
  v_occurred_on        date;
  v_occurred_at        timestamptz;
  v_matches            uuid[];
begin
  select count(*)::int,
         count(*) filter (where ai_extracted is not null)::int,
         count(*) filter (where dismissed)::int,
         count(*) filter (where applied)::int
    into v_seen, v_extraction, v_dismissed, v_applied
    from public.notes;

  for r in
    select n.id, n.organization_id, n.raw, n.created_at, n.updated_at,
           n.opportunity_id, n.company_id, n.ai_extracted, n.dismissed, n.applied,
           o.timezone,
           -- The middle dot is U+00B7, written by lib/crm/service.ts. It is
           -- matched literally; only the date, channel and colleague are
           -- captured, plus everything after the closing bracket as the
           -- summary. `.` matches a newline in a Postgres regular expression,
           -- so a multi-line summary survives whole.
           regexp_match(n.raw, '^\[(\d{4}-\d{2}-\d{2}) · ([a-z]+) · ([a-z]+)\] (.*)$') as outreach
      from public.notes n
      join public.organizations o on o.id = n.organization_id
     order by n.created_at, n.id
  loop
    -- The shape matched is not yet outreach: every field must be one the tool
    -- could have written (see the header above). A line that fails any of the
    -- three is an ordinary drawer note, counted as malformed.
    v_outreach_date := null;
    v_is_outreach   := false;
    if r.outreach is not null then
      v_outreach_date := public.journal_try_date(r.outreach[1]);
      if v_outreach_date is not null
         and r.outreach[2] in ('email', 'phone', 'meeting', 'linkedin', 'other')
         and r.outreach[3] in ('erik', 'abdi', 'hai', 'unassigned') then
        v_is_outreach := true;
      else
        v_outreach_malformed := v_outreach_malformed + 1;
      end if;
    end if;
    v_is_next_step := (not v_is_outreach) and r.raw ~ '^(Nästa steg|Next step): ';

    if v_is_outreach then
      v_legacy_kind := 'outreach';
      v_origin      := 'system';
    elsif v_is_next_step then
      v_legacy_kind := 'next_step';
      v_origin      := 'system';
    else
      v_legacy_kind := 'drawer_note';
      v_origin      := 'person';
    end if;

    -- Only a name that is actually on the roster becomes a performer. The
    -- tool writes 'unassigned' when it had nobody, and inventing a colleague
    -- from a string is exactly the guessed attribution Stage 1 forbade.
    if v_is_outreach and r.outreach[3] in ('erik', 'abdi', 'hai') then
      v_performer := r.outreach[3]::crm_colleague;
    else
      v_performer := null;
    end if;

    if v_is_outreach then
      v_precision   := 'day';
      v_occurred_on := v_outreach_date;
      v_occurred_at := null;
    else
      v_precision   := 'exact';
      v_occurred_at := r.created_at;
      v_occurred_on := (r.created_at at time zone r.timezone)::date;
    end if;

    insert into public.captures (
      id, organization_id, author_id, source, original_text, received_at,
      request_key, processing_state, created_at, updated_at)
    values (
      r.id, r.organization_id, null, 'legacy', r.raw, r.created_at,
      'legacy:' || r.id::text, 'not_requested', r.created_at, r.updated_at)
    on conflict (id) do nothing;
    get diagnostics v_rows = row_count;
    v_captures := v_captures + v_rows;

    insert into public.journal_entries (
      id, organization_id, capture_id, author_id, performer, origin, kind, title, body,
      occurred_precision, occurred_on, occurred_at, revision,
      legacy_kind, legacy_extraction, legacy_dismissed, legacy_applied, created_at, updated_at)
    values (
      r.id, r.organization_id, r.id, null, v_performer, v_origin, 'update', null, r.raw,
      v_precision, v_occurred_on, v_occurred_at, 1,
      v_legacy_kind, r.ai_extracted, r.dismissed, r.applied, r.created_at, r.updated_at)
    on conflict (id) do nothing;
    get diagnostics v_rows = row_count;
    v_entries := v_entries + v_rows;

    -- Revision 1: the entry as created, exactly as the write service records
    -- it for an entry typed today. `changed_by` is null because the old
    -- drawer never recorded who typed the note, and `changed_at` is the
    -- note's own created_at — that is when this wording came into being.
    insert into public.journal_entry_revisions (
      organization_id, entry_id, revision, title, body, kind,
      occurred_precision, occurred_on, occurred_at, performer, changed_by, changed_at)
    values (
      r.organization_id, r.id, 1, null, r.raw, 'update',
      v_precision, v_occurred_on, v_occurred_at, v_performer, null, r.created_at)
    on conflict (entry_id, revision) do nothing;
    get diagnostics v_rows = row_count;
    v_revisions := v_revisions + v_rows;

    -- The opportunity link carries the COMPANY's name, because that is what
    -- the prospect is called everywhere in this CRM.
    if r.opportunity_id is not null then
      insert into public.journal_entry_links (
        organization_id, entry_id, target_type, opportunity_id, target_label, relationship)
      select r.organization_id, r.id, 'opportunity', op.id, c.name, 'about'
        from public.opportunities op
        join public.companies c
          on c.id = op.company_id and c.organization_id = op.organization_id
       where op.id = r.opportunity_id
         and op.organization_id = r.organization_id
         and not exists (
           select 1 from public.journal_entry_links l
            where l.entry_id = r.id and l.organization_id = r.organization_id and l.opportunity_id = op.id);
      get diagnostics v_rows = row_count;
      v_links := v_links + v_rows;
    end if;

    if r.company_id is not null then
      insert into public.journal_entry_links (
        organization_id, entry_id, target_type, company_id, target_label, relationship)
      select r.organization_id, r.id, 'company', c.id, c.name, 'about'
        from public.companies c
       where c.id = r.company_id
         and c.organization_id = r.organization_id
         and not exists (
           select 1 from public.journal_entry_links l
            where l.entry_id = r.id and l.organization_id = r.organization_id and l.company_id = c.id);
      get diagnostics v_rows = row_count;
      v_links := v_links + v_rows;
    end if;

    if v_is_outreach then
      v_outreach := v_outreach + 1;
      select array_agg(i.id)
        into v_matches
        from public.crm_interactions i
       where i.organization_id = r.organization_id
         and i.opportunity_id = r.opportunity_id
         and i.occurred_on = v_occurred_on
         and i.channel = r.outreach[2]
         and coalesce(i.followed_up_by::text, 'unassigned') = r.outreach[3]
         and i.summary = r.outreach[4];

      if v_matches is not null and array_length(v_matches, 1) = 1 then
        v_outreach_linked := v_outreach_linked + 1;
        insert into public.journal_entry_links (
          organization_id, entry_id, target_type, interaction_id, target_label, relationship)
        select r.organization_id, r.id, 'interaction', v_matches[1],
               r.outreach[1] || ' · ' || r.outreach[2], 'about'
         where not exists (
           select 1 from public.journal_entry_links l
            where l.entry_id = r.id and l.organization_id = r.organization_id and l.interaction_id = v_matches[1]);
        get diagnostics v_rows = row_count;
        v_links := v_links + v_rows;
      else
        v_outreach_unmatched := v_outreach_unmatched + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'notes_seen',          v_seen,
    'captures_inserted',   v_captures,
    'entries_inserted',    v_entries,
    'revisions_inserted',  v_revisions,
    'links_inserted',      v_links,
    'with_extraction',     v_extraction,
    'dismissed',           v_dismissed,
    'applied',             v_applied,
    'outreach_total',      v_outreach,
    'outreach_linked',     v_outreach_linked,
    'outreach_unmatched',  v_outreach_unmatched,
    'outreach_malformed',  v_outreach_malformed
  );
end
$fn$;

comment on function public.journal_migrate_notes() is
  'Re-runnable backfill of public.notes into the Journal. Called by this migration and again by the notes-drop follow-up, which then refuses to drop notes while any row has no entry.';

-- The counts are the record of what the deploy actually moved. Step 2 of the
-- deploy order says to write them down; `supabase db push` prints a NOTICE.
do $do$
declare
  v_result jsonb;
begin
  v_result := public.journal_migrate_notes();
  raise notice 'journal_migrate_notes: %', v_result;
end
$do$;
