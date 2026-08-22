-- Schedule voting close in N seconds (host countdown)
-- Paste ONLY this SQL into the Supabase SQL editor

create or replace function public.schedule_close_voting(
  p_contest_id uuid,
  p_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_seconds integer := coalesce(p_seconds, 30);
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if v_seconds < 5 or v_seconds > 3600 then
    raise exception 'INVALID_SETTINGS';
  end if;

  select * into v_contest
  from public.contests
  where id = p_contest_id
  for update;

  if not found then
    raise exception 'CONTEST_NOT_FOUND';
  end if;

  if v_contest.host_user_id <> v_uid then
    raise exception 'NOT_HOST';
  end if;

  if v_contest.status <> 'voting' or not v_contest.voting_open then
    raise exception 'VOTING_NOT_OPEN';
  end if;

  update public.contests
  set
    voting_close_mode = 'scheduled',
    voting_closes_at = now() + make_interval(secs => v_seconds),
    last_activity_at = now()
  where id = p_contest_id
  returning * into v_contest;

  return jsonb_build_object(
    'ok', true,
    'voting_close_mode', v_contest.voting_close_mode,
    'voting_closes_at', v_contest.voting_closes_at
  );
end;
$$;

revoke all on function public.schedule_close_voting(uuid, integer) from public;
grant execute on function public.schedule_close_voting(uuid, integer) to authenticated;
