-- Ballot fixes:
-- 1) Topics work for song/photo (keep question_id when the contest has topics).
-- 2) "Rank own nominations = no" only excludes participant nominations,
--    not curated / host-seeded pool entries (fixes host seeing only 1st place on Linear).
-- Paste ONLY this SQL into the Supabase SQL editor.

create or replace function public.cast_ballot(
  p_contest_id uuid,
  p_rankings uuid[],
  p_question_id uuid default null
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
  v_own_ids uuid[];
  v_question_id uuid := p_question_id;
  v_theme text;
  v_source text;
  v_has_scoped boolean := false;
  v_ballot_count integer := 1;
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

  v_theme := coalesce(v_contest.theme, 'generic');
  v_source := coalesce(v_contest.candidate_source, 'user_single');

  -- Topics are allowed for anything/song/photo. Validate when provided.
  if v_question_id is not null then
    if not exists (
      select 1 from public.contest_questions q
      where q.id = v_question_id and q.contest_id = p_contest_id
    ) then
      raise exception 'INVALID_SETTINGS';
    end if;
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

  if v_question_id is not null then
    select exists (
      select 1 from public.candidates
      where contest_id = p_contest_id
        and status = 'in_voting'
        and question_id = v_question_id
    ) into v_has_scoped;
  end if;

  if v_question_id is not null and v_has_scoped then
    select coalesce(array_agg(id), '{}') into v_valid_ids
    from public.candidates
    where contest_id = p_contest_id
      and status = 'in_voting'
      and (question_id = v_question_id or question_id is null);
  else
    select coalesce(array_agg(id), '{}') into v_valid_ids
    from public.candidates
    where contest_id = p_contest_id
      and status = 'in_voting'
      and question_id is null;
  end if;

  v_candidate_count := coalesce(cardinality(v_valid_ids), 0);
  if v_candidate_count < 1 then
    raise exception 'NO_CANDIDATES';
  end if;

  if coalesce(v_contest.allow_vote_own_nominations, true) = false then
    -- Only participant nominations are blocked — curated/host-seeded stay votable.
    select coalesce(array_agg(c.id), '{}') into v_own_ids
    from public.candidates c
    where c.contest_id = p_contest_id
      and c.status = 'in_voting'
      and c.id = any (v_valid_ids)
      and c.nominator_user_id = v_uid
      and case coalesce(c.meta->>'nomination_origin', '')
        when 'curated' then false
        when 'user' then true
        else not (
          v_source = 'combined'
          and c.nominator_user_id = v_contest.host_user_id
        )
          and v_source <> 'curated'
      end;

    select coalesce(array_agg(id), '{}') into v_valid_ids
    from unnest(v_valid_ids) as id
    where not (id = any (coalesce(v_own_ids, '{}')));

    v_candidate_count := coalesce(cardinality(v_valid_ids), 0);
    if v_candidate_count < 1 then
      raise exception 'NO_ELIGIBLE_CANDIDATES';
    end if;
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
      if coalesce(v_contest.allow_vote_own_nominations, true) = false
         and v_id = any (coalesce(v_own_ids, '{}')) then
        raise exception 'OWN_NOMINATION_NOT_ALLOWED';
      end if;
      raise exception 'INVALID_BALLOT';
    end if;
    v_seen := array_append(v_seen, v_id);
  end loop;

  select * into v_existing
  from public.ballots
  where contest_id = p_contest_id
    and voter_user_id = v_uid
    and question_id is not distinct from v_question_id;

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
    insert into public.ballots (contest_id, voter_user_id, rankings, question_id)
    values (p_contest_id, v_uid, p_rankings, v_question_id)
    returning * into v_ballot;
  end if;

  select count(*)::integer into v_ballot_count
  from public.ballots
  where contest_id = p_contest_id
    and voter_user_id = v_uid;

  insert into public.ballot_turnout (
    contest_id, voter_user_id, submitted_at, updated_at, ballot_count
  )
  values (p_contest_id, v_uid, now(), now(), greatest(1, v_ballot_count))
  on conflict (contest_id, voter_user_id) do update
  set
    updated_at = now(),
    ballot_count = greatest(1, excluded.ballot_count);

  update public.contests
  set last_activity_at = now()
  where id = p_contest_id;

  return jsonb_build_object(
    'ok', true,
    'ballot_id', v_ballot.id,
    'question_id', v_ballot.question_id,
    'ballot_count', v_ballot_count
  );
end;
$$;

revoke all on function public.cast_ballot(uuid, uuid[], uuid) from public;
grant execute on function public.cast_ballot(uuid, uuid[], uuid) to authenticated;
