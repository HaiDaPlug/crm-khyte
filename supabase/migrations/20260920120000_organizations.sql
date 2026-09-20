-- ---------------------------------------------------------------------------
-- Organizations — the foundation under Donna (Stage 1)
--
-- Until now the CRM had one shared password and no identity: every row was
-- reachable by anyone holding it, `owner_id` was null everywhere, and nothing
-- said which business a record belonged to. This migration gives every
-- business record exactly one owning organization, gives people individual
-- accounts through Supabase Auth, and records who belongs to which
-- organization. It is the ground the Journal, capture and memory work stands
-- on: an entry, a suggestion or a receipt without an organization has nowhere
-- to belong.
--
-- ADDITIVE ON PURPOSE. Nothing is dropped and no existing column changes
-- meaning. `owner_id` stays where it is, untouched and unread, because
-- dropping it is a migration for no gain and the deploy that removed a column
-- the running code still read is how this CRM went down once before.
--
-- THE ROLLOUT DEFAULT. Every `organization_id` column is added as
-- `not null default <khyte>`. The default is what backfills the existing rows
-- (Postgres writes it into every row as part of `add column`), and it is also
-- what keeps the CRM up between this migration landing and the code that
-- writes `organization_id` explicitly being deployed: an insert from the
-- older code still succeeds and lands in Khyte, which is the only
-- organization that exists. The default is a rollout aid, not a design — a
-- forgotten insert path silently landing in Khyte is exactly the mistake a
-- second organization must not be able to make. A follow-up migration drops
-- every default once the new code is verified live; see
-- docs/organization-foundation.md.
--
-- CROSS-ORGANIZATION LINKS ARE IMPOSSIBLE AT THE DATABASE. The parent tables
-- gain a `(id, organization_id)` key and every child foreign key is rebuilt
-- as a composite `(parent_id, organization_id)` reference. A contact cannot
-- belong to another organization's company, a task cannot point at another
-- organization's deal, a strategy board cannot be linked to a foreign
-- prospect. The application filters by organization on every query; this is
-- the boundary that holds when a query forgets to.
--
-- ROW LEVEL SECURITY. The old `auth.uid() = owner_id` policies never matched
-- anything and are replaced by membership policies. They are still dormant —
-- reads go straight to Postgres and writes use the secret key, both of which
-- bypass RLS — but they now describe the real access rule, so the day a
-- publishable-key path (Realtime, a browser client) is opened, the policies
-- already say the right thing.
--
-- THE ROSTER. `crm_colleague` (erik/abdi/hai) stays as the label on tasks,
-- prospects, leads, events and interactions — that is who *did* the work,
-- and this migration does not rewrite history. A membership may carry that
-- label so a logged-in person is known as their roster entry. Mapping an
-- account to a label is an explicit act by an owner (the members UI or the
-- members script), never a guess from a first name.
--
-- LEGACY MCP CONNECTIONS are revoked below. They were approved under the
-- shared password and carry no user; a connection with no person behind it
-- cannot stay authorized once every write is attributed. Reconnecting ChatGPT
-- after logging in with an account is a one-time step.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Organizations, members, sessions
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- URL-safe handle. Not shown anywhere yet; reserved so a second
  -- organization can be addressed without exposing its id.
  slug       text not null unique,
  -- IANA zone. The server still runs on Europe/Stockholm for the existing
  -- calendar boundaries (instrumentation.ts); this is recorded per
  -- organization so a later change can be per-workspace rather than global.
  timezone   text not null default 'Europe/Stockholm',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function set_updated_at();

comment on table public.organizations is
  'A workspace. Every business record belongs to exactly one. A solo workspace is an organization with one member.';

create type org_member_role as enum ('owner', 'member');
create type org_member_status as enum ('active', 'revoked');

create table if not exists public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Supabase Auth is the identity provider; this is the account.
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            org_member_role not null default 'member',
  status          org_member_status not null default 'active',
  -- Snapshot of the account's email and the name colleagues see, kept here so
  -- the app never has to read the auth schema to render a person.
  email           text not null,
  display_name    text not null,
  -- The legacy roster label this person is known as on tasks, prospects,
  -- leads, events and interactions. Optional; set explicitly by an owner.
  colleague       crm_colleague,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index organization_members_user_idx on public.organization_members (user_id);

-- One active member per roster label per organization. A revoked member
-- releases the label so a successor can take it.
create unique index organization_members_colleague_idx
  on public.organization_members (organization_id, colleague)
  where colleague is not null and status = 'active';

