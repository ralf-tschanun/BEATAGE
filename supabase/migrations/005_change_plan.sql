-- Temporary password-gated plan changes
-- Paste ONLY this SQL into the Supabase SQL editor

create or replace function public.change_plan(p_plan text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan text := lower(trim(coalesce(p_plan, '')));
  v_password text := coalesce(p_password, '');
  v_limits record;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if v_plan not in ('free', 'plus', 'pro') then
    raise exception 'INVALID_PLAN';
  end if;

  if v_plan = 'plus' and v_password is distinct from 'Plus' then
    raise exception 'INVALID_PASSWORD';
  end if;

  if v_plan = 'pro' and v_password is distinct from 'Pro' then
    raise exception 'INVALID_PASSWORD';
  end if;

  -- Free requires no password
  if v_plan = 'free' then
    v_password := '';
  end if;

  insert into public.profiles (id, plan)
  values (v_uid, v_plan)
  on conflict (id) do update
  set plan = excluded.plan, updated_at = now();

  select * into v_limits from public.plan_limits(v_plan);

  -- Apply new limits to contests hosted by this user
  update public.contests
  set
    mode = v_limits.mode,
    max_members = v_limits.max_members,
    expires_at = case
      when v_limits.inactivity_expiry_days is null then null
      else greatest(coalesce(last_activity_at, now()), now())
        + make_interval(days => v_limits.inactivity_expiry_days)
    end
  where host_user_id = v_uid
    and status in ('draft', 'open', 'voting', 'finished');

  return jsonb_build_object(
    'ok', true,
    'plan', v_plan,
    'max_members', v_limits.max_members,
    'mode', v_limits.mode
  );
end;
$$;

revoke all on function public.change_plan(text, text) from public;
grant execute on function public.change_plan(text, text) to authenticated;
