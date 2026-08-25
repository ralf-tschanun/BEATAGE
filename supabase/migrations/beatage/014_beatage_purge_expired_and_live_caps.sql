-- Delete quizzes when inactivity expiry elapses (frees storage).
-- Also purge already-marked expired rows.

create or replace function public.beatage_purge_expired_quizzes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  with doomed as (
    delete from public.beatage_quizzes
    where
      (expires_at is not null and expires_at < now())
      or (
        status = 'expired'
        and coalesce(last_activity_at, created_at) < now() - interval '1 day'
      )
    returning id
  )
  select count(*)::integer into v_deleted from doomed;

  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end;
$$;

revoke all on function public.beatage_purge_expired_quizzes() from public;
grant execute on function public.beatage_purge_expired_quizzes() to service_role;

-- On access: delete immediately instead of only marking expired.
create or replace function public.get_beatage_quiz_by_join_code(p_join_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz public.beatage_quizzes%rowtype;
  v_member_count integer;
  v_my_role text;
begin
  select * into v_quiz
  from public.beatage_quizzes
  where join_code = upper(trim(p_join_code));

  if not found then
    return null;
  end if;

  if v_quiz.expires_at is not null and v_quiz.expires_at < now() then
    delete from public.beatage_quizzes where id = v_quiz.id;
    return null;
  end if;

  select count(*)::integer into v_member_count
  from public.beatage_quiz_members
  where quiz_id = v_quiz.id;

  select m.role into v_my_role
  from public.beatage_quiz_members m
  where m.quiz_id = v_quiz.id
    and m.user_id = auth.uid();

  return jsonb_build_object(
    'id', v_quiz.id,
    'title', v_quiz.title,
    'description', v_quiz.description,
    'status', v_quiz.status,
    'source', v_quiz.source,
    'join_code', v_quiz.join_code,
    'host_user_id', v_quiz.host_user_id,
    'max_members', v_quiz.max_members,
    'member_count', v_member_count,
    'expires_at', v_quiz.expires_at,
    'my_role', v_my_role,
    'is_host', v_quiz.host_user_id is not distinct from auth.uid(),
    'is_full', case
      when v_quiz.max_members is null then false
      else v_member_count >= v_quiz.max_members
    end
  );
end;
$$;

revoke all on function public.get_beatage_quiz_by_join_code(text) from public;
grant execute on function public.get_beatage_quiz_by_join_code(text) to anon, authenticated;

-- Join: purge expired quiz instead of marking status.
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
    delete from public.beatage_quizzes where id = v_quiz.id;
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

-- Opportunistic purge when loading the dashboard.
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
  -- Best-effort storage cleanup (ignore failures).
  begin
    perform public.beatage_purge_expired_quizzes();
  exception when others then
    null;
  end;

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
          ),
          'my_rank', public.beatage_quiz_member_rank(q.id, v_uid)
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
          ),
          'my_rank', public.beatage_quiz_member_rank(q.id, v_uid)
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
