-- BEATAGE Phase 8a: extended schema + dashboard/create/join RPCs
-- Run in the same Supabase project after 001_beatage_initial.sql

-- ---------------------------------------------------------------------------
-- Extend quizzes
-- ---------------------------------------------------------------------------

alter table public.beatage_quizzes
  add column if not exists source text not null default 'curated'
    check (source in ('curated', 'spotify_live', 'shazam'));

alter table public.beatage_quizzes
  add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.beatage_quizzes
  add column if not exists chart_countries text[] not null default array['DE']::text[];

alter table public.beatage_quizzes
  drop constraint if exists beatage_quizzes_scoring_model_check;

alter table public.beatage_quizzes
  alter column scoring_model drop not null;

-- ---------------------------------------------------------------------------
-- Extend rounds (enrichment + guess window)
-- ---------------------------------------------------------------------------

alter table public.beatage_rounds
  add column if not exists original_release_year integer
    check (original_release_year is null or original_release_year between 1900 and 2100);

alter table public.beatage_rounds
  add column if not exists release_date date;

alter table public.beatage_rounds
  add column if not exists chart_was_number_one boolean;

alter table public.beatage_rounds
  add column if not exists chart_first_date date;

alter table public.beatage_rounds
  add column if not exists chart_weeks_at_one integer
    check (chart_weeks_at_one is null or chart_weeks_at_one >= 0);

alter table public.beatage_rounds
  add column if not exists guess_opens_at timestamptz;

alter table public.beatage_rounds
  add column if not exists guess_closes_at timestamptz;

alter table public.beatage_rounds
  add column if not exists previous_round_id uuid references public.beatage_rounds (id) on delete set null;

alter table public.beatage_rounds
  add column if not exists host_confirmed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Extend guesses (multi-mode payload)
-- ---------------------------------------------------------------------------

alter table public.beatage_guesses
  add column if not exists guessed_was_number_one boolean;

alter table public.beatage_guesses
  add column if not exists guessed_weeks integer
    check (guessed_weeks is null or guessed_weeks >= 0);

alter table public.beatage_guesses
  add column if not exists points_breakdown jsonb not null default '{}'::jsonb;

alter table public.beatage_guesses
  add column if not exists points_total integer not null default 0;

alter table public.beatage_guesses
  add column if not exists locked_at timestamptz;

-- Allow nullable year when only chart modes are active
alter table public.beatage_guesses
  alter column guessed_year drop not null;

-- ---------------------------------------------------------------------------
-- Curated track list
-- ---------------------------------------------------------------------------

create table if not exists public.beatage_curated_tracks (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.beatage_quizzes (id) on delete cascade,
  sort_order integer not null check (sort_order >= 0),
  spotify_track_id text,
  track_name text not null,
  artist_name text,
  album_art_url text,
  preview_url text,
  release_year integer check (release_year is null or release_year between 1900 and 2100),
  original_release_year integer check (original_release_year is null or original_release_year between 1900 and 2100),
  created_at timestamptz not null default now(),
  unique (quiz_id, sort_order)
);

create index if not exists beatage_curated_tracks_quiz_id_idx
  on public.beatage_curated_tracks (quiz_id);

alter table public.beatage_curated_tracks enable row level security;

