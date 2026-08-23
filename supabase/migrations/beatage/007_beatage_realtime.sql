-- Enable Supabase Realtime for BEATAGE quiz live play
-- Paste into the Supabase SQL editor if postgres_changes should fire for quiz tables.
-- Broadcast resync still works without this; publication improves automatic catch-up.

do $$
begin
  alter publication supabase_realtime add table public.beatage_quizzes;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.beatage_quiz_members;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.beatage_curated_tracks;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.beatage_rounds;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.beatage_guesses;
exception
  when duplicate_object then null;
end $$;

-- Filtered realtime needs FULL replica identity
alter table public.beatage_quizzes replica identity full;
alter table public.beatage_quiz_members replica identity full;
alter table public.beatage_curated_tracks replica identity full;
alter table public.beatage_rounds replica identity full;
alter table public.beatage_guesses replica identity full;
