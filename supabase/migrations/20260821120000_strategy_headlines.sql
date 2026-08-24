-- ---------------------------------------------------------------------------
-- Strategy headlines
--
-- The strategy board used to have six lanes baked into a Postgres enum, the
-- same six for every deal. They are now user-written headlines owned by a
-- single opportunity: a new deal starts with an empty board and the operator
-- names the lanes that matter for that deal.
--
-- Existing cards keep their lane. The backfill below turns each distinct
-- (opportunity, enum value) pair that actually has cards into a headline row,
-- preserving the old left-to-right order, and repoints the cards at it. No
-- opportunity gains lanes it never used.
-- ---------------------------------------------------------------------------

create table strategy_columns (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid references auth.users (id) on delete cascade,
  opportunity_id uuid not null references opportunities (id) on delete cascade,
  title          text not null,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index strategy_columns_owner_id_idx on strategy_columns (owner_id);
-- The board reads one opportunity's headlines in display order
create index strategy_columns_board_idx    on strategy_columns (opportunity_id, sort_order);

create trigger strategy_columns_set_updated_at
  before update on strategy_columns
  for each row execute function set_updated_at();

alter table strategy_columns enable row level security;

create policy "owners manage their strategy columns" on strategy_columns
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- --- backfill --------------------------------------------------------------

alter table strategy_cards add column column_id uuid;

insert into strategy_columns (owner_id, opportunity_id, title, sort_order)
select
  c.owner_id,
  c.opportunity_id,
  c.column_name::text,
  -- enum position, so the rebuilt board reads in the order it always did
  array_position(
    enum_range(null::crm_strategy_column)::text[],
    c.column_name::text
  ) - 1
from strategy_cards c
group by c.owner_id, c.opportunity_id, c.column_name;

update strategy_cards c
set column_id = k.id
from strategy_columns k
where k.opportunity_id = c.opportunity_id
  and k.title = c.column_name::text
  and k.owner_id is not distinct from c.owner_id;

alter table strategy_cards
  alter column column_id set not null,
  add constraint strategy_cards_column_id_fkey
    foreign key (column_id) references strategy_columns (id) on delete cascade;

drop index strategy_cards_board_idx;
alter table strategy_cards drop column column_name;
drop type crm_strategy_column;

-- The board reads one lane's cards in order
create index strategy_cards_board_idx on strategy_cards (column_id, sort_order);
