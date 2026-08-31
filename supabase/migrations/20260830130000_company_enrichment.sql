-- Prep for a future automatic-scraping enrichment pass — these are plain
-- optional fields for now, filled in by hand or left blank. No source/
-- confidence tracking: that only matters once something other than a person
-- is writing to them, which is a later feature, not this one.
alter table public.companies add column revenue        numeric(14, 2);
alter table public.companies add column employee_count integer;
alter table public.companies add column about          text;

comment on column public.companies.revenue is
  'Base-currency (SEK) figure, same convention as opportunities.deal_value.';
comment on column public.companies.employee_count is
  'Plain headcount, no currency conversion.';
comment on column public.companies.about is
  'Free-text company description.';
