-- Birthday Song Contest: optional months/years offset from birthday for chart lookup
-- (e.g. -9 months, +18 years).

alter table public.contests
  add column if not exists birthday_offset_amount integer not null default 0;

alter table public.contests
  add column if not exists birthday_offset_unit text not null default 'years';

alter table public.contests
  drop constraint if exists contests_birthday_offset_unit_check;

alter table public.contests
  add constraint contests_birthday_offset_unit_check
  check (birthday_offset_unit in ('months', 'years'));

alter table public.contests
  drop constraint if exists contests_birthday_offset_amount_check;

alter table public.contests
  add constraint contests_birthday_offset_amount_check
  check (birthday_offset_amount between -200 and 200);
