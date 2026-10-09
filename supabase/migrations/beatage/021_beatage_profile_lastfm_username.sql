-- Last.fm username a signed-in host confirmed for live quizzes.
-- Guests keep using local storage; this column is only written for email accounts.

alter table public.beatage_profiles
  add column if not exists lastfm_username text;

comment on column public.beatage_profiles.lastfm_username is
  'Last.fm username the signed-in host confirmed for live quizzes.';
