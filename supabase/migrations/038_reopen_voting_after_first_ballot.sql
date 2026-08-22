-- Block reopen_voting once any results presentation step has been taken.

create or replace function public.reopen_voting(p_contest_id uuid)
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

  if v_contest.status <> 'finished' then
    raise exception 'VOTING_NOT_FINISHED';
  end if;

  if coalesce(v_contest.results_phase, 'candidates') = 'done' then
    raise exception 'PRESENTATION_COMPLETE';
  end if;

  if coalesce(v_contest.results_reveal, 'immediate') = 'immediate' then
    raise exception 'PRESENTATION_STARTED';
  end if;

  if coalesce(v_contest.results_reveal_step, 0) > 0
     or coalesce(v_contest.nominator_reveal_step, 0) > 0 then
    raise exception 'PRESENTATION_STARTED';
  end if;

  update public.contests
  set
    status = 'voting',
    voting_open = true,
    nominations_open = false,
    results_reveal_step = 0,
    nominator_reveal_step = 0,
    results_phase = 'candidates',
    last_activity_at = now()
  where id = p_contest_id
  returning * into v_contest;

  return jsonb_build_object(
    'ok', true,
    'status', v_contest.status,
    'voting_open', v_contest.voting_open,
    'results_phase', v_contest.results_phase
  );
end;
$$;

revoke all on function public.reopen_voting(uuid) from public;
grant execute on function public.reopen_voting(uuid) to authenticated;