create trigger organization_members_set_updated_at
  before update on public.organization_members
  for each row execute function set_updated_at();

comment on column public.organization_members.colleague is
  'Legacy roster label (crm_colleague) this member is known as. Mapped explicitly by an owner, never inferred.';

-- Browser sessions. Supabase Auth verifies the password; the app then mints
-- its own session so proxy.ts can verify a cookie without I/O and so a single
-- session can be revoked — neither of which a bare JWT cookie gives.
create table if not exists public.app_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  -- The workspace this session is acting in. A user with several memberships
  -- picks one at login.
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Keyed hash of the cookie's random token; the token itself is never stored.
  token_hash      text not null unique,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz
);

create index app_sessions_user_idx on public.app_sessions (user_id, organization_id);

-- ---------------------------------------------------------------------------
-- The Khyte organization
--
-- A fixed id, so every environment that runs this migration agrees on which
-- organization the existing data belongs to, and so the column defaults below
-- can name it. Accounts and memberships are NOT created here: which email is
-- Erik and which is Abdi is a fact only the team knows, and inventing it would
-- be exactly the guessed ownership the blueprint forbids.
-- ---------------------------------------------------------------------------

insert into public.organizations (id, name, slug, timezone)
values ('7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10', 'Khyte', 'khyte', 'Europe/Stockholm')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Organization ownership on every business and integration table
--
-- `add column ... not null default` fills existing rows in the same
-- statement, which is the backfill. The reference is plain (no cascade): an
-- organization holding data cannot be deleted by accident, and deleting one
-- deliberately is a documented operation, not a foreign-key side effect.
-- ---------------------------------------------------------------------------

alter table public.companies                    add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.contacts                     add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.opportunities                add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.notes                        add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.leads                        add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.strategy_boards              add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.strategy_board_opportunities add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.strategy_columns             add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.strategy_cards               add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.tasks                        add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.goals                        add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.goal_metrics                 add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.personal_goals               add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.crm_events                   add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.weekly_snapshots             add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.crm_interactions             add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.crm_tool_receipts            add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.crm_oauth_codes              add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);
alter table public.crm_oauth_connections        add column if not exists organization_id uuid not null default '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10' references public.organizations (id);

-- Who recorded an event, as an account. Distinct from `colleague`, which is
-- the roster label of who *did* the work — logging a call for a teammate
-- credits them and is recorded by you.
alter table public.crm_events
  add column if not exists recorded_by uuid references auth.users (id) on delete set null;

comment on column public.crm_events.recorded_by is
  'The account that recorded this event. Distinct from colleague, the roster label credited with the work.';

-- ---------------------------------------------------------------------------
-- MCP identity
--
-- A connection is approved by a logged-in person and acts as that person in
-- that organization from then on. The authorization code carries the identity
-- from consent to token exchange.
-- ---------------------------------------------------------------------------

alter table public.crm_oauth_codes       add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table public.crm_oauth_connections add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- Codes live five minutes; any without a person are simply gone.
delete from public.crm_oauth_codes where user_id is null;

-- Connections approved under the shared password have no person behind them.
update public.crm_oauth_connections
set revoked_at = now()
where user_id is null and revoked_at is null;

comment on column public.crm_oauth_connections.user_id is
  'The account that approved this connection. Null only on legacy shared-password connections, which are revoked.';

-- ---------------------------------------------------------------------------
-- Same-organization foreign keys
--
-- Each parent gains a (id, organization_id) key; each child key is rebuilt to
-- reference it. The on-delete behaviour is exactly what the original
-- single-column key had — cascade where a child cannot outlive its parent,
-- set-null (of the link column only) where it can.
-- ---------------------------------------------------------------------------

alter table public.companies        add constraint companies_id_organization_key        unique (id, organization_id);
alter table public.contacts         add constraint contacts_id_organization_key         unique (id, organization_id);
alter table public.opportunities    add constraint opportunities_id_organization_key    unique (id, organization_id);
alter table public.strategy_boards  add constraint strategy_boards_id_organization_key  unique (id, organization_id);
alter table public.strategy_columns add constraint strategy_columns_id_organization_key unique (id, organization_id);

alter table public.contacts drop constraint if exists contacts_company_id_fkey;
alter table public.contacts add constraint contacts_company_id_fkey
  foreign key (company_id, organization_id) references public.companies (id, organization_id) on delete cascade;

