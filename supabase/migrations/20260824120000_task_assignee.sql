-- ---------------------------------------------------------------------------
-- Task assignee
--
-- The app has no real accounts yet, so this is a fixed roster rather than a
-- foreign key to auth.users (unlike owner_id) — same reasoning as
-- crm_priority: a constrained enum, not a relation.
-- ---------------------------------------------------------------------------

create type crm_colleague as enum ('erik', 'abdi', 'hai');

alter table tasks add column assignee crm_colleague;
