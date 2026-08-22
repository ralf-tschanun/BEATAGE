-- Voting: ballots, start / cast / close
-- Paste ONLY this SQL into the Supabase SQL editor

create table if not exists public.ballots (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade,
  voter_user_id uuid not null references auth.users (id) on delete cascade,
  -- Ordered candidate IDs: index 0 = 1st place, index 1 = 2nd, …
  rankings uuid[] not null default '{}',
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contest_id, voter_user_id)
);

create index if not exists ballots_contest_id_idx on public.ballots (contest_id);
create index if not exists ballots_voter_user_id_idx on public.ballots (voter_user_id);

alter table public.ballots enable row level security;

drop policy if exists "ballots_select_member" on public.ballots;
create policy "ballots_select_member"
  on public.ballots for select
  using (
    public.is_contest_member(contest_id)
    and (
      voter_user_id = auth.uid()
      or exists (
        select 1 from public.contests c
        where c.id = contest_id
          and (
            c.status = 'finished'
            or c.host_user_id = auth.uid()
          )
      )
    )
  );

-- Scoring slot count for a model (must stay in sync with src/lib/plans.ts)
create or replace function public.scoring_slot_count(p_model text)
returns integer
language sql
immutable
as $$
  select case p_model
    when 'best_only' then 1
    when 'linear3' then 3
    when 'linear5' then 5
    when 'linear12' then 12
    when 'dyn4' then 4
    when 'dyn6' then 6
    when 'dyn10' then 10
    else 5
  end;
$$;

create or replace function public.maybe_auto_close_voting(p_contest_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contest public.contests%rowtype;
begin
  select * into v_contest
  from public.contests
  where id = p_contest_id
  for update;

  if not found then
    return false;
  end if;

  if v_contest.status = 'voting'
     and v_contest.voting_open
     and v_contest.voting_close_mode = 'scheduled'
     and v_contest.voting_closes_at is not null
     and v_contest.voting_closes_at <= now() then
    update public.contests
    set
      status = 'finished',
      voting_open = false,
      nominations_open = false,
      last_activity_at = now()
    where id = p_contest_id;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.maybe_auto_close_voting(uuid) from public;
grant execute on function public.maybe_auto_close_voting(uuid) to authenticated;

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

  if v_contest.voting_close_mode = 'scheduled'
     and (
       v_contest.voting_closes_at is null
       or v_contest.voting_closes_at <= now()
     ) then
    raise exception 'VOTING_CLOSE_REQUIRED';
  end if;

  update public.candidates
  set status = 'in_voting'
  where contest_id = p_contest_id
    and status in ('pending', 'visible');

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

create or replace function public.close_voting(p_contest_id uuid)
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

  if v_contest.status = 'finished' then
    return jsonb_build_object('ok', true, 'status', 'finished');
  end if;

  if v_contest.status <> 'voting' then
    raise exception 'VOTING_NOT_OPEN';
  end if;

  update public.contests
  set
    status = 'finished',
    voting_open = false,
    nominations_open = false,
    last_activity_at = now()
  where id = p_contest_id
  returning * into v_contest;

  return jsonb_build_object(
    'ok', true,
    'status', v_contest.status,
    'voting_open', v_contest.voting_open
  );
end;
$$;

revoke all on function public.close_voting(uuid) from public;
grant execute on function public.close_voting(uuid) to authenticated;

create or replace function public.cast_ballot(
  p_contest_id uuid,
  p_rankings uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_member public.contest_members%rowtype;
  v_ballot public.ballots%rowtype;
  v_existing public.ballots%rowtype;
  v_slots integer;
  v_candidate_count integer;
  v_required integer;
  v_id uuid;
  v_seen uuid[] := '{}';
  v_valid_ids uuid[];
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  perform public.maybe_auto_close_voting(p_contest_id);

  select * into v_contest
  from public.contests
  where id = p_contest_id
  for update;

  if not found then
    raise exception 'CONTEST_NOT_FOUND';
  end if;

  if v_contest.status <> 'voting' or not v_contest.voting_open then
    raise exception 'VOTING_NOT_OPEN';
  end if;

  select * into v_member
  from public.contest_members
  where contest_id = p_contest_id and user_id = v_uid;

  if not found then
    raise exception 'NOT_A_MEMBER';
  end if;

  if v_member.role = 'host' and coalesce(v_contest.host_participates, true) = false then
    raise exception 'HOST_NOT_PARTICIPATING';
  end if;

  select coalesce(array_agg(id), '{}') into v_valid_ids
  from public.candidates
  where contest_id = p_contest_id
    and status = 'in_voting';

  v_candidate_count := coalesce(cardinality(v_valid_ids), 0);
  if v_candidate_count < 1 then
    raise exception 'NO_CANDIDATES';
  end if;

  v_slots := public.scoring_slot_count(v_contest.scoring_model);
  v_required := least(v_slots, v_candidate_count);

  if p_rankings is null or cardinality(p_rankings) <> v_required then
    raise exception 'INVALID_BALLOT';
  end if;

  foreach v_id in array p_rankings loop
    if v_id = any (v_seen) then
      raise exception 'INVALID_BALLOT';
    end if;
    if not (v_id = any (v_valid_ids)) then
      raise exception 'INVALID_BALLOT';
    end if;
    v_seen := array_append(v_seen, v_id);
  end loop;

  select * into v_existing
  from public.ballots
  where contest_id = p_contest_id and voter_user_id = v_uid;

  if found then
    if v_contest.vote_mutability = 'locked_on_submit' then
      raise exception 'BALLOT_LOCKED';
    end if;

    update public.ballots
    set
      rankings = p_rankings,
      updated_at = now()
    where id = v_existing.id
    returning * into v_ballot;
  else
    insert into public.ballots (contest_id, voter_user_id, rankings)
    values (p_contest_id, v_uid, p_rankings)
    returning * into v_ballot;
  end if;

  update public.contests
  set last_activity_at = now()
  where id = p_contest_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_ballot.id,
    'rankings', to_jsonb(v_ballot.rankings),
    'updated_at', v_ballot.updated_at
  );
end;
$$;

revoke all on function public.cast_ballot(uuid, uuid[]) from public;
grant execute on function public.cast_ballot(uuid, uuid[]) to authenticated;
