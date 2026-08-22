-- Candidate display order: nominated_at | alphabetical | random
-- Paste ONLY this SQL into the Supabase SQL editor

alter table public.contests
  add column if not exists candidate_sort text not null default 'nominated_at';

update public.contests
set candidate_sort = 'nominated_at'
where candidate_sort is null
   or candidate_sort not in ('nominated_at', 'alphabetical', 'random');

alter table public.contests
  drop constraint if exists contests_candidate_sort_check;

alter table public.contests
  add constraint contests_candidate_sort_check
  check (candidate_sort in ('nominated_at', 'alphabetical', 'random'));

alter table public.candidates
  add column if not exists display_order integer;

create or replace function public.reshuffle_contest_candidates(p_contest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with ranked as (
    select
      id,
      row_number() over (order by random())::integer as rn
    from public.candidates
    where contest_id = p_contest_id
      and status <> 'withdrawn'
      and status <> 'rejected'
  )
  update public.candidates c
  set display_order = ranked.rn
  from ranked
  where c.id = ranked.id;

  update public.contests
  set last_activity_at = now()
  where id = p_contest_id;
end;
$$;

revoke all on function public.reshuffle_contest_candidates(uuid) from public;
grant execute on function public.reshuffle_contest_candidates(uuid) to authenticated;


create or replace function public.nominate_candidate(
  p_contest_id uuid,
  p_title text,
  p_url text default null,
  p_description text default null,
  p_artist text default null
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
  v_total integer;
  v_status text;
  v_candidate public.candidates%rowtype;
  v_title text := trim(coalesce(p_title, ''));
  v_artist text := nullif(trim(coalesce(p_artist, '')), '');
  v_url text := nullif(trim(coalesce(p_url, '')), '');
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_is_curated boolean;
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

  if not v_contest.nominations_open or v_contest.status not in ('open', 'voting') then
    raise exception 'NOMINATIONS_CLOSED';
  end if;

  if v_contest.nomination_deadline is not null and v_contest.nomination_deadline < now() then
    raise exception 'NOMINATION_DEADLINE_PASSED';
  end if;

  if v_contest.candidate_source not in ('user_single', 'user_multiple', 'curated') then
    raise exception 'NOMINATIONS_NOT_ALLOWED';
  end if;

  v_is_curated := v_contest.candidate_source = 'curated';

  if coalesce(v_contest.theme, 'generic') = 'song' then
    if v_artist is null then
      raise exception 'ARTIST_REQUIRED';
    end if;
    v_description := null;
  end if;

  select * into v_member
  from public.contest_members
  where contest_id = p_contest_id and user_id = v_uid;

  if not found then
    raise exception 'NOT_A_MEMBER';
  end if;

  if v_is_curated then
    if v_contest.host_user_id <> v_uid or v_member.role <> 'host' then
      raise exception 'CURATED_HOST_ONLY';
    end if;
  else
    if v_member.role = 'host' and coalesce(v_contest.host_participates, true) = false then
      raise exception 'HOST_NOT_PARTICIPATING';
    end if;
  end if;

  if v_is_curated then
    select count(*)::integer into v_total
    from public.candidates
    where contest_id = p_contest_id
      and status <> 'withdrawn';

    if v_contest.max_candidates is not null
       and v_total >= v_contest.max_candidates then
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
    if coalesce(v_contest.theme, 'generic') = 'song' then
      if exists (
        select 1 from public.candidates
        where contest_id = p_contest_id
          and status <> 'withdrawn'
          and lower(trim(title)) = lower(v_title)
          and lower(trim(coalesce(artist, ''))) = lower(v_artist)
      ) then
        raise exception 'DUPLICATE_CANDIDATE';
      end if;
    else
      if exists (
        select 1 from public.candidates
        where contest_id = p_contest_id
          and status <> 'withdrawn'
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
    contest_id, nominator_user_id, title, artist, url, description, status
  )
  values (
    p_contest_id,
    v_uid,
    v_title,
    v_artist,
    v_url,
    v_description,
    v_status
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
    'display_order', v_candidate.display_order
  );
end;
$$;

revoke all on function public.nominate_candidate(uuid, text, text, text, text) from public;
grant execute on function public.nominate_candidate(uuid, text, text, text, text) to authenticated;


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
  if v_nominator_when not in ('before', 'after') then
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
        candidate_sort
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
        v_candidate_sort
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
  if v_nominator_when not in ('before', 'after') then
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

