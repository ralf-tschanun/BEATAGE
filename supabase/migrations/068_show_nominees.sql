-- Show who nominated each candidate in the Candidates list (default off).
-- Paste ONLY this SQL into the Supabase SQL editor.

alter table public.contests
  add column if not exists show_nominees boolean not null default false;
