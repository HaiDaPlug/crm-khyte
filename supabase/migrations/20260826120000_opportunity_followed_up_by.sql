-- Who on the team is following this prospect up — the same fixed colleague
-- roster tasks and leads already use (see 20260824120000_task_assignee.sql).
alter table public.opportunities
  add column if not exists followed_up_by crm_colleague;