alter table public.opportunities drop constraint if exists opportunities_company_id_fkey;
alter table public.opportunities add constraint opportunities_company_id_fkey
  foreign key (company_id, organization_id) references public.companies (id, organization_id) on delete cascade;
alter table public.opportunities drop constraint if exists opportunities_contact_id_fkey;
alter table public.opportunities add constraint opportunities_contact_id_fkey
  foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade;

alter table public.notes drop constraint if exists notes_opportunity_id_fkey;
alter table public.notes add constraint notes_opportunity_id_fkey
  foreign key (opportunity_id, organization_id) references public.opportunities (id, organization_id) on delete cascade;
alter table public.notes drop constraint if exists notes_company_id_fkey;
alter table public.notes add constraint notes_company_id_fkey
  foreign key (company_id, organization_id) references public.companies (id, organization_id) on delete cascade;

alter table public.strategy_columns drop constraint if exists strategy_columns_board_id_fkey;
alter table public.strategy_columns add constraint strategy_columns_board_id_fkey
  foreign key (board_id, organization_id) references public.strategy_boards (id, organization_id) on delete cascade;

alter table public.strategy_cards drop constraint if exists strategy_cards_column_id_fkey;
alter table public.strategy_cards add constraint strategy_cards_column_id_fkey
  foreign key (column_id, organization_id) references public.strategy_columns (id, organization_id) on delete cascade;

alter table public.strategy_board_opportunities drop constraint if exists strategy_board_opportunities_board_id_fkey;
alter table public.strategy_board_opportunities add constraint strategy_board_opportunities_board_id_fkey
  foreign key (board_id, organization_id) references public.strategy_boards (id, organization_id) on delete cascade;
alter table public.strategy_board_opportunities drop constraint if exists strategy_board_opportunities_opportunity_id_fkey;
alter table public.strategy_board_opportunities add constraint strategy_board_opportunities_opportunity_id_fkey
  foreign key (opportunity_id, organization_id) references public.opportunities (id, organization_id) on delete cascade;

-- `set null (column)` — Postgres 15+ — nulls only the link, never the
-- organization the task belongs to.
alter table public.tasks drop constraint if exists tasks_related_opportunity_id_fkey;
alter table public.tasks add constraint tasks_related_opportunity_id_fkey
  foreign key (related_opportunity_id, organization_id) references public.opportunities (id, organization_id)
  on delete set null (related_opportunity_id);
alter table public.tasks drop constraint if exists tasks_related_company_id_fkey;
alter table public.tasks add constraint tasks_related_company_id_fkey
  foreign key (related_company_id, organization_id) references public.companies (id, organization_id)
  on delete set null (related_company_id);

-- ---------------------------------------------------------------------------
-- Indexes — every read now starts with "in this organization"
-- ---------------------------------------------------------------------------

create index if not exists companies_organization_idx                    on public.companies (organization_id);
create index if not exists contacts_organization_idx                     on public.contacts (organization_id);
create index if not exists opportunities_organization_idx                on public.opportunities (organization_id, stage, sort_order);
create index if not exists notes_organization_idx                        on public.notes (organization_id, created_at desc);
create index if not exists leads_organization_idx                        on public.leads (organization_id);
create index if not exists strategy_boards_organization_idx              on public.strategy_boards (organization_id);
create index if not exists strategy_board_opportunities_organization_idx on public.strategy_board_opportunities (organization_id);
create index if not exists strategy_columns_organization_idx             on public.strategy_columns (organization_id);
create index if not exists strategy_cards_organization_idx               on public.strategy_cards (organization_id);
create index if not exists tasks_organization_idx                        on public.tasks (organization_id);
create index if not exists goals_organization_idx                        on public.goals (organization_id, section, sort_order);
create index if not exists goal_metrics_organization_idx                 on public.goal_metrics (organization_id);
create index if not exists personal_goals_organization_idx               on public.personal_goals (organization_id, colleague, sort_order);
create index if not exists crm_events_organization_idx                   on public.crm_events (organization_id, kind, occurred_at desc);
create index if not exists crm_interactions_organization_idx             on public.crm_interactions (organization_id);
create index if not exists crm_tool_receipts_organization_idx            on public.crm_tool_receipts (organization_id, connection_id);
create index if not exists crm_oauth_connections_organization_idx        on public.crm_oauth_connections (organization_id, user_id);

