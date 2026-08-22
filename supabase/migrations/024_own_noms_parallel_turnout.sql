-- Own-nomination voting + parallel nominator ranking + ballot turnout
-- Paste ONLY this SQL into the Supabase SQL editor
-- Safe to re-run; also adds missing columns from 022/023 if needed.

-- Prerequisites from earlier migrations (no-op if already present)
alter table public.contests
  add column if not exists nominator_ranking boolean not null default false,
  add column if not exists nominator_ranking_when text not null default 'after',
  add column if not exists results_phase text not null default 'candidates',
  add column if not exists nominator_reveal_step integer not null default 0,
  add column if not exists candidate_sort text not null default 'nominated_at',
  add column if not exists allow_vote_own_nominations boolean not null default true;

alter table public.candidates
  add column if not exists display_order integer;

-- Extend nominator_ranking_when with parallel
alter table public.contests
  drop constraint if exists contests_nominator_ranking_when_check;

update public.contests
set nominator_ranking_when = 'after'
where nominator_ranking_when is null
   or nominator_ranking_when not in ('before', 'after', 'parallel');

alter table public.contests
  add constraint contests_nominator_ranking_when_check
  check (nominator_ranking_when in ('before', 'after', 'parallel'));

alter table public.contests
  drop constraint if exists contests_candidate_sort_check;

update public.contests
set candidate_sort = 'nominated_at'
where candidate_sort is null
   or candidate_sort not in ('nominated_at', 'alphabetical', 'random');

alter table public.contests
  add constraint contests_candidate_sort_check
  check (candidate_sort in ('nominated_at', 'alphabetical', 'random'));

alter table public.contests
  drop constraint if exists contests_results_phase_check;

update public.contests
set results_phase = 'candidates'
where results_phase is null
   or results_phase not in ('nominators', 'candidates', 'done');

alter table public.contests
  add constraint contests_results_phase_check
  check (results_phase in ('nominators', 'candidates', 'done'));

-- Public turnout (no rankings) so host/members see who has submitted during voting
create table if not exists public.ballot_turnout (
  contest_id uuid not null references public.contests (id) on delete cascade,
  voter_user_id uuid not null references auth.users (id) on delete cascade,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (contest_id, voter_user_id)
);

create index if not exists ballot_turnout_contest_id_idx
  on public.ballot_turnout (contest_id);

alter table public.ballot_turnout enable row level security;

drop policy if exists "ballot_turnout_select_member" on public.ballot_turnout;
create policy "ballot_turnout_select_member"
  on public.ballot_turnout for select
  using (public.is_contest_member(contest_id));

do $$
begin
  alter publication supabase_realtime add table public.ballot_turnout;
exception
  when duplicate_object then null;
end $$;

-- Backfill from existing ballots (only if ballots table exists)
do $$
begin
  insert into public.ballot_turnout (contest_id, voter_user_id, submitted_at, updated_at)
  select contest_id, voter_user_id, submitted_at, updated_at
  from public.ballots
  on conflict (contest_id, voter_user_id) do update
  set
    submitted_at = excluded.submitted_at,
    updated_at = excluded.updated_at;
exception
  when undefined_table then null;
end $$;

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
  v_own_ids uuid[];
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

  -- Eligible pool may exclude own nominations
  if coalesce(v_contest.allow_vote_own_nominations, true) = false then
    select coalesce(array_agg(id), '{}') into v_own_ids
    from public.candidates
    where contest_id = p_contest_id
      and status = 'in_voting'
      and nominator_user_id = v_uid;

    select coalesce(array_agg(id), '{}') into v_valid_ids
    from public.candidates
    where contest_id = p_contest_id
      and status = 'in_voting'
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

  insert into public.ballot_turnout (contest_id, voter_user_id, submitted_at, updated_at)
  values (p_contest_id, v_uid, coalesce(v_ballot.submitted_at, now()), now())
  on conflict (contest_id, voter_user_id) do update
  set updated_at = excluded.updated_at;

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

-- close_voting: parallel starts on candidates (same as after)
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

drop function if exists public.maybe_auto_close_voting(uuid);

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

