-- Stamp revealed_at on candidates when the host reveals them.
-- Paste into the Supabase SQL editor.

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

  -- First reveal ends nominations.
  update public.contests
  set
    nominations_open = false,
    last_activity_at = now()
  where id = v_contest.id
  returning * into v_contest;

  if v_candidate.status <> 'pending' then
    return jsonb_build_object(
      'ok', true,
      'id', v_candidate.id,
      'status', v_candidate.status,
      'already_revealed', true,
      'nominations_open', false
    );
  end if;

  update public.candidates
  set
    status = 'visible',
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'revealed_at', now()
    )
  where id = p_candidate_id
  returning * into v_candidate;

  return jsonb_build_object(
    'ok', true,
    'id', v_candidate.id,
    'title', v_candidate.title,
    'status', v_candidate.status,
    'nominations_open', false
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
  v_sort text;
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

  v_sort := coalesce(v_contest.candidate_sort, 'nominated_at');

  select * into v_candidate
  from public.candidates
  where contest_id = p_contest_id
    and status = 'pending'
  order by
    case when v_sort = 'alphabetical' then lower(title) end asc nulls last,
    case when v_sort = 'random' then display_order end asc nulls last,
    created_at asc,
    id asc
  limit 1
  for update;

  if not found then
    raise exception 'NO_PENDING_CANDIDATES';
  end if;

  update public.candidates
  set
    status = 'visible',
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'revealed_at', now()
    )
  where id = v_candidate.id
  returning * into v_candidate;

  update public.contests
  set
    nominations_open = false,
    last_activity_at = now()
  where id = p_contest_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_candidate.id,
    'title', v_candidate.title,
    'artist', v_candidate.artist,
    'status', v_candidate.status,
    'nominations_open', false
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
  v_now timestamptz := now();
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
  set
    status = 'visible',
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'revealed_at', v_now
    )
  where contest_id = p_contest_id
    and status = 'pending';

  get diagnostics v_count = row_count;

  update public.contests
  set
    nominations_open = false,
    last_activity_at = now()
  where id = p_contest_id;

  return jsonb_build_object(
    'ok', true,
    'revealed_count', v_count,
    'nominations_open', false
  );
end;
$$;

revoke all on function public.reveal_all_candidates(uuid) from public;
grant execute on function public.reveal_all_candidates(uuid) to authenticated;
