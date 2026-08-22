-- Enable Supabase Realtime for live contest updates
-- Paste ONLY this SQL into the Supabase SQL editor

do $$
begin
  alter publication supabase_realtime add table public.contests;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.contest_members;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.candidates;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.ballots;
exception
  when duplicate_object then null;
end $$;