-- One archive row per week *per organization*. The new code's upsert names
-- (organization_id, week_start); the code still deployed while this migration
-- lands names (week_start). BOTH indexes exist through the rollout so either
-- statement finds its conflict target — Postgres refuses an `on conflict`
-- whose columns match no unique index (42P10), and the archive running under
-- the not-yet-deployed code would otherwise be skipped for any week that ends
-- inside the deploy window. The old single-column index is dropped by the
-- follow-up in supabase/followups/, together with the rollout defaults. While
-- it stands, two organizations could not archive the same week — one more
-- reason the guard below refuses a second organization until the follow-up
-- has run.
create unique index if not exists weekly_snapshots_org_week_idx
  on public.weekly_snapshots (organization_id, week_start);

-- ---------------------------------------------------------------------------
-- Rollout guard
--
-- The column defaults above and the surviving single-column week index are
-- only safe while Khyte is the only organization. This trigger turns that
-- sentence from documentation into a rule the database keeps: a second
-- organization cannot be created until the follow-up has dropped them. The
-- follow-up drops this trigger as well.
-- ---------------------------------------------------------------------------

create or replace function public.assert_rollout_finished()
returns trigger
language plpgsql
as $fn$
begin
  if (select count(*) from public.organizations) >= 1
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and column_name = 'organization_id'
         and column_default is not null
     ) then
    raise exception 'A second organization needs the rollout finished first: apply supabase/followups/20260927120000_drop_organization_rollout.sql, which drops the organization_id defaults.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

create trigger organizations_rollout_guard
  before insert on public.organizations
  for each row execute function public.assert_rollout_finished();

-- ---------------------------------------------------------------------------
-- Row Level Security — membership, not ownership
--
-- Dormant today (see the header), correct for tomorrow. `security definer`
-- so the check can read organization_members without recursing into that
-- table's own policy.
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$fn$;

revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;

alter table public.organizations        enable row level security;
alter table public.organization_members enable row level security;
alter table public.app_sessions         enable row level security;

create policy "members read their organization" on public.organizations
  for select to authenticated using (public.is_org_member(id));
create policy "members read their organization's members" on public.organization_members
  for select to authenticated using (public.is_org_member(organization_id));

-- Sessions are server-only. Never reachable through PostgREST.
revoke all on public.app_sessions from anon, authenticated;

drop policy if exists "owners manage their companies"            on public.companies;
drop policy if exists "owners manage their contacts"             on public.contacts;
drop policy if exists "owners manage their opportunities"        on public.opportunities;
drop policy if exists "owners manage their notes"                on public.notes;
drop policy if exists "owners manage their leads"                on public.leads;
drop policy if exists "owners manage their strategy boards"      on public.strategy_boards;
drop policy if exists "owners manage their strategy board links" on public.strategy_board_opportunities;
drop policy if exists "owners manage their strategy columns"     on public.strategy_columns;
drop policy if exists "owners manage their strategy cards"       on public.strategy_cards;
drop policy if exists "owners manage their tasks"                on public.tasks;
drop policy if exists "owners manage their goals"                on public.goals;
drop policy if exists "owners manage their goal metrics"         on public.goal_metrics;
drop policy if exists "owners manage their focus items"          on public.personal_goals;
drop policy if exists "owners manage their crm events"           on public.crm_events;
drop policy if exists "owners manage their weekly snapshots"     on public.weekly_snapshots;

create policy "members manage their organization's companies" on public.companies
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage their organization's contacts" on public.contacts
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage their organization's opportunities" on public.opportunities
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage their organization's notes" on public.notes
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage their organization's leads" on public.leads
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage their organization's strategy boards" on public.strategy_boards
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage their organization's strategy board links" on public.strategy_board_opportunities
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage their organization's strategy columns" on public.strategy_columns
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage their organization's strategy cards" on public.strategy_cards
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage their organization's tasks" on public.tasks
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage their organization's goals" on public.goals
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage their organization's goal metrics" on public.goal_metrics
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage their organization's personal goals" on public.personal_goals
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage their organization's crm events" on public.crm_events
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage their organization's weekly snapshots" on public.weekly_snapshots
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

-- `owner_id` is retired, not dropped. Nothing reads or writes it; the RLS
-- policies that named it are gone. Kept because removing a column the deployed
-- code might still select is the outage this CRM has had before.
comment on column public.companies.owner_id is
  'RETIRED 2026-09-20 — replaced by organization_id. Never populated. Not dropped; see 20260920120000_organizations.sql.';
