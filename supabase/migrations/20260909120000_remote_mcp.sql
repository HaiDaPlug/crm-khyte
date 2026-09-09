-- Additive integration storage. No existing CRM records or reporting history are rewritten.
alter table public.leads add column tags text[] not null default '{}';
alter table public.tasks add column tags text[] not null default '{}';

create table public.crm_tool_receipts (
  request_id uuid primary key,
  action text not null,
  payload_hash text not null,
  connection_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create table public.crm_interactions (
  id uuid primary key,
  -- Historical IDs, like crm_events.subject_id: retain the fact even if a
  -- user later deletes its prospect. Do not block existing UI deletion.
  opportunity_id uuid not null,
  company_id uuid not null,
  contact_id uuid not null,
  occurred_on date not null,
  channel text not null check (channel in ('email','phone','meeting','linkedin','other')),
  summary text not null,
  followed_up_by crm_colleague,
  connection_id uuid not null,
  source_system text,
  source_account text,
  source_message_id text,
  created_at timestamptz not null default now(),
  check ((source_system is null and source_account is null and source_message_id is null)
    or (source_system is not null and source_account is not null and source_message_id is not null))
);
create unique index crm_interactions_source_idx on public.crm_interactions
  (source_system, source_account, source_message_id, opportunity_id)
  where source_message_id is not null;
create index crm_interactions_opportunity_idx on public.crm_interactions (opportunity_id, occurred_on);

-- Codes/tokens are opaque random values; only keyed hashes are stored.
-- One manually configured OAuth client avoids open registration and arbitrary callbacks.
create table public.crm_oauth_codes (
  code_hash text primary key,
  client_id text not null,
  redirect_uri text not null,
  challenge text not null,
  scopes text[] not null,
  resource text not null,
  expires_at timestamptz not null
);
create table public.crm_oauth_connections (
  id uuid primary key,
  client_id text not null,
  access_hash text not null unique,
  refresh_hash text not null unique,
  scopes text[] not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- These are server-only integration tables. Never expose through anonymous PostgREST.
alter table public.crm_tool_receipts enable row level security;
alter table public.crm_interactions enable row level security;
alter table public.crm_oauth_codes enable row level security;
alter table public.crm_oauth_connections enable row level security;
revoke all on public.crm_tool_receipts, public.crm_interactions,
  public.crm_oauth_codes, public.crm_oauth_connections from anon, authenticated;
