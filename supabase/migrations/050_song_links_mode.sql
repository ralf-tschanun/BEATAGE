-- Song contest: how audio links are shown (preview / spotify / none).
-- Paste into the Supabase SQL editor.

alter table public.contests
  add column if not exists song_links text not null default 'preview';

alter table public.contests
  drop constraint if exists contests_song_links_check;

alter table public.contests
  add constraint contests_song_links_check
  check (song_links in ('preview', 'spotify', 'none'));
