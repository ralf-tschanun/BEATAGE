-- Participant can leave a BEATAGE quiz they joined (mirrors leave_contest)

create or replace function public.leave_beatage_quiz(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.beatage_quiz_members%rowtype;
  v_host_plan text;
  v_expiry_days integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_member
  from public.beatage_quiz_members
  where quiz_id = p_quiz_id
    and user_id = v_uid
  for update;

  if not found then
    raise exception 'NOT_A_MEMBER';
  end if;

  if v_member.role = 'host' then
    raise exception 'HOST_CANNOT_LEAVE';
  end if;

  delete from public.beatage_quiz_members
  where id = v_member.id;

  select coalesce(p.plan, 'free') into v_host_plan
  from public.beatage_quizzes q
  left join public.beatage_profiles p on p.id = q.host_user_id
  where q.id = p_quiz_id;

  select inactivity_expiry_days into v_expiry_days
  from public.beatage_plan_limits(v_host_plan);

  update public.beatage_quizzes
  set
    last_activity_at = now(),
    expires_at = case
      when v_expiry_days is null then null
      else now() + make_interval(days => v_expiry_days)
    end
  where id = p_quiz_id;

  return jsonb_build_object('ok', true, 'id', p_quiz_id);
end;
$$;

revoke all on function public.leave_beatage_quiz(uuid) from public;
grant execute on function public.leave_beatage_quiz(uuid) to authenticated;
