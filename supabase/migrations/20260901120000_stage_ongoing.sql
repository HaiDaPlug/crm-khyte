-- Adds the 'Ongoing' stage — step 1 of 2.
--
-- Postgres will not let a newly-added enum value be used inside the same
-- transaction that added it (SQLSTATE 55P04), so the add has to commit on its
-- own before 20260901120100_stage_ongoing_backfill.sql can reference it — see
-- 20260830120000_goal_target_date.sql for the same split.
alter type crm_stage add value 'Ongoing' after 'New';
