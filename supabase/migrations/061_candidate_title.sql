-- Label for participant nomination fields (Restaurant 1, Candidate 1, …).
-- Empty string means the UI falls back to "Candidate".
-- Paste ONLY this SQL into the Supabase SQL editor.

alter table public.contests
  add column if not exists candidate_title text not null default '';
