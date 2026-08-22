-- Fix reopen nominations: clear expired deadline so auto-close doesn't immediately
-- close again, and track reopened_at for UI status.

alter table public.contests
  add column if not exists nominations_reopened_at timestamptz;

create or replace function public.open_nominations(p_contest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
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

  if v_contest.status in ('finished', 'expired') then
    raise exception 'CONTEST_LOCKED';
  end if;

  if v_contest.status <> 'open' then
    raise exception 'NOMINATIONS_CANNOT_REOPEN';
  end if;

  if v_contest.voting_open then
    raise exception 'VOTING_IN_PROGRESS';
  end if;

  -- Clear any past/pending countdown deadline; otherwise maybe_auto_close_nominations
  -- (and birthday RPCs) treat nominations as closed again immediately.
  update public.contests
  set
    nominations_open = true,
    nomination_deadline = null,
    nominations_reopened_at = now(),
    last_activity_at = now()
  where id = p_contest_id
  returning * into v_contest;

  return jsonb_build_object(
    'ok', true,
    'nominations_open', v_contest.nominations_open,
    'nomination_deadline', v_contest.nomination_deadline,
    'nominations_reopened_at', v_contest.nominations_reopened_at
  );
end;
$$;

revoke all on function public.open_nominations(uuid) from public;
grant execute on function public.open_nominations(uuid) to authenticated;
