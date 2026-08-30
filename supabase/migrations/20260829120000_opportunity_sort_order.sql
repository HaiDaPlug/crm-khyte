-- Position within a stage's column on the pipeline board. Dragging a card to
-- reorder it (rather than change its stage) had nothing to persist, so it
-- always snapped back — see strategy_cards.sort_order for the same pattern.
alter table public.opportunities
  add column if not exists sort_order integer not null default 0;

-- Backfill using the existing per-stage ordering (created_at desc, matching
-- how the board already rendered cards) so no card visibly moves.
with ranked as (
  select id, row_number() over (
    partition by stage order by created_at desc
  ) - 1 as rn
  from public.opportunities
)
update public.opportunities o
set sort_order = ranked.rn
from ranked
where ranked.id = o.id;
