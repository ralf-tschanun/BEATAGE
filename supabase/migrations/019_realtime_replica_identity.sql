-- Make Realtime UPDATE events filterable + ensure publication
-- Paste ONLY this SQL into the Supabase SQL editor

do $$
begin
  alter publication supabase_realtime add table public.contests;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.contest_members;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.candidates;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.ballots;
exception when duplicate_object then null;
end $$;

-- Needed so UPDATE/DELETE payloads include contest_id for filtered subscriptions
alter table public.contests replica identity full;
alter table public.contest_members replica identity full;
alter table public.candidates replica identity full;
alter table public.ballots replica identity full;
