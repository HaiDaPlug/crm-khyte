-- Position within a task board column (on pace / overdue / completed).
-- Dragging a task to reorder it had nothing to persist, so it always
-- snapped back — same pattern as opportunities.sort_order.
alter table public.tasks
  add column if not exists sort_order integer not null default 0;

-- Backfill using the existing due-date ordering the board already rendered
-- (earliest due date first within each open bucket; most-recently-created
-- first among completed, matching insertion order) so no task visibly moves.
with ranked as (
  select id, row_number() over (
    partition by completed, archived_at is not null
    order by due_date asc, created_at desc
  ) - 1 as rn
  from public.tasks
)
update public.tasks t
set sort_order = ranked.rn
from ranked
where ranked.id = t.id;
