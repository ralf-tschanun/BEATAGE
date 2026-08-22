-- Participants can leave a contest they joined
-- Paste ONLY this SQL into the Supabase SQL editor

create or replace function public.leave_contest(p_contest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.contest_members%rowtype;
  v_host_plan text;
  v_expiry_days integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_member
  from public.contest_members
  where contest_id = p_contest_id
    and user_id = v_uid
  for update;

  if not found then
    raise exception 'NOT_A_MEMBER';
  end if;

  if v_member.role = 'host' then
    raise exception 'HOST_CANNOT_LEAVE';
  end if;

  delete from public.contest_members
  where id = v_member.id;

  -- Refresh activity window based on host plan
  select coalesce(p.plan, 'free') into v_host_plan
  from public.contests c
  left join public.profiles p on p.id = c.host_user_id
  where c.id = p_contest_id;

  select inactivity_expiry_days into v_expiry_days
  from public.plan_limits(v_host_plan);

  update public.contests
  set
    last_activity_at = now(),
    expires_at = case
      when v_expiry_days is null then null
      else now() + make_interval(days => v_expiry_days)
    end
  where id = p_contest_id;

  return jsonb_build_object('ok', true, 'id', p_contest_id);
end;
$$;

revoke all on function public.leave_contest(uuid) from public;
grant execute on function public.leave_contest(uuid) to authenticated;
