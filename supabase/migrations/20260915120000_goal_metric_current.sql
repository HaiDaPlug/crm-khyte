-- ---------------------------------------------------------------------------
-- Every goal becomes "X of Y"
--
-- The `goal` section had exactly one measurement: `progress`, a hand-typed
-- 0-100. A bare percentage has no denominator, so it can never be wrong —
-- "18%" of what? Nothing contradicted it and nothing could, which is why the
-- figure drifted from the day it was entered and why the board drew a precise
-- bar over an estimate.
--
-- `metric_target` (added in 20260828140100 for the weekly non-negotiables)
-- already holds the Y. This adds the X for the rows nothing counts
-- automatically, so a goal reads "1 av 3" — a number a human typed, but a
-- number that can be checked. Same shape as a weekly non-negotiable, which
-- fills its X from crm_events instead. One concept on the whole page.
--
-- `progress` IS DELIBERATELY NOT DROPPED. Two reasons, and the first is the
-- one that matters: code still reads the column this migration would remove
-- (lib/db/mappers.ts maps it, GoalsEditor shows the old figure as a hint while
-- a goal has no target yet), and a migration that runs ahead of the code
-- reading its column is how the CRM went down before. The second is that the
-- estimates on the existing rows are the only record of what anyone thought
-- at the time — worth keeping even though nothing draws them any more.
-- ---------------------------------------------------------------------------

-- The counted-or-typed current value. Integer, matching `metric_target` rather
-- than goal_metrics' numeric: these are counts and whole SEK, and int4 reaches
-- 2.1 billion, which is well past anything this board tracks.
alter table public.goals add column metric_current integer
  check (metric_current is null or metric_current >= 0);

comment on column public.goals.metric_current is
  'The X in "X of Y", against metric_target. Null means nothing measured yet. Ignored when metric_kind is set — a counted goal reads its X from crm_events instead.';

comment on column public.goals.progress is
  'RETIRED 2026-09-15 — replaced by metric_current/metric_target. Not dropped: existing values are the only record of the estimates that were in force, and the column is still mapped. Nothing writes it any more.';
