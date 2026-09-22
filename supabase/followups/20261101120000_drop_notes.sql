-- ---------------------------------------------------------------------------
-- Drops public.notes — step 4 of the Stage 2 deploy order in docs/journal.md.
--
-- NOT APPLIED BY `npm run db:push`: this directory is outside
-- supabase/migrations/ on purpose, the same arrangement the rollout cleanup
-- uses. A table dropped ahead of the build that still selects from it is how
-- this CRM went down once before.
--
-- WHEN — two conditions, both of them, and not in the same deploy as the
-- Stage 2 build:
--
--   1. AFTER the deployed Stage 2 build is verified live. Until then the old
--      build keeps writing `notes` (and a rollback to it resumes writing
--      them). Those rows are not lost: journal_migrate_notes() below is
--      re-run here and picks up everything written since
--      20261001120000_journal.sql landed.
--
--   2. AFTER the rollout cleanup (supabase/followups/20260927120000_drop_
--      organization_rollout.sql) has run. That file still names
--      `public.notes` in its `alter column organization_id drop default`
--      list; dropping the table first would make the cleanup fail on a
--      missing relation, and the cleanup is what lets a second organization
--      exist at all.
--
-- Then move this file into supabase/migrations/ — keep the timestamp, or give
-- it a newer one that still sorts after 20261001120000_journal.sql and after
-- the promoted cleanup — and push. After this runs the deploy is forward
-- only: there is no `notes` table for the old build to return to.
--
-- The test suites exclude this file by its `drop_notes.sql` ending wherever
-- it sorts (tests/support/migrations.ts) and apply it deliberately through
-- dropNotes(), which is how the drop is exercised without ever being pushed.
-- ---------------------------------------------------------------------------

-- Everything the old build wrote since the journal migration ran. Returns the
-- counts; record them beside the ones from step 2.
select public.journal_migrate_notes();

-- The reconciliation. The backfill above should have left nothing behind, so
-- this block is not expected to fire — which is exactly why it is here. A row
-- it finds means the copy did not happen (a notes row whose organization was
-- deleted, a partially applied function, a manual insert), and losing it
-- silently is not an option a drop gets to take.
do $do$
declare
  v_orphans integer;
begin
  select count(*)::int
    into v_orphans
    from public.notes n
   where not exists (
     select 1 from public.journal_entries e
      where e.id = n.id and e.organization_id = n.organization_id);

  if v_orphans <> 0 then
    raise exception 'Refusing to drop public.notes: % row(s) have no matching journal_entries row (same id, same organization). Investigate before retrying; nothing has been dropped.', v_orphans
      using errcode = 'check_violation';
  end if;
end
$do$;

drop table if exists public.notes;

-- The backfill has nothing left to read.
drop function if exists public.journal_migrate_notes();
