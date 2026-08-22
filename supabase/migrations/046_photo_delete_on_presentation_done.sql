-- Clear opt-out photos only when results presentation finishes (phase = done),
-- not when voting closes. Paste into the Supabase SQL editor.

-- Revert early clears from close_voting / maybe_auto_close_voting
create or replace function public.close_voting(p_contest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_phase text := 'candidates';
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

  if v_contest.status = 'finished' then
    return jsonb_build_object(
      'ok', true,
      'status', 'finished',
      'results_reveal', v_contest.results_reveal,
      'results_reveal_step', v_contest.results_reveal_step,
      'results_phase', v_contest.results_phase
    );
  end if;

  if v_contest.status <> 'voting' then
    raise exception 'VOTING_NOT_OPEN';
  end if;

  if v_contest.nominator_ranking and v_contest.nominator_ranking_when = 'before' then
    v_phase := 'nominators';
  else
    v_phase := 'candidates';
  end if;

  update public.contests
  set
    status = 'finished',
    voting_open = false,
    nominations_open = false,
    results_reveal_step = 0,
    nominator_reveal_step = 0,
    results_phase = v_phase,
    last_activity_at = now()
  where id = p_contest_id
  returning * into v_contest;

  return jsonb_build_object(
    'ok', true,
    'status', v_contest.status,
    'voting_open', v_contest.voting_open,
    'results_reveal', v_contest.results_reveal,
    'results_reveal_step', v_contest.results_reveal_step,
    'results_phase', v_contest.results_phase,
    'nominator_reveal_step', v_contest.nominator_reveal_step
  );
end;
$$;

revoke all on function public.close_voting(uuid) from public;
grant execute on function public.close_voting(uuid) to authenticated;

create or replace function public.maybe_auto_close_voting(p_contest_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contest public.contests%rowtype;
  v_phase text := 'candidates';
begin
  select * into v_contest
  from public.contests
  where id = p_contest_id
  for update;

  if not found then
    return false;
  end if;

  if v_contest.status = 'finished' then
    return false;
  end if;

  if v_contest.voting_close_mode = 'scheduled'
     and v_contest.voting_closes_at is not null
     and v_contest.voting_closes_at <= now()
     and v_contest.status = 'voting'
     and v_contest.voting_open
  then
    if v_contest.nominator_ranking and v_contest.nominator_ranking_when = 'before' then
      v_phase := 'nominators';
    else
      v_phase := 'candidates';
    end if;

    update public.contests
    set
      status = 'finished',
      voting_open = false,
      nominations_open = false,
      results_reveal_step = 0,
      nominator_reveal_step = 0,
      results_phase = v_phase,
      last_activity_at = now()
    where id = p_contest_id;

    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.maybe_auto_close_voting(uuid) from public;
grant execute on function public.maybe_auto_close_voting(uuid) to authenticated;

-- When the host finishes the full results presentation, clear opted-out photos.
create or replace function public.trg_clear_photos_on_presentation_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.results_phase = 'done'
     and coalesce(old.results_phase, '') is distinct from 'done' then
    perform public.clear_opt_out_contest_photos(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists contests_clear_photos_on_presentation_done on public.contests;
create trigger contests_clear_photos_on_presentation_done
  after update of results_phase on public.contests
  for each row
  execute function public.trg_clear_photos_on_presentation_done();
