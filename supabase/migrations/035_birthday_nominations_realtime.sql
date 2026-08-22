-- Live birthday submission status for host turnout
-- Paste ONLY this SQL into the Supabase SQL editor

do $$
begin
  alter publication supabase_realtime add table public.birthday_nominations;
exception
  when duplicate_object then null;
end $$;

alter table public.birthday_nominations replica identity full;
