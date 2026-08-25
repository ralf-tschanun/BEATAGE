-- Allow Last.fm live as a quiz source (Now Playing via scrobble, no Spotify OAuth).

alter table public.beatage_quizzes
  drop constraint if exists beatage_quizzes_source_check;

alter table public.beatage_quizzes
  add constraint beatage_quizzes_source_check
  check (source in ('curated', 'spotify_live', 'shazam', 'lastfm_live'));

-- Recreate create RPC with lastfm_live allowed (body matches 008 + source whitelist).
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
        v_status,
        v_source,
        coalesce(p_settings, '{}'::jsonb),
        coalesce(p_chart_countries, array['DE']::text[]),
        v_uid,
        v_limits.max_members,
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
