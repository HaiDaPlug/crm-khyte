-- ---------------------------------------------------------------------------
-- Personal goals — the private layer of the direction board
--
-- `focus_items` was a flat checkbox list scoped to a week. That was too small a
-- shape for what a personal goal turns out to be: "Flytta ut i december" has a
-- deadline and no percentage, "Köra 1000 km i år" has a number and a bar, and
-- neither is a weekly task. This widens the table rather than adding a fourth
-- one, because the thing it holds has not changed — it is still "one person's
-- own line on their own board".
--
-- Deliberately NOT linked to the company `goals` table. A personal goal is not
-- a contribution to a company objective; it is the operator's own life shown on
-- their own wallpaper, and the two tracks share a screen without sharing a
-- hierarchy. The Khyte-goal-contributes-to-a-weekly-goal idea is a separate
-- relationship and gets its own migration when it lands.
--
-- Privacy is by URL, not by database: rows are readable to anything holding a
-- display link or the shared password, and only the rendering filters by
-- colleague. Real isolation waits on the per-user auth that does not exist yet.
-- ---------------------------------------------------------------------------

-- Renamed from focus_items: the table no longer holds "this week's focus", it
-- holds a person's goals. Rename rather than create-and-migrate so existing
-- rows, indexes and the updated_at trigger all come along.
alter table public.focus_items rename to personal_goals;

alter index focus_items_owner_id_idx rename to personal_goals_owner_id_idx;
alter index focus_items_board_idx    rename to personal_goals_board_idx;

-- Optional deadline. `date` not `timestamptz`: "december" is a day on a
-- calendar, not an instant, and the board renders it as a remaining-months
-- countdown rather than a clock time.
alter table public.personal_goals add column target_date date;

-- Optional 0–100, same contract as goals.progress: null means "no bar" (a
-- deadline goal has nothing to fill), 0 means "an empty bar" (started, nothing
-- done). Same check constraint so the two tables cannot drift.
alter table public.personal_goals
  add column progress integer check (progress is null or (progress >= 0 and progress <= 100));

-- `done` stays. A goal with a deadline is still something you finish, and the
-- board strikes it through exactly as before.

comment on table public.personal_goals is
  'One person''s own goals, shown only on their wallpaper. Not linked to company goals — see 20260828120000_personal_goals.sql.';
