-- ---------------------------------------------------------------------------
-- Company direction — goals, scoreboard, weekly focus
--
-- Khyte-internal, not part of what the CRM fundamentally is. This is the data
-- behind /goals (the editor) and /goals/display/[colleague] (the wallpaper).
--
-- Three tables rather than one, because the three have genuinely different
-- shapes: a goal is a line of text in a section, a metric is a number against
-- a target, and a focus item belongs to a person for one week. Forcing them
-- into a single polymorphic `direction_items` table would mean half the
-- columns null on every row.
--
-- Deliberately NOT joined to opportunities. The eventual "deal marked Won →
-- goal progress updates" link is a computation over the pipeline, not a
-- foreign key — a metric that stores its own current value keeps working when
-- the number comes from somewhere the CRM has never heard of (a bank balance,
-- a headcount). Wire the automatic path later by writing to `current_value`.
-- ---------------------------------------------------------------------------

-- Which band of the board a goal belongs to. An enum rather than free text
-- because the wallpaper layout has fixed regions — a goal with an unknown
-- section has nowhere to be drawn.
create type goal_section as enum (
  'north_star',
  'annual',
  'quarter',
  'principle',
  'not_now'
);

create type goal_status as enum ('on_track', 'at_risk', 'off_track', 'done');

-- ---------------------------------------------------------------------------
-- goals — the company layer, shared by every wallpaper
-- ---------------------------------------------------------------------------

create table public.goals (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references auth.users (id) on delete cascade,
  section    goal_section not null,
  title      text not null,
  -- Optional supporting line. The wallpaper renders it smaller beneath the
  -- title, and skips it entirely when blank.
  detail     text not null default '',
  status     goal_status not null default 'on_track',
  -- 0–100. Null means "no bar" — a principle has no progress, a quarter
  -- priority might not either. Distinct from 0, which draws an empty bar.
  progress   integer check (progress is null or (progress >= 0 and progress <= 100)),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index goals_owner_id_idx on public.goals (owner_id);
-- The board reads one section in display order
create index goals_board_idx    on public.goals (section, sort_order);

create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function set_updated_at();

alter table public.goals enable row level security;

create policy "owners manage their goals" on public.goals
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- goal_metrics — the scoreboard
-- ---------------------------------------------------------------------------

create table public.goal_metrics (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid references auth.users (id) on delete cascade,
  label         text not null,
  -- numeric, not integer: revenue in SEK exceeds int4 quickly and a
  -- conversion rate wants decimals. The mapper turns these into JS numbers.
  current_value numeric not null default 0,
  -- Null target means "just show the number" — a customer count with no goal
  -- attached still belongs on the scoreboard, it simply has no bar.
  target_value  numeric,
  -- Rendering hint, not a stored format: 'currency' runs through the app's
  -- currency formatter, 'number' through the plain one, 'percent' appends %.
  unit          text not null default 'number',
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index goal_metrics_owner_id_idx on public.goal_metrics (owner_id);
create index goal_metrics_board_idx    on public.goal_metrics (sort_order);

create trigger goal_metrics_set_updated_at
  before update on public.goal_metrics
  for each row execute function set_updated_at();

alter table public.goal_metrics enable row level security;

create policy "owners manage their goal metrics" on public.goal_metrics
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- focus_items — the personal layer, one wallpaper's worth per colleague
-- ---------------------------------------------------------------------------

create table public.focus_items (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references auth.users (id) on delete cascade,
  -- Matches ColleagueId in lib/types. Text rather than an enum because the
  -- roster in lib/colleagues.ts is already the source of truth and a new
  -- hire should not need a migration.
  colleague  text not null,
  title      text not null,
  done       boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index focus_items_owner_id_idx on public.focus_items (owner_id);
-- Each wallpaper reads exactly one colleague's list in display order
create index focus_items_board_idx    on public.focus_items (colleague, sort_order);

create trigger focus_items_set_updated_at
  before update on public.focus_items
  for each row execute function set_updated_at();

alter table public.focus_items enable row level security;

create policy "owners manage their focus items" on public.focus_items
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
