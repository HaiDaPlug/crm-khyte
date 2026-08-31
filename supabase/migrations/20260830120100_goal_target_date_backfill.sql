-- Merge `annual` + `quarter` into one dated `goal` family — step 2 of 2.
--
-- The two sections carried the same shape (title, status, progress) and
-- differed only by an implicit, unstored cadence — "this quarter" vs "this
-- year" was a name, never a date. That made the two bands impossible to sort
-- against each other and gave neither anywhere to put "actually, this is due
-- March 15th". Replacing them with one section plus a real `target_date`
-- lets a goal's cadence be derived (see lib/goal-period.ts) instead of
-- guessed from which of two hardcoded boxes it was typed into.
--
-- Existing `annual`/`quarter` rows become `goal` rows with `target_date`
-- null — neither section ever had a date to preserve, so null is the honest
-- backfill. They fall into the "Ingen deadline" bucket on the timeline until
-- someone edits them, same as a brand new goal would.

-- `date`, matching personal_goals.target_date (20260828120000_personal_goals):
-- a deadline is a day on a calendar, not an instant.
alter table public.goals add column target_date date;

comment on column public.goals.target_date is
  'goal-section only. YYYY-MM-DD, same convention as personal_goals.target_date. Null means no deadline set yet.';

-- Backfill: fold both retired sections into the merged one. target_date stays
-- null for all of them, since neither section ever stored a date.
update public.goals
set section = 'goal'
where section in ('annual', 'quarter');
