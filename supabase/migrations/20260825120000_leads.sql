-- Leads — raw, unqualified company interest, dumped in before there's a
-- contact or a deal to track. Deliberately has no company_id/contact_id: a
-- lead promoted to a Prospect is what creates those records (see
-- AddProspectModal's "start from a lead"), and the lead row is deleted once
-- that happens.
create table public.leads (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references auth.users (id) on delete cascade,
  company_name text not null,
  priority     crm_priority not null default 'medium',
  notes        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index leads_owner_id_idx on public.leads (owner_id);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function set_updated_at();

alter table public.leads enable row level security;

create policy "owners manage their leads" on public.leads
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
