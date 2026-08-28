-- ---------------------------------------------------------------------------
-- CRM activity log
--
-- The CRM has never recorded history: a stage change overwrites
-- opportunities.stage and the previous value is gone. That is fine for "where
-- is this deal now" and useless for "how many meetings did we book last week",
-- which is what the weekly non-negotiables need.
--
-- This is an append-only log of things that HAPPENED, deliberately separate
-- from the tables holding what currently IS. The distinction runs through the
-- whole feature:
--
--   current state  → intäkt, kunder, pipeline. Recomputed from opportunities
--                    every read, so moving a deal out of Won lowers revenue
--                    again. Needs no log.
--   events         → meetings booked, prospects reached out, leads added.
--                    Counted per week from this table, because "we booked 3
--                    meetings" stays true even if all three later go to Lost.
--
-- Rows are never updated, only inserted. A mistaken transition is corrected by
-- recording the corrective move, not by editing history — that is what keeps a
-- week's archived numbers reproducible from the log months later.
-- ---------------------------------------------------------------------------

create type crm_event_kind as enum (
  -- An opportunity entered 'Contacted' from a stage before it.
  'prospect_contacted',
  -- An opportunity entered 'Meeting Booked' from a stage before it.
  'meeting_booked',
  -- A row was added to leads.
  'lead_added',
  -- An opportunity entered 'Won'. Not used by the weekly counters (revenue is
  -- current state, not an event) but recorded so the timeline can show when
  -- deals closed.
  'deal_won'
);

create table public.crm_events (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references auth.users (id) on delete cascade,
  kind       crm_event_kind not null,
  -- The record this happened to. Deliberately NOT a foreign key: an event is
  -- a historical fact, and deleting the lead or opportunity it refers to must
  -- not delete the fact that it happened. A week's counts have to stay stable.
  subject_id uuid,
  -- Who did it, from the fixed roster. Null when the action carries no owner.
  colleague  text,
  -- Free-form context for the timeline — e.g. the stage moved from. Not read
  -- by any counter; kept so a later week-by-week view has something to show
  -- beyond a number.
  detail     jsonb not null default '{}'::jsonb,
  -- When it happened. Separate from created_at so a backfill or an imported
  -- event can carry its real date while created_at stays the insert time.
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index crm_events_owner_id_idx on public.crm_events (owner_id);
-- The counters ask "events of this kind since this timestamp", which this
-- serves directly.
create index crm_events_kind_time_idx on public.crm_events (kind, occurred_at desc);
-- The timeline asks for everything in a date range.
create index crm_events_time_idx      on public.crm_events (occurred_at desc);

-- No updated_at trigger: rows are immutable by design, so the column would
-- only ever equal created_at.

alter table public.crm_events enable row level security;

create policy "owners manage their crm events" on public.crm_events
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- Weekly archive
--
-- Each finished week's non-negotiable counts, frozen. The counts could be
-- recomputed from crm_events forever, and mostly they will be — but a target
-- cannot: "we hit 12 of 15 meetings" needs the 15 that was in force that week,
-- and that number lives on a goal row the operator is free to change later.
-- Freezing both is what makes a past week's row still mean what it meant.
-- ---------------------------------------------------------------------------

create table public.weekly_snapshots (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references auth.users (id) on delete cascade,
  -- The Monday of the week this covers, in local terms. `date` not timestamptz:
  -- a week is a calendar span, not an instant.
  week_start  date not null,
  -- One row per non-negotiable per week: {kind, target, actual}.
  counts      jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

-- One archive row per week. The upsert in the archive path relies on this.
create unique index weekly_snapshots_week_idx on public.weekly_snapshots (week_start);

alter table public.weekly_snapshots enable row level security;

create policy "owners manage their weekly snapshots" on public.weekly_snapshots
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
