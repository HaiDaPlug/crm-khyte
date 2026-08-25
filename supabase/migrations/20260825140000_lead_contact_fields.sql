-- Capture a bit more at the point a lead is dumped in: who the contact is
-- (free text — no Contact record exists yet), a "koppling" (someone in your
-- own network who can vouch for or introduce them), where the lead came
-- from, and who on the team owns following up (the same fixed colleague
-- roster tasks use — see 20260824120000_task_assignee.sql). All optional;
-- leads stay valid with just a company name.
alter table public.leads
  add column if not exists contact_name   text,
  add column if not exists connection     text,
  add column if not exists source         text,
  add column if not exists followed_up_by crm_colleague;
