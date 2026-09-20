-- ---------------------------------------------------------------------------
-- Finishes the organization rollout — step 5 of the deploy order in
-- docs/organization-foundation.md.
--
-- NOT APPLIED BY `npm run db:push`: this directory is outside
-- supabase/migrations/ on purpose. 20260920120000_organizations.sql added
-- `organization_id` with a default of the Khyte organization and kept the old
-- single-column week index so the code deployed at the time kept working
-- while the migration landed. Those aids must go before a second organization
-- exists — a forgotten insert would otherwise land silently in Khyte — and
-- the `organizations_rollout_guard` trigger refuses a second organization
-- until they have.
--
-- WHEN: after the build from feat/organization-foundation is verified live
-- (people log in, the roster shows, ChatGPT is reconnected). Then move this
-- file into supabase/migrations/ — keep the timestamp, or give it a newer one
-- that still sorts after 20260920120000 — and push. Applying it before that
-- code is deployed is the one thing this whole arrangement exists to prevent:
-- the older code inserts without organization_id and would start failing.
--
-- The test suites apply the migrations up to this file, assert the guard,
-- then apply this file from wherever it lives (here, or migrations/ once it
-- has been promoted), which is how the guard and the cleanup are both
-- exercised without either being pushed to a live database — and why
-- promoting the file needs no test change.
-- ---------------------------------------------------------------------------

alter table public.companies                    alter column organization_id drop default;
alter table public.contacts                     alter column organization_id drop default;
alter table public.opportunities                alter column organization_id drop default;
alter table public.notes                        alter column organization_id drop default;
alter table public.leads                        alter column organization_id drop default;
alter table public.strategy_boards              alter column organization_id drop default;
alter table public.strategy_board_opportunities alter column organization_id drop default;
alter table public.strategy_columns             alter column organization_id drop default;
alter table public.strategy_cards               alter column organization_id drop default;
alter table public.tasks                        alter column organization_id drop default;
alter table public.goals                        alter column organization_id drop default;
alter table public.goal_metrics                 alter column organization_id drop default;
alter table public.personal_goals               alter column organization_id drop default;
alter table public.crm_events                   alter column organization_id drop default;
alter table public.weekly_snapshots             alter column organization_id drop default;
alter table public.crm_interactions             alter column organization_id drop default;
alter table public.crm_tool_receipts            alter column organization_id drop default;
alter table public.crm_oauth_codes              alter column organization_id drop default;
alter table public.crm_oauth_connections        alter column organization_id drop default;

-- The old code's conflict target. Only weekly_snapshots_org_week_idx remains,
-- which is the one archiveFinishedWeeks names.
drop index if exists public.weekly_snapshots_week_idx;

-- The guard has done its job.
drop trigger if exists organizations_rollout_guard on public.organizations;
drop function if exists public.assert_rollout_finished();
