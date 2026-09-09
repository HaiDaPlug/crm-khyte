-- ---------------------------------------------------------------------------
-- Strategy boards: one board, many prospects
--
-- Until now a "board" had no identity of its own — it was defined purely as
-- "the strategy_columns rows whose opportunity_id matches this deal." Two
-- deals working the same account (a bundle, a renewal alongside a new
-- module) had no way to share a board; each got its own copy of the same
-- headlines. strategy_boards is a first-class entity now, and
-- strategy_board_opportunities is the join table that lets several
-- opportunities point at the same board.
--
-- strategy_cards.opportunity_id is dropped as part of this: it was already
-- redundant (derivable via column_id -> strategy_columns.board_id) and would
-- otherwise silently disagree with the board once one board serves more than
-- one opportunity.
-- ---------------------------------------------------------------------------

create table strategy_boards (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index strategy_boards_owner_id_idx on strategy_boards (owner_id);

create trigger strategy_boards_set_updated_at
  before update on strategy_boards
  for each row execute function set_updated_at();

alter table strategy_boards enable row level security;

create policy "owners manage their strategy boards" on strategy_boards
  for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create table strategy_board_opportunities (
  board_id       uuid not null references strategy_boards (id) on delete cascade,
  opportunity_id uuid not null references opportunities (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (board_id, opportunity_id)
);

-- board_id is already covered as the PK's leading column; the join is also
-- walked the other way ("which board is this opportunity on").
create index strategy_board_opportunities_opportunity_idx
  on strategy_board_opportunities (opportunity_id);

alter table strategy_board_opportunities enable row level security;

-- The join table carries no owner_id of its own — ownership is the board's.
create policy "owners manage their strategy board links" on strategy_board_opportunities
  for all to authenticated using (
    exists (select 1 from strategy_boards b where b.id = board_id and b.owner_id = auth.uid())
  ) with check (
    exists (select 1 from strategy_boards b where b.id = board_id and b.owner_id = auth.uid())
  );

-- --- backfill: one board per opportunity that already has a board ----------

alter table strategy_columns add column board_id uuid;

-- Generated once and reused for both inserts below, so the board row and its
-- link row always agree on an id — two separate gen_random_uuid() calls would
-- silently produce two different boards for the same deal.
create temporary table _board_backfill as
select gen_random_uuid() as board_id, opportunity_id, owner_id
from (select distinct opportunity_id, owner_id from strategy_columns) d;

insert into strategy_boards (id, owner_id)
select board_id, owner_id from _board_backfill;

insert into strategy_board_opportunities (board_id, opportunity_id)
select board_id, opportunity_id from _board_backfill;

update strategy_columns k
set board_id = bb.board_id
from _board_backfill bb
where bb.opportunity_id = k.opportunity_id;

drop table _board_backfill;

alter table strategy_columns
  alter column board_id set not null,
  add constraint strategy_columns_board_id_fkey
    foreign key (board_id) references strategy_boards (id) on delete cascade;

drop index strategy_columns_board_idx;
-- The board reads its headlines in display order.
create index strategy_columns_board_idx on strategy_columns (board_id, sort_order);

alter table strategy_columns drop column opportunity_id;

-- Redundant since strategy_cards_board_idx (column_id, sort_order) already
-- covers every read, and column_id -> strategy_columns.board_id derives it.
alter table strategy_cards drop column opportunity_id;
