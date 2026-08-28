-- ---------------------------------------------------------------------------
-- Weekly non-negotiables live on the existing goals table
--
-- A new section rather than a new table: a non-negotiable IS a goal — it has a
-- title, an owner-set target and a place on the board. What makes it different
-- is only that its progress is counted rather than typed, which is one column.
--
-- Kept in its own file so the enum change is committed before anything depends
-- on it. Postgres 12+ does allow adding and using an enum value inside one
-- transaction (verified against this database before splitting), so this is
-- ordering hygiene rather than a hard requirement — but it keeps a failure in
-- the columns below from rolling back the section value too.
-- ---------------------------------------------------------------------------

alter type goal_section add value 'weekly';

-- Which event kind fills this goal's number in, and what the weekly target is.
-- Null metric_kind means an ordinary hand-tracked goal, which is every row that
-- already exists.
alter table public.goals add column metric_kind   crm_event_kind;
alter table public.goals add column metric_target integer
  check (metric_target is null or metric_target >= 0);

comment on column public.goals.metric_kind is
  'When set, this goal''s progress is counted from crm_events of this kind for the current week rather than stored in progress.';
