-- Plan limits: Free 1/10/10/7d · Plus 5/30/30/183d · Pro 10/100/100/none
-- Unlock: 100 songs, 100 participants, no expiry (still skips active slot).

-- Return type changed (added max_curated_tracks) — must drop first.
drop function if exists public.beatage_plan_limits(text);

create or replace function public.beatage_plan_limits(p_plan text)
returns table (
  max_active_quizzes integer,
  max_members integer,
  inactivity_expiry_days integer,
  max_curated_tracks integer
)
language sql
stable
as $$
  select
    case lower(trim(coalesce(p_plan, '')))
      when 'plus' then 5
      when 'pro' then 10
      else 1
    end,
    case lower(trim(coalesce(p_plan, '')))
      when 'plus' then 30
      when 'pro' then 100
      else 10
    end,
    case lower(trim(coalesce(p_plan, '')))
      when 'plus' then 183
      when 'pro' then null
      else 7
    end,
    case lower(trim(coalesce(p_plan, '')))
      when 'plus' then 30
      when 'pro' then 100
      else 10
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
    max_rounds = v_limits.max_curated_tracks,
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
  v_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select host_user_id, status into v_host, v_status
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
    max_members = 100,
    expires_at = null,
    max_rounds = 100,
    status = case
      when status = 'payment_pending' then 'open'
      else status
    end,
    last_activity_at = now()
  where id = p_quiz_id;

  return jsonb_build_object(
    'ok', true,
    'quiz_id', p_quiz_id,
    'promoted_from_pending', v_status = 'payment_pending'
  );
end;
$$;

revoke all on function public.beatage_unlock_quiz_from_billing(uuid, uuid) from public;
grant execute on function public.beatage_unlock_quiz_from_billing(uuid, uuid) to service_role;

-- Create: unlock-at-create uses unlock member/song caps; plan quizzes store max_rounds.
create or replace function public.create_beatage_quiz(
  p_title text,
  p_host_name text,
  p_description text default null,
  p_source text default 'curated',
  p_settings jsonb default '{}'::jsonb,
  p_chart_countries text[] default array['DE']::text[],
  p_requires_unlock boolean default false
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
  v_status text;
  v_max_members integer;
  v_max_rounds integer;
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

  if v_source not in ('curated', 'spotify_live', 'shazam', 'lastfm_live') then
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

  if not p_requires_unlock
     and v_limits.max_active_quizzes is not null
     and v_active_count >= v_limits.max_active_quizzes then
    raise exception 'ACTIVE_QUIZ_LIMIT';
  end if;

  v_status := case when p_requires_unlock then 'payment_pending' else 'open' end;

  if p_requires_unlock then
    v_max_members := 100;
    v_max_rounds := 100;
  else
    v_max_members := v_limits.max_members;
    v_max_rounds := v_limits.max_curated_tracks;
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
        max_rounds,
        join_code,
        manage_token,
        last_activity_at,
        expires_at
      )
      values (
        trim(p_title),
        nullif(trim(coalesce(p_description, '')), ''),
        v_status,
        v_source,
        coalesce(p_settings, '{}'::jsonb),
        coalesce(p_chart_countries, array['DE']::text[]),
        v_uid,
        v_max_members,
        v_max_rounds,
        v_join_code,
        v_manage_token,
        now(),
        case
          when p_requires_unlock then null
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
    'source', v_quiz.source,
    'status', v_quiz.status,
    'requires_unlock', p_requires_unlock
  );
end;
$$;

revoke all on function public.create_beatage_quiz(text, text, text, text, jsonb, text[], boolean) from public;
grant execute on function public.create_beatage_quiz(text, text, text, text, jsonb, text[], boolean) to authenticated;
