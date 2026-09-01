-- Merges 'Researched' into 'New' — step 2 of 2.
--
-- The board is collapsing from three early-pipeline columns (New, Researched,
-- Contacted) to two (New, Ongoing): 'New' picks up the Swedish label
-- "Undersökt" and absorbs every 'Researched' row, and 'Ongoing' ("Pågående")
-- takes the now-vacated second slot, starting empty. 'Researched' itself
-- stays defined on crm_stage — Postgres enum values can't be dropped — it
-- just never gets written again.
-- Renumbered together (not just reassigned) so the merged column doesn't end
-- up with two cards sharing the same sort_order — see
-- 20260829120000_opportunity_sort_order.sql for why that matters.
with merged as (
  select id, row_number() over (
    order by (stage = 'Researched'), sort_order
  ) - 1 as rn
  from public.opportunities
  where stage in ('New', 'Researched')
)
update public.opportunities o
set stage = 'New', sort_order = merged.rn
from merged
where merged.id = o.id;