create policy beatage_curated_tracks_select_member on public.beatage_curated_tracks
  for select to authenticated
  using (
    exists (
      select 1 from public.beatage_quiz_members m
      where m.quiz_id = beatage_curated_tracks.quiz_id and m.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------------

create or replace function public.get_beatage_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan text := 'free';
  v_hosted jsonb;
  v_joined jsonb;
  v_active_count integer;
begin
  if v_uid is null then
    return jsonb_build_object(
      'plan', 'free',
      'hosted', '[]'::jsonb,
      'joined', '[]'::jsonb,
      'active_hosted_count', 0
    );
  end if;

  select coalesce(plan, 'free') into v_plan
  from public.beatage_profiles
  where id = v_uid;

  if v_plan is null then
    insert into public.beatage_profiles (id) values (v_uid) on conflict (id) do nothing;
    v_plan := 'free';
  end if;

  select coalesce(
    jsonb_agg(
      (
        to_jsonb(q)
        || jsonb_build_object(
          'my_display_name', m.display_name,
          'member_count', (
            select count(*)::integer
            from public.beatage_quiz_members mm
            where mm.quiz_id = q.id
          )
        )
      )
      order by q.created_at desc
    ),
    '[]'::jsonb
  )
  into v_hosted
  from public.beatage_quizzes q
  join public.beatage_quiz_members m
    on m.quiz_id = q.id
   and m.user_id = v_uid
   and m.role = 'host'
  where q.host_user_id = v_uid;

  select coalesce(
    jsonb_agg(
      (
        to_jsonb(q)
        || jsonb_build_object(
          'my_display_name', m.display_name,
          'member_count', (
            select count(*)::integer
            from public.beatage_quiz_members mm
            where mm.quiz_id = q.id
          )
        )
      )
      order by m.joined_at desc
    ),
    '[]'::jsonb
  )
  into v_joined
  from public.beatage_quiz_members m
  join public.beatage_quizzes q on q.id = m.quiz_id
  where m.user_id = v_uid
    and m.role = 'participant';

  select count(*)::integer into v_active_count
  from public.beatage_quizzes
  where host_user_id = v_uid
    and status in ('draft', 'open', 'playing')
    and unlocked_at is null;

  return jsonb_build_object(
    'plan', v_plan,
    'hosted', v_hosted,
    'joined', v_joined,
    'active_hosted_count', v_active_count
  );
end;
$$;

revoke all on function public.get_beatage_dashboard() from public;
grant execute on function public.get_beatage_dashboard() to authenticated;

-- ---------------------------------------------------------------------------
-- Create quiz
-- ---------------------------------------------------------------------------

create or replace function public.create_beatage_quiz(
  p_title text,
  p_host_name text,
  p_description text default null,
  p_source text default 'curated',
  p_settings jsonb default '{}'::jsonb,
  p_chart_countries text[] default array['DE']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan text;
  v_limits record;
  v_active_count integer;
  v_join_code text;
  v_manage_token text;
  v_quiz public.beatage_quizzes%rowtype;
  v_attempts integer := 0;
  v_source text := lower(trim(coalesce(p_source, 'curated')));
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if char_length(trim(coalesce(p_title, ''))) < 1 then
    raise exception 'TITLE_REQUIRED';
  end if;

  if char_length(trim(coalesce(p_host_name, ''))) < 1 then
    raise exception 'HOST_NAME_REQUIRED';
  end if;

  if v_source not in ('curated', 'spotify_live', 'shazam') then
    raise exception 'INVALID_SOURCE';
  end if;

  select coalesce(plan, 'free') into v_plan
  from public.beatage_profiles
  where id = v_uid;

  if v_plan is null then
    insert into public.beatage_profiles (id) values (v_uid) on conflict (id) do nothing;
    v_plan := 'free';
  end if;

  select * into v_limits from public.beatage_plan_limits(v_plan);

  select count(*)::integer into v_active_count
  from public.beatage_quizzes
  where host_user_id = v_uid
    and status in ('draft', 'open', 'playing')
    and unlocked_at is null;

  if v_limits.max_active_quizzes is not null
     and v_active_count >= v_limits.max_active_quizzes then
    raise exception 'ACTIVE_QUIZ_LIMIT';
  end if;

  loop
    v_join_code := public.generate_join_code();
    v_manage_token := public.generate_manage_token();
    begin
      insert into public.beatage_quizzes (
        title,
        description,
        status,
        source,
        settings,
        chart_countries,
        host_user_id,
        max_members,
        join_code,
        manage_token,
        last_activity_at,
        expires_at
      )
      values (
        trim(p_title),
        nullif(trim(coalesce(p_description, '')), ''),
        'open',
        v_source,
        coalesce(p_settings, '{}'::jsonb),
        coalesce(p_chart_countries, array['DE']::text[]),
        v_uid,
        v_limits.max_members,
        v_join_code,
        v_manage_token,
        now(),
        case
          when v_limits.inactivity_expiry_days is null then null
          else now() + make_interval(days => v_limits.inactivity_expiry_days)
        end
      )
      returning * into v_quiz;
      exit;
    exception when unique_violation then
      v_attempts := v_attempts + 1;
      if v_attempts > 8 then
        raise exception 'CODE_GENERATION_FAILED';
      end if;
    end;
  end loop;

  insert into public.beatage_quiz_members (quiz_id, user_id, display_name, role)
  values (v_quiz.id, v_uid, trim(p_host_name), 'host');

  update public.profiles
  set display_name = trim(p_host_name), updated_at = now()
  where id = v_uid
    and (display_name is null or btrim(display_name) = '');

  return jsonb_build_object(
    'id', v_quiz.id,
    'title', v_quiz.title,
    'join_code', v_quiz.join_code,
    'manage_token', v_quiz.manage_token,
    'max_members', v_quiz.max_members,
    'expires_at', v_quiz.expires_at,
    'source', v_quiz.source
  );
end;
$$;

revoke all on function public.create_beatage_quiz(text, text, text, text, jsonb, text[]) from public;
grant execute on function public.create_beatage_quiz(text, text, text, text, jsonb, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Join preview + join
-- ---------------------------------------------------------------------------

create or replace function public.get_beatage_quiz_by_join_code(p_join_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz public.beatage_quizzes%rowtype;
  v_member_count integer;
begin
  select * into v_quiz
  from public.beatage_quizzes
  where join_code = upper(trim(p_join_code));

  if not found then
    return null;
  end if;

  if v_quiz.expires_at is not null and v_quiz.expires_at < now()
     and v_quiz.status in ('draft', 'open', 'playing') then
    update public.beatage_quizzes set status = 'expired' where id = v_quiz.id;
    v_quiz.status := 'expired';
  end if;

  select count(*)::integer into v_member_count
  from public.beatage_quiz_members
  where quiz_id = v_quiz.id;

  return jsonb_build_object(
    'id', v_quiz.id,
    'title', v_quiz.title,
    'description', v_quiz.description,
    'status', v_quiz.status,
    'source', v_quiz.source,
    'max_members', v_quiz.max_members,
    'member_count', v_member_count,
    'expires_at', v_quiz.expires_at,
    'is_full', case
      when v_quiz.max_members is null then false
      else v_member_count >= v_quiz.max_members
    end
  );
end;
$$;

revoke all on function public.get_beatage_quiz_by_join_code(text) from public;
grant execute on function public.get_beatage_quiz_by_join_code(text) to anon, authenticated;

create or replace function public.join_beatage_quiz(
  p_join_code text,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_quiz public.beatage_quizzes%rowtype;
  v_member_count integer;
  v_existing public.beatage_quiz_members%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if char_length(trim(coalesce(p_display_name, ''))) < 1 then
    raise exception 'DISPLAY_NAME_REQUIRED';
  end if;

  select * into v_quiz
  from public.beatage_quizzes
  where join_code = upper(trim(p_join_code));

  if not found then
    raise exception 'QUIZ_NOT_FOUND';
  end if;

  if v_quiz.status not in ('open', 'playing') then
    raise exception 'QUIZ_NOT_JOINABLE';
  end if;

  if v_quiz.expires_at is not null and v_quiz.expires_at < now() then
    update public.beatage_quizzes set status = 'expired' where id = v_quiz.id;
    raise exception 'QUIZ_EXPIRED';
  end if;

  select * into v_existing
  from public.beatage_quiz_members
  where quiz_id = v_quiz.id and user_id = v_uid;

  if found then
    return jsonb_build_object(
      'quiz_id', v_quiz.id,
      'join_code', v_quiz.join_code,
      'already_member', true
    );
  end if;

  select count(*)::integer into v_member_count
  from public.beatage_quiz_members
  where quiz_id = v_quiz.id;

  if v_quiz.max_members is not null and v_member_count >= v_quiz.max_members then
    raise exception 'QUIZ_FULL';
  end if;

  insert into public.beatage_quiz_members (quiz_id, user_id, display_name, role)
  values (
    v_quiz.id,
    v_uid,
    trim(p_display_name),
    case when v_quiz.host_user_id = v_uid then 'host' else 'participant' end
  );

  update public.profiles
  set display_name = trim(p_display_name), updated_at = now()
  where id = v_uid
    and (display_name is null or btrim(display_name) = '');

  update public.beatage_quizzes
  set last_activity_at = now()
  where id = v_quiz.id;

  return jsonb_build_object(
    'quiz_id', v_quiz.id,
    'join_code', v_quiz.join_code,
    'already_member', false
  );
end;
$$;

revoke all on function public.join_beatage_quiz(text, text) from public;
grant execute on function public.join_beatage_quiz(text, text) to authenticated;
