-- Show point totals next to star ratings (default off).
-- Paste ONLY this SQL into the Supabase SQL editor.

alter table public.contests
  add column if not exists show_star_points boolean not null default false;
