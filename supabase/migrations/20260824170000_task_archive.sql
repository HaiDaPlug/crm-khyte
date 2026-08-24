-- Archiving a task hides it from the board without removing the row, so
-- anything that references a task by id still resolves its title and company.
-- Deletion stays available for tasks that were created in error and should
-- never have been part of the record at all.
alter table public.tasks
  add column if not exists archived_at timestamptz;

-- Every read filters on this, and the archive is expected to grow without
-- bound while the active set stays small.
create index if not exists tasks_archived_at_idx
  on public.tasks (archived_at)
  where archived_at is null;
