-- Merge `annual` + `quarter` into one dated `goal` family — step 1 of 2.
--
-- Postgres will not let a newly-added enum value be used inside the same
-- transaction that added it (SQLSTATE 55P04) — a rule the precedent
-- migration (20260828140100_weekly_goal_section) claimed was verified safe
-- to skip, and this file is proof that claim was wrong (or the guarantee
-- changed under us). Split into its own file so the enum addition commits on
-- its own before 20260830120100_goal_target_date_backfill.sql reads it.
alter type goal_section add value 'goal';
