-- Anything contests: candidates + ballots scoped per question.
-- Paste into the Supabase SQL editor.

alter table public.candidates
  add column if not exists question_id uuid references public.contest_questions(id) on delete cascade;

create index if not exists candidates_question_id_idx
  on public.candidates (question_id);

alter table public.ballots
  add column if not exists question_id uuid references public.contest_questions(id) on delete cascade;

create index if not exists ballots_question_id_idx
  on public.ballots (question_id);

-- Replace contest+voter uniqueness with contest+voter+question (null = legacy single ballot).
alter table public.ballots
  drop constraint if exists ballots_contest_id_voter_user_id_key;

drop index if exists ballots_contest_voter_question_uidx;
create unique index ballots_contest_voter_question_uidx
  on public.ballots (
    contest_id,
    voter_user_id,
    (coalesce(question_id, '00000000-0000-0000-0000-000000000000'::uuid))
  );

-- nominate_candidate: optional question scope for Anything contests.
drop function if exists public.nominate_candidate(uuid, text, text, text, text, boolean);

create or replace function public.nominate_candidate(
  p_contest_id uuid,
  p_title text,
  p_url text default null,
  p_description text default null,
  p_artist text default null,
  p_delete_photo_on_finish boolean default false,
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
  v_count integer;
  v_curated_count integer;
  v_status text;
  v_candidate public.candidates%rowtype;
  v_title text := trim(coalesce(p_title, ''));
  v_artist text := nullif(trim(coalesce(p_artist, '')), '');
  v_url text := nullif(trim(coalesce(p_url, '')), '');
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_source text;
  v_is_host_curated boolean := false;
  v_theme text;
  v_delete_photo boolean := coalesce(p_delete_photo_on_finish, false);
  v_question_id uuid := p_question_id;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if char_length(v_title) < 1 then
    raise exception 'TITLE_REQUIRED';
  end if;

  select * into v_contest from public.contests where id = p_contest_id for update;
  if not found then
    raise exception 'CONTEST_NOT_FOUND';
  end if;

  v_theme := coalesce(v_contest.theme, 'generic');
  v_source := coalesce(v_contest.candidate_source, 'user_single');

  if v_theme <> 'photo' then
    v_delete_photo := false;
  end if;

  if v_theme <> 'generic' then
    v_question_id := null;
  elsif v_question_id is not null then
    if not exists (
      select 1 from public.contest_questions q
      where q.id = v_question_id and q.contest_id = p_contest_id
    ) then
      raise exception 'INVALID_SETTINGS';
    end if;
  end if;

  if not v_contest.nominations_open or v_contest.status not in ('open', 'voting') then
    raise exception 'NOMINATIONS_CLOSED';
  end if;

  if v_contest.nomination_deadline is not null and v_contest.nomination_deadline < now() then
    raise exception 'NOMINATION_DEADLINE_PASSED';
  end if;

  if v_source not in ('user_single', 'user_multiple', 'curated', 'combined') then
    raise exception 'NOMINATIONS_NOT_ALLOWED';
  end if;

  if v_source = 'combined' then
    v_is_host_curated := v_contest.host_user_id = v_uid;
  elsif v_source = 'curated' then
    v_is_host_curated := true;
  end if;

  if v_theme = 'song' then
    if v_artist is null then
      raise exception 'ARTIST_REQUIRED';
    end if;
    v_description := null;
  end if;

  if v_theme = 'photo' then
    v_artist := null;
    v_description := null;
    if v_url is null then
      raise exception 'TITLE_REQUIRED';
    end if;
  end if;

  select * into v_member
  from public.contest_members
  where contest_id = p_contest_id and user_id = v_uid;

  if not found then
    raise exception 'NOT_A_MEMBER';
  end if;

  if v_is_host_curated then
    if v_contest.host_user_id <> v_uid or v_member.role <> 'host' then
      raise exception 'CURATED_HOST_ONLY';
    end if;
  else
    if v_member.role = 'host' and coalesce(v_contest.host_participates, true) = false then
      raise exception 'HOST_NOT_PARTICIPATING';
    end if;
  end if;

  if v_is_host_curated then
    select count(*)::integer into v_curated_count
    from public.candidates
    where contest_id = p_contest_id
      and status <> 'withdrawn'
      and (
        nominator_user_id = v_contest.host_user_id
        or v_source = 'curated'
      );

    if v_contest.max_candidates is not null
       and v_curated_count >= v_contest.max_candidates then
      raise exception 'CANDIDATE_LIMIT';
    end if;
  else
    select count(*)::integer into v_count
    from public.candidates
    where contest_id = p_contest_id
      and nominator_user_id = v_uid
      and status <> 'withdrawn';

    if v_contest.max_nominations_per_participant is not null
       and v_count >= v_contest.max_nominations_per_participant then
      raise exception 'NOMINATION_LIMIT';
    end if;
  end if;

  if not v_contest.allow_duplicate_candidates then
    if v_theme = 'song' then
      if exists (
        select 1 from public.candidates
        where contest_id = p_contest_id
          and status <> 'withdrawn'
          and lower(trim(title)) = lower(v_title)
          and lower(trim(coalesce(artist, ''))) = lower(v_artist)
      ) then
        raise exception 'DUPLICATE_CANDIDATE';
      end if;
    elsif v_theme = 'photo' then
      if exists (
        select 1 from public.candidates
        where contest_id = p_contest_id
          and status <> 'withdrawn'
          and url is not null
          and url = v_url
      ) then
        raise exception 'DUPLICATE_CANDIDATE';
      end if;
    else
      if exists (
        select 1 from public.candidates
        where contest_id = p_contest_id
          and status <> 'withdrawn'
          and question_id is not distinct from v_question_id
          and lower(trim(title)) = lower(v_title)
      ) then
        raise exception 'DUPLICATE_CANDIDATE';
      end if;
    end if;
  end if;

  v_status := case
    when v_contest.candidate_reveal = 'live' then 'visible'
    else 'pending'
  end;

  insert into public.candidates (
    contest_id, nominator_user_id, title, artist, url, description, status,
    delete_photo_on_finish, question_id
  )
  values (
    p_contest_id,
    v_uid,
    v_title,
    v_artist,
    v_url,
    v_description,
    v_status,
    v_delete_photo,
    v_question_id
  )
  returning * into v_candidate;

  if coalesce(v_contest.candidate_sort, 'nominated_at') = 'random' then
    perform public.reshuffle_contest_candidates(p_contest_id);
    select * into v_candidate from public.candidates where id = v_candidate.id;
  else
    update public.contests
    set last_activity_at = now()
    where id = p_contest_id;
  end if;

  return jsonb_build_object(
    'id', v_candidate.id,
    'title', v_candidate.title,
    'artist', v_candidate.artist,
    'status', v_candidate.status,
    'display_order', v_candidate.display_order,
    'question_id', v_candidate.question_id
  );
end;
$$;

revoke all on function public.nominate_candidate(uuid, text, text, text, text, boolean, uuid) from public;
grant execute on function public.nominate_candidate(uuid, text, text, text, text, boolean, uuid) to authenticated;

-- cast_ballot: optional question scope
drop function if exists public.cast_ballot(uuid, uuid[]);

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
  if v_theme <> 'generic' then
    v_question_id := null;
  elsif v_question_id is not null then
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

  select coalesce(array_agg(id), '{}') into v_valid_ids
  from public.candidates
  where contest_id = p_contest_id
    and status = 'in_voting'
    and question_id is not distinct from v_question_id;

  v_candidate_count := coalesce(cardinality(v_valid_ids), 0);
  if v_candidate_count < 1 then
    raise exception 'NO_CANDIDATES';
  end if;

  if coalesce(v_contest.allow_vote_own_nominations, true) = false then
    select coalesce(array_agg(id), '{}') into v_own_ids
    from public.candidates
    where contest_id = p_contest_id
      and status = 'in_voting'
      and question_id is not distinct from v_question_id
      and nominator_user_id = v_uid;

    select coalesce(array_agg(id), '{}') into v_valid_ids
    from public.candidates
    where contest_id = p_contest_id
      and status = 'in_voting'
      and question_id is not distinct from v_question_id
      and (nominator_user_id is distinct from v_uid);

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

  insert into public.ballot_turnout (contest_id, voter_user_id, submitted_at, updated_at)
  values (p_contest_id, v_uid, now(), now())
  on conflict (contest_id, voter_user_id) do update
  set updated_at = now();

  update public.contests
  set last_activity_at = now()
  where id = p_contest_id;

  return jsonb_build_object(
    'ok', true,
    'ballot_id', v_ballot.id,
    'question_id', v_ballot.question_id
  );
end;
$$;

revoke all on function public.cast_ballot(uuid, uuid[], uuid) from public;
grant execute on function public.cast_ballot(uuid, uuid[], uuid) to authenticated;
