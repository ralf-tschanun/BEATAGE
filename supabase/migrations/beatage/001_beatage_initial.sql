-- BEATAGE initial schema (hybrid model C)
-- Run in the SAME Supabase project as MyContest (shared auth.users + public.profiles)
-- Dashboard → SQL → New query → paste and run

-- ---------------------------------------------------------------------------
-- BEATAGE billing (separate from MyContest profiles.plan / polar_customer_id)
-- ---------------------------------------------------------------------------

create table if not exists public.beatage_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'plus', 'pro')),
  polar_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists beatage_profiles_polar_customer_id_uidx
  on public.beatage_profiles (polar_customer_id)
  where polar_customer_id is not null;

-- Auto-create beatage profile for every auth user (including anonymous)
create or replace function public.handle_new_beatage_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.beatage_profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_beatage on auth.users;
create trigger on_auth_user_created_beatage
  after insert on auth.users
  for each row execute function public.handle_new_beatage_user();

-- Backfill existing users
insert into public.beatage_profiles (id)
select id from auth.users
on conflict (id) do nothing;

create or replace function public.beatage_plan_limits(p_plan text)
returns table (
  max_active_quizzes integer,
  max_members integer,
  inactivity_expiry_days integer
)
language sql
stable
as $$
  select
    case lower(trim(coalesce(p_plan, '')))
      when 'plus' then 5
      when 'pro' then null
      else 1
    end,
    case lower(trim(coalesce(p_plan, '')))
      when 'plus' then 20
      when 'pro' then null
      else 10
    end,
    case lower(trim(coalesce(p_plan, '')))
      when 'plus' then 183
      when 'pro' then null
      else 7
    end;
$$;

create or replace function public.beatage_apply_billing_plan(
  p_user_id uuid,
  p_plan text,
  p_polar_customer_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text := lower(trim(coalesce(p_plan, '')));
  v_limits record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if v_plan not in ('free', 'plus', 'pro') then
    raise exception 'INVALID_PLAN';
  end if;

  insert into public.beatage_profiles (id, plan, polar_customer_id)
  values (p_user_id, v_plan, nullif(trim(coalesce(p_polar_customer_id, '')), ''))
  on conflict (id) do update
  set
    plan = excluded.plan,
    polar_customer_id = coalesce(excluded.polar_customer_id, public.beatage_profiles.polar_customer_id),
    updated_at = now();

  select * into v_limits from public.beatage_plan_limits(v_plan);

  update public.beatage_quizzes
  set
    max_members = v_limits.max_members,
    expires_at = case
      when v_limits.inactivity_expiry_days is null then null
      else greatest(coalesce(last_activity_at, now()), now())
        + make_interval(days => v_limits.inactivity_expiry_days)
    end
  where host_user_id = p_user_id
    and unlocked_at is null
    and status in ('draft', 'open', 'playing', 'finished');

  return jsonb_build_object('ok', true, 'plan', v_plan);
end;
$$;

revoke all on function public.beatage_apply_billing_plan(uuid, text, text) from public;
grant execute on function public.beatage_apply_billing_plan(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Quiz core
-- ---------------------------------------------------------------------------

create table if not exists public.beatage_quizzes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  status text not null default 'open'
    check (status in ('draft', 'open', 'playing', 'finished', 'expired')),
  host_user_id uuid not null references auth.users (id) on delete cascade,
  max_members integer check (max_members is null or max_members > 0),
  join_code text not null unique,
  manage_token text not null unique,
  scoring_model text not null default 'year_exact'
    check (scoring_model in ('year_exact', 'year_closer', 'year_linear')),
  max_rounds integer check (max_rounds is null or max_rounds > 0),
  host_participates boolean not null default true,
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz,
  unlocked_at timestamptz,
  current_round_number integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists beatage_quizzes_host_user_id_idx on public.beatage_quizzes (host_user_id);
create index if not exists beatage_quizzes_join_code_idx on public.beatage_quizzes (join_code);
create index if not exists beatage_quizzes_status_idx on public.beatage_quizzes (status);

create table if not exists public.beatage_quiz_members (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.beatage_quizzes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  role text not null check (role in ('host', 'participant')),
  joined_at timestamptz not null default now(),
  unique (quiz_id, user_id)
);

create index if not exists beatage_quiz_members_quiz_id_idx on public.beatage_quiz_members (quiz_id);
create index if not exists beatage_quiz_members_user_id_idx on public.beatage_quiz_members (user_id);

create table if not exists public.beatage_rounds (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.beatage_quizzes (id) on delete cascade,
  round_number integer not null check (round_number > 0),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'revealed')),
  spotify_track_id text,
  track_name text,
  artist_name text,
  album_art_url text,
  preview_url text,
  correct_release_year integer check (correct_release_year is null or correct_release_year between 1900 and 2100),
  started_at timestamptz,
  revealed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (quiz_id, round_number)
);

