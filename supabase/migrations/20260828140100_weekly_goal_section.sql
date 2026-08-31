-- ---------------------------------------------------------------------------
-- Weekly non-negotiables live on the existing goals table
--
-- A new section rather than a new table: a non-negotiable IS a goal — it has a
-- title, an owner-set target and a place on the board. What makes it different
-- is only that its progress is counted rather than typed, which is one column.
--
-- Kept in its own file so the enum change is committed before anything depends
-- on it. This file never actually reads the new 'weekly' value back (no
-- `update ... set section = 'weekly'` here), so the "same transaction is
-- fine" claim that used to be here was untested, not verified — and it is
-- wrong: 20260830120000_goal_target_date.sql tried exactly that shape and hit
-- Postgres's real rule, SQLSTATE 55P04, "unsafe use of new value of enum
-- type" — a freshly added enum value cannot be used in the same transaction
-- that added it. Splitting the enum-add into its own file, as done here, is
-- not optional ordering hygiene; it is required whenever a later statement
-- in the same push needs the new value.
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
