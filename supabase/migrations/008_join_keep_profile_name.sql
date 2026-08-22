-- Keep profile display_name stable on join; contest name can differ
-- Paste ONLY this SQL into the Supabase SQL editor

create or replace function public.join_contest(
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
  v_contest public.contests%rowtype;
  v_member_count integer;
  v_existing public.contest_members%rowtype;
  v_expiry_days integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if char_length(trim(coalesce(p_display_name, ''))) < 1 then
    raise exception 'DISPLAY_NAME_REQUIRED';
  end if;

  select * into v_contest
  from public.contests
  where join_code = upper(trim(p_join_code))
  for update;

  if not found then
    raise exception 'CONTEST_NOT_FOUND';
  end if;

  if v_contest.expires_at is not null and v_contest.expires_at < now() then
    update public.contests set status = 'expired' where id = v_contest.id;
    raise exception 'CONTEST_EXPIRED';
  end if;

  if v_contest.status not in ('open', 'voting') then
    raise exception 'CONTEST_NOT_JOINABLE';
  end if;

  select * into v_existing
  from public.contest_members
  where contest_id = v_contest.id and user_id = v_uid;

  if found then
    return jsonb_build_object(
      'id', v_contest.id,
      'join_code', v_contest.join_code,
      'already_member', true,
      'role', v_existing.role
    );
  end if;

  select count(*)::integer into v_member_count
  from public.contest_members
  where contest_id = v_contest.id;

  if v_contest.max_members is not null and v_member_count >= v_contest.max_members then
    raise exception 'CONTEST_FULL';
  end if;

  insert into public.contest_members (contest_id, user_id, display_name, role)
  values (v_contest.id, v_uid, trim(p_display_name), 'participant');

  -- Extend expiry based on host plan
  select inactivity_expiry_days into v_expiry_days
  from public.plan_limits(
    (select coalesce(plan, 'free') from public.profiles where id = v_contest.host_user_id)
  );

  update public.contests
  set
    last_activity_at = now(),
    expires_at = case
      when v_expiry_days is null then null
      else now() + make_interval(days => v_expiry_days)
    end
  where id = v_contest.id;

  update public.profiles
  set display_name = trim(p_display_name), updated_at = now()
  where id = v_uid
    and (display_name is null or btrim(display_name) = '');

  return jsonb_build_object(
    'id', v_contest.id,
    'join_code', v_contest.join_code,
    'already_member', false,
    'role', 'participant'
  );
end;
$$;

revoke all on function public.join_contest(text, text) from public;
grant execute on function public.join_contest(text, text) to authenticated;