create or replace function public.create_contest(
  p_title text,
  p_host_name text,
  p_description text default null,
  p_settings jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan text;
  v_limits record;
  v_active_count integer;
  v_join_code text;
  v_manage_token text;
  v_contest public.contests%rowtype;
  v_attempts integer := 0;
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_source text := coalesce(v_settings->>'candidate_source', 'user_single');
  v_theme text := coalesce(v_settings->>'theme', 'generic');
  v_max_noms integer;
  v_max_candidates integer;
  v_allow_dupes boolean := coalesce((v_settings->>'allow_duplicate_candidates')::boolean, false);
  v_host_participates boolean := coalesce((v_settings->>'host_participates')::boolean, true);
  v_nom_deadline timestamptz := nullif(v_settings->>'nomination_deadline', '')::timestamptz;
  v_reveal text := coalesce(v_settings->>'candidate_reveal', 'live');
  v_voting_access text := coalesce(v_settings->>'voting_access', 'after_release');
  v_vote_mutability text := coalesce(v_settings->>'vote_mutability', 'editable_until_close');
  v_close_mode text := coalesce(v_settings->>'voting_close_mode', 'manual');
  v_closes_at timestamptz := nullif(v_settings->>'voting_closes_at', '')::timestamptz;
  v_scoring text := coalesce(v_settings->>'scoring_model', 'linear5');
  v_results_reveal text := coalesce(v_settings->>'results_reveal', 'immediate');
  v_nominator_ranking boolean := coalesce((v_settings->>'nominator_ranking')::boolean, false);
  v_nominator_when text := coalesce(v_settings->>'nominator_ranking_when', 'after');
  v_candidate_sort text := coalesce(v_settings->>'candidate_sort', 'nominated_at');
  v_allow_own_noms boolean := coalesce((v_settings->>'allow_vote_own_nominations')::boolean, true);
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if char_length(trim(coalesce(p_title, ''))) < 1 then
    raise exception 'TITLE_REQUIRED';
  end if;

  if char_length(trim(coalesce(p_host_name, ''))) < 1 then
    raise exception 'HOST_NAME_REQUIRED';
  end if;

  if v_reveal = 'admin_sequential' then
    v_reveal := 'admin_batch';
  end if;

  if v_theme not in ('generic', 'song') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_source not in ('curated', 'user_single', 'user_multiple', 'databased') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_reveal not in ('live', 'admin_batch') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_voting_access not in ('live', 'after_release') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_vote_mutability not in ('editable_until_close', 'locked_on_submit') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_close_mode not in ('manual', 'scheduled') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_scoring not in ('best_only', 'linear3', 'linear5', 'linear12', 'dyn4', 'dyn6', 'dyn10') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_results_reveal not in ('immediate', 'last_to_first', 'by_participant') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_nominator_when not in ('before', 'after', 'parallel') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_candidate_sort not in ('nominated_at', 'alphabetical', 'random') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_close_mode = 'scheduled' and v_closes_at is null then
    raise exception 'VOTING_CLOSE_REQUIRED';
  end if;

  v_voting_access := 'after_release';

  select coalesce(plan, 'free') into v_plan from public.profiles where id = v_uid;
  if v_plan is null then
    insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;
    v_plan := 'free';
  end if;

  select * into v_limits from public.plan_limits(v_plan);

  if v_source = 'user_single' then
    v_max_noms := 1;
  elsif v_source = 'user_multiple' then
    v_max_noms := greatest(1, coalesce((v_settings->>'max_nominations_per_participant')::integer, 1));
    if v_plan = 'free' then
      v_max_noms := 1;
    elsif v_plan = 'plus' then
      v_max_noms := least(v_max_noms, 5);
    end if;
  else
    v_max_noms := 1;
  end if;

  if v_source = 'curated' then
    if v_plan = 'free' then
      v_max_candidates := 10;
    elsif v_plan = 'plus' then
      v_max_candidates := 50;
    else
      v_max_candidates := null;
    end if;
  else
    v_max_candidates := null;
  end if;

  select count(*)::integer into v_active_count
  from public.contests
  where host_user_id = v_uid
    and status in ('draft', 'open', 'voting');

  if v_limits.max_active_contests is not null
     and v_active_count >= v_limits.max_active_contests then
    raise exception 'ACTIVE_CONTEST_LIMIT';
  end if;

  loop
    v_join_code := public.generate_join_code();
    v_manage_token := public.generate_manage_token();
    begin
      insert into public.contests (
        title,
        description,
        status,
        mode,
        host_user_id,
        max_members,
        join_code,
        manage_token,
        last_activity_at,
        expires_at,
        candidate_source,
        max_nominations_per_participant,
        max_candidates,
        allow_duplicate_candidates,
        nomination_deadline,
        candidate_reveal,
        voting_access,
        vote_mutability,
        voting_close_mode,
        voting_closes_at,
        scoring_model,
        nominations_open,
        voting_open,
        host_participates,
        theme,
        results_reveal,
        results_reveal_step,
        nominator_ranking,
        nominator_ranking_when,
        results_phase,
        nominator_reveal_step,
        candidate_sort,
        allow_vote_own_nominations
      )
      values (
        trim(p_title),
        nullif(trim(coalesce(p_description, '')), ''),
        'open',
        v_limits.mode,
        v_uid,
        v_limits.max_members,
        v_join_code,
        v_manage_token,
        now(),
        case
          when v_limits.inactivity_expiry_days is null then null
          else now() + make_interval(days => v_limits.inactivity_expiry_days)
        end,
        v_source,
        v_max_noms,
        v_max_candidates,
        v_allow_dupes,
        v_nom_deadline,
        v_reveal,
        v_voting_access,
        v_vote_mutability,
        v_close_mode,
        case when v_close_mode = 'scheduled' then v_closes_at else null end,
        v_scoring,
        true,
        false,
        v_host_participates,
        v_theme,
        v_results_reveal,
        0,
        v_nominator_ranking,
        v_nominator_when,
        'candidates',
        0,
        v_candidate_sort,
        v_allow_own_noms
      )
      returning * into v_contest;
      exit;
    exception when unique_violation then
      v_attempts := v_attempts + 1;
      if v_attempts > 8 then
        raise exception 'CODE_GENERATION_FAILED';
      end if;
    end;
  end loop;

  insert into public.contest_members (contest_id, user_id, display_name, role)
  values (v_contest.id, v_uid, trim(p_host_name), 'host');

  update public.profiles
  set display_name = trim(p_host_name), updated_at = now()
  where id = v_uid
    and (display_name is null or btrim(display_name) = '');

  return jsonb_build_object(
    'id', v_contest.id,
    'title', v_contest.title,
    'join_code', v_contest.join_code,
    'manage_token', v_contest.manage_token,
    'max_members', v_contest.max_members,
    'mode', v_contest.mode,
    'expires_at', v_contest.expires_at,
    'candidate_source', v_contest.candidate_source,
    'host_participates', v_contest.host_participates,
    'theme', v_contest.theme,
    'results_reveal', v_contest.results_reveal,
    'nominator_ranking', v_contest.nominator_ranking
  );
end;
$$;

revoke all on function public.create_contest(text, text, text, jsonb) from public;
grant execute on function public.create_contest(text, text, text, jsonb) to authenticated;

create or replace function public.update_contest_settings(
  p_contest_id uuid,
  p_title text,
  p_description text default null,
  p_settings jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_plan text := 'free';
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_source text;
  v_theme text;
  v_max_noms integer;
  v_max_candidates integer;
  v_allow_dupes boolean;
  v_host_participates boolean;
  v_nom_deadline timestamptz;
  v_reveal text;
  v_voting_access text;
  v_vote_mutability text;
  v_close_mode text;
  v_closes_at timestamptz;
  v_scoring text;
  v_nominations_open boolean;
  v_results_reveal text;
  v_nominator_ranking boolean;
  v_nominator_when text;
  v_candidate_sort text;
  v_allow_own_noms boolean;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if char_length(trim(coalesce(p_title, ''))) < 1 then
    raise exception 'TITLE_REQUIRED';
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

  select coalesce(plan, 'free') into v_plan
  from public.profiles
  where id = v_uid;
  if v_plan is null then
    v_plan := 'free';
  end if;

  v_source := coalesce(v_settings->>'candidate_source', v_contest.candidate_source);
  v_theme := coalesce(v_settings->>'theme', v_contest.theme);
  v_allow_dupes := coalesce(
    (v_settings->>'allow_duplicate_candidates')::boolean,
    v_contest.allow_duplicate_candidates
  );
  v_host_participates := coalesce(
    (v_settings->>'host_participates')::boolean,
    v_contest.host_participates
  );
  v_nom_deadline := nullif(v_settings->>'nomination_deadline', '')::timestamptz;
  if not (v_settings ? 'nomination_deadline') then
    v_nom_deadline := v_contest.nomination_deadline;
  end if;
  v_reveal := coalesce(v_settings->>'candidate_reveal', v_contest.candidate_reveal);
  if v_reveal = 'admin_sequential' then
    v_reveal := 'admin_batch';
  end if;
  v_voting_access := 'after_release';
  v_vote_mutability := coalesce(v_settings->>'vote_mutability', v_contest.vote_mutability);
  v_close_mode := coalesce(v_settings->>'voting_close_mode', v_contest.voting_close_mode);
  v_closes_at := nullif(v_settings->>'voting_closes_at', '')::timestamptz;
  if not (v_settings ? 'voting_closes_at') then
    v_closes_at := v_contest.voting_closes_at;
  end if;
  v_scoring := coalesce(v_settings->>'scoring_model', v_contest.scoring_model);
  v_nominations_open := coalesce(
    (v_settings->>'nominations_open')::boolean,
    v_contest.nominations_open
  );
  v_results_reveal := coalesce(v_settings->>'results_reveal', v_contest.results_reveal);
  v_nominator_ranking := coalesce(
    (v_settings->>'nominator_ranking')::boolean,
    v_contest.nominator_ranking
  );
  v_nominator_when := coalesce(
    v_settings->>'nominator_ranking_when',
    v_contest.nominator_ranking_when,
    'after'
  );
  v_candidate_sort := coalesce(
    v_settings->>'candidate_sort',
    v_contest.candidate_sort,
    'nominated_at'
  );
  v_allow_own_noms := coalesce(
    (v_settings->>'allow_vote_own_nominations')::boolean,
    v_contest.allow_vote_own_nominations,
    true
  );

  if v_theme not in ('generic', 'song') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_source not in ('curated', 'user_single', 'user_multiple', 'databased') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_reveal not in ('live', 'admin_batch') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_vote_mutability not in ('editable_until_close', 'locked_on_submit') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_close_mode not in ('manual', 'scheduled') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_scoring not in ('best_only', 'linear3', 'linear5', 'linear12', 'dyn4', 'dyn6', 'dyn10') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_results_reveal not in ('immediate', 'last_to_first', 'by_participant') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_nominator_when not in ('before', 'after', 'parallel') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_candidate_sort not in ('nominated_at', 'alphabetical', 'random') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_close_mode = 'scheduled' and v_closes_at is null then
    raise exception 'VOTING_CLOSE_REQUIRED';
  end if;

  if v_source = 'user_single' then
    v_max_noms := 1;
  elsif v_source = 'user_multiple' then
    v_max_noms := greatest(
      1,
      coalesce(
        (v_settings->>'max_nominations_per_participant')::integer,
        v_contest.max_nominations_per_participant,
        1
      )
    );
    if v_plan = 'free' then
      v_max_noms := 1;
    elsif v_plan = 'plus' then
      v_max_noms := least(v_max_noms, 5);
    end if;
  else
    v_max_noms := 1;
  end if;

  if v_source = 'curated' then
    if v_plan = 'free' then
      v_max_candidates := 10;
    elsif v_plan = 'plus' then
      v_max_candidates := 50;
    else
      v_max_candidates := null;
    end if;
  else
    v_max_candidates := null;
  end if;

  update public.contests
  set
    title = trim(p_title),
    description = nullif(trim(coalesce(p_description, '')), ''),
    candidate_source = v_source,
    theme = v_theme,
    max_nominations_per_participant = v_max_noms,
    max_candidates = v_max_candidates,
    allow_duplicate_candidates = v_allow_dupes,
    host_participates = v_host_participates,
    nomination_deadline = v_nom_deadline,
    candidate_reveal = v_reveal,
    voting_access = v_voting_access,
    vote_mutability = v_vote_mutability,
    voting_close_mode = v_close_mode,
    voting_closes_at = case when v_close_mode = 'scheduled' then v_closes_at else null end,
    scoring_model = v_scoring,
    nominations_open = v_nominations_open,
    results_reveal = v_results_reveal,
    nominator_ranking = v_nominator_ranking,
    nominator_ranking_when = v_nominator_when,
    candidate_sort = v_candidate_sort,
    allow_vote_own_nominations = v_allow_own_noms,
    last_activity_at = now()
  where id = p_contest_id
  returning * into v_contest;

  if v_candidate_sort = 'random' then
    perform public.reshuffle_contest_candidates(p_contest_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_contest.id,
    'join_code', v_contest.join_code,
    'title', v_contest.title,
    'theme', v_contest.theme,
    'results_reveal', v_contest.results_reveal,
    'nominator_ranking', v_contest.nominator_ranking,
    'candidate_sort', v_contest.candidate_sort
  );
end;
$$;

revoke all on function public.update_contest_settings(uuid, text, text, jsonb) from public;
grant execute on function public.update_contest_settings(uuid, text, text, jsonb) to authenticated;



create or replace function public.advance_results_reveal(p_contest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_max integer := 0;
  v_next integer;
  v_mode text;
  v_phase text;
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
    raise exception 'RESULTS_NOT_READY';
  end if;

  v_phase := coalesce(v_contest.results_phase, 'candidates');
  v_mode := coalesce(v_contest.results_reveal, 'immediate');

  -- Advance nominator ranking phase
  if v_phase = 'nominators' then
    -- Stepped only for last_to_first; otherwise jump to next presentation phase
    if v_mode = 'last_to_first' then
      select count(*)::integer into v_max
      from (
        select nominator_user_id
        from public.candidates
        where contest_id = p_contest_id
          and status = 'in_voting'
          and nominator_user_id is not null
        group by nominator_user_id
      ) t;

      if v_max < 1 then
        v_max := 0;
      end if;

      if v_contest.nominator_reveal_step < v_max then
        v_next := v_contest.nominator_reveal_step + 1;
        update public.contests
        set
          nominator_reveal_step = v_next,
          last_activity_at = now()
        where id = p_contest_id
        returning * into v_contest;

        return jsonb_build_object(
          'ok', true,
          'results_phase', v_contest.results_phase,
          'nominator_reveal_step', v_contest.nominator_reveal_step,
          'max_step', v_max,
          'complete', v_next >= v_max
        );
      end if;
    end if;

    -- Nominator phase complete (or immediate) → candidate results if before, else done
    if v_contest.nominator_ranking and v_contest.nominator_ranking_when = 'before' then
      update public.contests
      set
        results_phase = 'candidates',
        results_reveal_step = 0,
        last_activity_at = now()
      where id = p_contest_id
      returning * into v_contest;
    else
      update public.contests
      set
        results_phase = 'done',
        last_activity_at = now()
      where id = p_contest_id
      returning * into v_contest;
    end if;

    return jsonb_build_object(
      'ok', true,
      'results_phase', v_contest.results_phase,
      'nominator_reveal_step', v_contest.nominator_reveal_step,
      'results_reveal_step', v_contest.results_reveal_step,
      'complete', true
    );
  end if;

  -- Advance candidate results phase
  if v_phase = 'candidates' then
    if v_mode = 'immediate' then
      -- already fully visible; move to next phase if needed
      null;
    elsif v_mode = 'last_to_first' then
      select count(*)::integer into v_max
      from public.candidates
      where contest_id = p_contest_id
        and status = 'in_voting';

      if v_contest.results_reveal_step < v_max then
        v_next := v_contest.results_reveal_step + 1;
        update public.contests
        set
          results_reveal_step = v_next,
          last_activity_at = now()
        where id = p_contest_id
        returning * into v_contest;

        return jsonb_build_object(
          'ok', true,
          'results_phase', v_contest.results_phase,
          'results_reveal_step', v_contest.results_reveal_step,
          'max_step', v_max,
          'complete', v_next >= v_max
        );
      end if;
    else
      -- by_participant
      select count(*)::integer into v_max
      from public.contest_members m
      where m.contest_id = p_contest_id
        and (
          m.role = 'participant'
          or (m.role = 'host' and v_contest.host_participates)
        );

      if v_contest.results_reveal_step < v_max then
        v_next := v_contest.results_reveal_step + 1;
        update public.contests
        set
          results_reveal_step = v_next,
          last_activity_at = now()
        where id = p_contest_id
        returning * into v_contest;

        return jsonb_build_object(
          'ok', true,
          'results_phase', v_contest.results_phase,
          'results_reveal_step', v_contest.results_reveal_step,
          'max_step', v_max,
          'complete', v_next >= v_max
        );
      end if;
    end if;

    -- Candidate phase complete → nominators if after (not parallel), else done
    if v_contest.nominator_ranking and v_contest.nominator_ranking_when = 'after' then
      update public.contests
      set
        results_phase = 'nominators',
        nominator_reveal_step = 0,
        last_activity_at = now()
      where id = p_contest_id
      returning * into v_contest;
    else
      update public.contests
      set
        results_phase = 'done',
        last_activity_at = now()
      where id = p_contest_id
      returning * into v_contest;
    end if;

    return jsonb_build_object(
      'ok', true,
      'results_phase', v_contest.results_phase,
      'results_reveal_step', v_contest.results_reveal_step,
      'nominator_reveal_step', v_contest.nominator_reveal_step,
      'complete', true
    );
  end if;

  -- already done
  raise exception 'RESULTS_ALREADY_COMPLETE';
end;
$$;

revoke all on function public.advance_results_reveal(uuid) from public;
grant execute on function public.advance_results_reveal(uuid) to authenticated;