create index if not exists beatage_rounds_quiz_id_idx on public.beatage_rounds (quiz_id);

create table if not exists public.beatage_guesses (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.beatage_rounds (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  guessed_year integer not null check (guessed_year between 1900 and 2100),
  points integer not null default 0 check (points >= 0),
  submitted_at timestamptz not null default now(),
  unique (round_id, user_id)
);

create index if not exists beatage_guesses_round_id_idx on public.beatage_guesses (round_id);
create index if not exists beatage_guesses_user_id_idx on public.beatage_guesses (user_id);

create or replace function public.beatage_unlock_quiz_from_billing(
  p_quiz_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select host_user_id into v_host
  from public.beatage_quizzes
  where id = p_quiz_id;

  if v_host is null then
    raise exception 'QUIZ_NOT_FOUND';
  end if;

  if v_host is distinct from p_user_id then
    raise exception 'NOT_HOST';
  end if;

  update public.beatage_quizzes
  set
    unlocked_at = coalesce(unlocked_at, now()),
    max_members = null,
    expires_at = null,
    max_rounds = null
  where id = p_quiz_id;

  return jsonb_build_object('ok', true, 'quiz_id', p_quiz_id);
end;
$$;

revoke all on function public.beatage_unlock_quiz_from_billing(uuid, uuid) from public;
grant execute on function public.beatage_unlock_quiz_from_billing(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- RLS (basic — expand when app routes are wired)
-- ---------------------------------------------------------------------------

alter table public.beatage_profiles enable row level security;
alter table public.beatage_quizzes enable row level security;
alter table public.beatage_quiz_members enable row level security;
alter table public.beatage_rounds enable row level security;
alter table public.beatage_guesses enable row level security;

create policy beatage_profiles_select_own on public.beatage_profiles
  for select to authenticated
  using (id = auth.uid());

create policy beatage_quizzes_select_member on public.beatage_quizzes
  for select to authenticated
  using (
    exists (
      select 1 from public.beatage_quiz_members m
      where m.quiz_id = beatage_quizzes.id and m.user_id = auth.uid()
    )
  );

create policy beatage_quiz_members_select_member on public.beatage_quiz_members
  for select to authenticated
  using (
    exists (
      select 1 from public.beatage_quiz_members m
      where m.quiz_id = beatage_quiz_members.quiz_id and m.user_id = auth.uid()
    )
  );

create policy beatage_rounds_select_member on public.beatage_rounds
  for select to authenticated
  using (
    exists (
      select 1 from public.beatage_quiz_members m
      where m.quiz_id = beatage_rounds.quiz_id and m.user_id = auth.uid()
    )
  );

create policy beatage_guesses_select_member on public.beatage_guesses
  for select to authenticated
  using (
    exists (
      select 1
      from public.beatage_rounds r
      join public.beatage_quiz_members m on m.quiz_id = r.quiz_id
      where r.id = beatage_guesses.round_id and m.user_id = auth.uid()
    )
  );

create policy beatage_guesses_insert_own on public.beatage_guesses
  for insert to authenticated
  with check (user_id = auth.uid());

create policy beatage_guesses_update_own on public.beatage_guesses
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
