-- Candidate reveal: batch + sequential
-- Paste ONLY this SQL into the Supabase SQL editor

create or replace function public.reveal_candidate(p_candidate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_candidate public.candidates%rowtype;
  v_contest public.contests%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_candidate
  from public.candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'CANDIDATE_NOT_FOUND';
  end if;

  if v_candidate.status = 'withdrawn' then
    raise exception 'CANDIDATE_WITHDRAWN';
  end if;

  if v_candidate.status <> 'pending' then
    return jsonb_build_object(
      'ok', true,
      'id', v_candidate.id,
      'status', v_candidate.status,
      'already_revealed', true
    );
  end if;

  select * into v_contest
  from public.contests
  where id = v_candidate.contest_id
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

  if coalesce(v_contest.candidate_reveal, 'live') not in ('admin_batch', 'admin_sequential') then
    raise exception 'REVEAL_NOT_REQUIRED';
  end if;

  if v_contest.voting_open or v_contest.status = 'voting' then
    raise exception 'VOTING_ALREADY_OPEN';
  end if;

  update public.candidates
  set status = 'visible'
  where id = p_candidate_id
  returning * into v_candidate;

  update public.contests
  set last_activity_at = now()
  where id = v_contest.id;

  return jsonb_build_object(
    'ok', true,
    'id', v_candidate.id,
    'title', v_candidate.title,
    'status', v_candidate.status
  );
end;
$$;

revoke all on function public.reveal_candidate(uuid) from public;
grant execute on function public.reveal_candidate(uuid) to authenticated;

create or replace function public.reveal_next_candidate(p_contest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_candidate public.candidates%rowtype;
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

  if coalesce(v_contest.candidate_reveal, 'live') <> 'admin_sequential' then
    raise exception 'REVEAL_NOT_REQUIRED';
  end if;

  if v_contest.voting_open or v_contest.status = 'voting' then
    raise exception 'VOTING_ALREADY_OPEN';
  end if;

  select * into v_candidate
  from public.candidates
  where contest_id = p_contest_id
    and status = 'pending'
  order by created_at asc
  limit 1
  for update;

  if not found then
    raise exception 'NO_PENDING_CANDIDATES';
  end if;

  update public.candidates
  set status = 'visible'
  where id = v_candidate.id
  returning * into v_candidate;

  update public.contests
  set last_activity_at = now()
  where id = p_contest_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_candidate.id,
    'title', v_candidate.title,
    'artist', v_candidate.artist,
    'status', v_candidate.status
  );
end;
$$;

revoke all on function public.reveal_next_candidate(uuid) from public;
grant execute on function public.reveal_next_candidate(uuid) to authenticated;

create or replace function public.reveal_all_candidates(p_contest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_count integer;
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

  if coalesce(v_contest.candidate_reveal, 'live') not in ('admin_batch', 'admin_sequential') then
    raise exception 'REVEAL_NOT_REQUIRED';
  end if;

  if v_contest.voting_open or v_contest.status = 'voting' then
    raise exception 'VOTING_ALREADY_OPEN';
  end if;

  update public.candidates
  set status = 'visible'
  where contest_id = p_contest_id
    and status = 'pending';

  get diagnostics v_count = row_count;

  update public.contests
  set last_activity_at = now()
  where id = p_contest_id;

  return jsonb_build_object(
    'ok', true,
    'revealed_count', v_count
  );
end;
$$;

revoke all on function public.reveal_all_candidates(uuid) from public;
grant execute on function public.reveal_all_candidates(uuid) to authenticated;

create or replace function public.start_voting(p_contest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_count integer;
  v_pending integer;
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

  if v_contest.status = 'voting' and v_contest.voting_open then
    return jsonb_build_object(
      'ok', true,
      'status', v_contest.status,
      'voting_open', v_contest.voting_open
    );
  end if;

  if v_contest.status not in ('open', 'voting') then
    raise exception 'VOTING_NOT_ALLOWED';
  end if;

  select count(*)::integer into v_count
  from public.candidates
  where contest_id = p_contest_id
    and status <> 'withdrawn'
    and status <> 'rejected';

  if v_count < 1 then
    raise exception 'NO_CANDIDATES';
  end if;

  if coalesce(v_contest.candidate_reveal, 'live') in ('admin_batch', 'admin_sequential') then
    select count(*)::integer into v_pending
    from public.candidates
    where contest_id = p_contest_id
      and status = 'pending';

    if v_pending > 0 then
      raise exception 'CANDIDATES_NOT_REVEALED';
    end if;
  end if;

  if v_contest.voting_close_mode = 'scheduled'
     and (
       v_contest.voting_closes_at is null
       or v_contest.voting_closes_at <= now()
     ) then
    raise exception 'VOTING_CLOSE_REQUIRED';
  end if;

  -- Live: pending should not exist, but keep pending→in_voting for safety.
  -- Admin modes: only already-visible candidates enter voting.
  if coalesce(v_contest.candidate_reveal, 'live') = 'live' then
    update public.candidates
    set status = 'in_voting'
    where contest_id = p_contest_id
      and status in ('pending', 'visible');
  else
    update public.candidates
    set status = 'in_voting'
    where contest_id = p_contest_id
      and status = 'visible';
  end if;

  select count(*)::integer into v_count
  from public.candidates
  where contest_id = p_contest_id
    and status = 'in_voting';

  if v_count < 1 then
    raise exception 'NO_CANDIDATES';
  end if;

  update public.contests
  set
    status = 'voting',
    voting_open = true,
    nominations_open = false,
    last_activity_at = now()
  where id = p_contest_id
  returning * into v_contest;

  return jsonb_build_object(
    'ok', true,
    'status', v_contest.status,
    'voting_open', v_contest.voting_open,
    'candidate_count', v_count
  );
end;
$$;

revoke all on function public.start_voting(uuid) from public;
grant execute on function public.start_voting(uuid) to authenticated;
