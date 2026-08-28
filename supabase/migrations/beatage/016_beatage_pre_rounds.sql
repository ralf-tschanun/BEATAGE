-- Optional denormalized flag (app uses settings.quizStarted + settings.preRoundCutoff).
-- Safe to run; not required for Pre Rounds to work.
alter table public.beatage_rounds
  add column if not exists is_pre_round boolean not null default false;

comment on column public.beatage_rounds.is_pre_round is
  'Optional denormalized warm-up flag. App source of truth is quiz settings (quizStarted / preRoundCutoff).';
