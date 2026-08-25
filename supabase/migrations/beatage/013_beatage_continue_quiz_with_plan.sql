-- Promote a payment_pending unlock draft to a normal plan-limited quiz
-- when the host has a free active slot again (e.g. after finishing another quiz).

create or replace function public.beatage_continue_quiz_with_plan(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_quiz public.beatage_quizzes%rowtype;
  v_plan text;
  v_limits record;
  v_active_count integer;
  v_track_count integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_quiz_id is null then
    raise exception 'QUIZ_NOT_FOUND';
  end if;

  select * into v_quiz
  from public.beatage_quizzes
  where id = p_quiz_id;

  if not found then
    raise exception 'QUIZ_NOT_FOUND';
  end if;

  if v_quiz.host_user_id is distinct from v_uid then
    raise exception 'NOT_HOST';
  end if;

  if v_quiz.status is distinct from 'payment_pending' then
    raise exception 'NOT_PAYMENT_PENDING';
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

  select count(*)::integer into v_track_count
  from public.beatage_curated_tracks
  where quiz_id = p_quiz_id;

  if v_limits.max_curated_tracks is not null
     and v_track_count > v_limits.max_curated_tracks then
    raise exception 'TRACKS_OVER_PLAN:%', v_limits.max_curated_tracks;
  end if;

  update public.beatage_quizzes
  set
    status = 'open',
    unlocked_at = null,
    max_members = v_limits.max_members,
    max_rounds = v_limits.max_curated_tracks,
    expires_at = case
      when v_limits.inactivity_expiry_days is null then null
      else greatest(coalesce(last_activity_at, now()), now())
        + make_interval(days => v_limits.inactivity_expiry_days)
    end,
    last_activity_at = now()
  where id = p_quiz_id;

  return jsonb_build_object(
    'ok', true,
    'quiz_id', p_quiz_id,
    'join_code', v_quiz.join_code,
    'plan', v_plan,
    'max_members', v_limits.max_members,
    'max_curated_tracks', v_limits.max_curated_tracks
  );
end;
$$;

revoke all on function public.beatage_continue_quiz_with_plan(uuid) from public;
grant execute on function public.beatage_continue_quiz_with_plan(uuid) to authenticated;
