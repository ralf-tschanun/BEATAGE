-- Quiz unlock-at-create (MyContest pattern): payment_pending drafts bypass ACTIVE_QUIZ_LIMIT.
-- Paste into the Supabase SQL editor after 001–007.

-- ---------------------------------------------------------------------------
-- Status: allow payment_pending
-- ---------------------------------------------------------------------------

alter table public.beatage_quizzes
  drop constraint if exists beatage_quizzes_status_check;

alter table public.beatage_quizzes
  add constraint beatage_quizzes_status_check
  check (status in ('draft', 'open', 'playing', 'finished', 'expired', 'payment_pending'));

-- ---------------------------------------------------------------------------
-- Unlock: lift caps + promote payment_pending → open
-- ---------------------------------------------------------------------------

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
    max_members = null,
    expires_at = null,
    max_rounds = null,
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

-- ---------------------------------------------------------------------------
-- Active slot count: unlocked + payment_pending do not consume the free slot
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
    and m.role = 'participant'
    and q.status <> 'payment_pending';

  -- Free/Plus slot: only locked active quizzes count (unlocked and pending do not).
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
-- Create: optional unlock intent → payment_pending, bypass ACTIVE_QUIZ_LIMIT
-- ---------------------------------------------------------------------------

drop function if exists public.create_beatage_quiz(text, text, text, text, jsonb, text[]);

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

-- Join: payment_pending is not joinable (patch only — keep existing body otherwise)
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

  if v_quiz.status = 'payment_pending' then
    raise exception 'QUIZ_NOT_JOINABLE';
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
