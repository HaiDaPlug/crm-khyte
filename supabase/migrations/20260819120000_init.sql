-- Khyte CRM — initial schema
-- Mirrors the domain types in lib/types/index.ts.
--
-- Single-user today, multi-user ready: every table carries `owner_id` and has
-- RLS enabled with owner-scoped policies. Until auth ships, the app talks to
-- Postgres with a secret key (sb_secret_…), which holds BYPASSRLS — so the
-- policies sit dormant and correct rather than needing a retrofit later.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums — the DB-level mirror of the TS unions
-- ---------------------------------------------------------------------------

create type crm_priority as enum ('low', 'medium', 'high', 'critical');

create type crm_stage as enum (
  'New',
  'Researched',
  'Contacted',
  'Warm',
  'Meeting Booked',
  'Proposal Sent',
  'Negotiation',
  'Won',
  'Lost'
);

create type crm_strategy_column as enum (
  'Pain Points',
  'Stakeholders',
  'Objections',
  'Offer Angle',
  'Proof',
  'Next Actions'
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table companies (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references auth.users (id) on delete cascade,
  name       text not null,
  domain     text not null default '',
  industry   text not null default '',
  size       text not null default '',
  location   text not null default '',
  tags       text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table contacts (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references auth.users (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  name       text not null,
  role       text not null default '',
  email      text not null default '',
  linkedin   text,
  phone      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table opportunities (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid references auth.users (id) on delete cascade,
  company_id       uuid not null references companies (id) on delete cascade,
  contact_id       uuid not null references contacts (id) on delete cascade,
  stage            crm_stage not null default 'New',
  priority         crm_priority not null default 'medium',
  -- Leads only appear on the pipeline board once explicitly added
  in_pipeline      boolean not null default false,
  deal_value       numeric(14, 2),
  next_step        text not null default '',
  follow_up_date   date,
  last_interaction date,
  tags             text[] not null default '{}',
  notes            text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table notes (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid references auth.users (id) on delete cascade,
  opportunity_id uuid references opportunities (id) on delete cascade,
  company_id     uuid references companies (id) on delete cascade,
  raw            text not null,
  -- Structured output of the extraction pipeline (docs/aiLogic.md).
  -- Stored with the same camelCase keys the client type uses.
  ai_extracted   jsonb,
  dismissed      boolean not null default false,
  applied        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table strategy_cards (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid references auth.users (id) on delete cascade,
  opportunity_id uuid not null references opportunities (id) on delete cascade,
  -- `column` and `order` are reserved words; the mapper renames these back to
  -- `column` / `order` for the client.
  column_name    crm_strategy_column not null,
  content        text not null,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table tasks (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid references auth.users (id) on delete cascade,
  title                  text not null,
  description            text,
  related_opportunity_id uuid references opportunities (id) on delete set null,
  related_company_id     uuid references companies (id) on delete set null,
  due_date               date,
  completed              boolean not null default false,
  priority               crm_priority not null default 'medium',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes — foreign keys plus the columns the app actually filters on
-- ---------------------------------------------------------------------------

create index companies_owner_id_idx       on companies (owner_id);
create index contacts_owner_id_idx        on contacts (owner_id);
create index contacts_company_id_idx      on contacts (company_id);
create index opportunities_owner_id_idx   on opportunities (owner_id);
create index opportunities_company_id_idx on opportunities (company_id);
create index opportunities_contact_id_idx on opportunities (contact_id);
-- The pipeline board reads exactly this slice
create index opportunities_pipeline_idx   on opportunities (in_pipeline, stage);
create index notes_owner_id_idx           on notes (owner_id);
create index notes_opportunity_id_idx     on notes (opportunity_id);
create index notes_company_id_idx         on notes (company_id);
create index strategy_cards_owner_id_idx  on strategy_cards (owner_id);
-- The strategy board reads one opportunity's cards in column/order sequence
create index strategy_cards_board_idx     on strategy_cards (opportunity_id, column_name, sort_order);
create index tasks_owner_id_idx           on tasks (owner_id);
create index tasks_due_date_idx           on tasks (completed, due_date);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger companies_set_updated_at      before update on companies      for each row execute function set_updated_at();
create trigger contacts_set_updated_at       before update on contacts       for each row execute function set_updated_at();
create trigger opportunities_set_updated_at  before update on opportunities  for each row execute function set_updated_at();
create trigger notes_set_updated_at          before update on notes          for each row execute function set_updated_at();
create trigger strategy_cards_set_updated_at before update on strategy_cards for each row execute function set_updated_at();
create trigger tasks_set_updated_at          before update on tasks          for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Enabled now so the tables are never reachable with the public publishable
-- key. The policies scope every row to its owner, which is what auth will need
-- on day one. The server currently uses a secret key (RLS-exempt), so these
-- policies match nothing yet and block nothing yet.
-- ---------------------------------------------------------------------------

alter table companies      enable row level security;
alter table contacts       enable row level security;
alter table opportunities  enable row level security;
alter table notes          enable row level security;
alter table strategy_cards enable row level security;
alter table tasks          enable row level security;

create policy "owners manage their companies" on companies
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "owners manage their contacts" on contacts
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "owners manage their opportunities" on opportunities
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "owners manage their notes" on notes
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "owners manage their strategy cards" on strategy_cards
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "owners manage their tasks" on tasks
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
