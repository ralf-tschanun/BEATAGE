-- Birthday Song Contest (US Billboard first; chart_country extensible)
-- Paste ONLY this SQL into the Supabase SQL editor

alter table public.contests
  add column if not exists nomination_kind text not null default 'standard',
  add column if not exists chart_country text not null default 'US';

update public.contests
set nomination_kind = 'standard'
where nomination_kind is null
   or nomination_kind not in ('standard', 'birthday');

update public.contests
set chart_country = 'US'
where chart_country is null or btrim(chart_country) = '';

alter table public.contests
  drop constraint if exists contests_nomination_kind_check;

alter table public.contests
  add constraint contests_nomination_kind_check
  check (nomination_kind in ('standard', 'birthday'));

alter table public.candidates
  add column if not exists chart_key text,
  add column if not exists chart_date date;

create unique index if not exists candidates_contest_chart_key_uidx
  on public.candidates (contest_id, chart_key)
  where chart_key is not null;

create table if not exists public.birthday_nominations (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  birthday date not null,
  show_birthday boolean not null default false,
  candidate_id uuid references public.candidates (id) on delete set null,
  chart_country text not null default 'US',
  chart_date date,
  created_at timestamptz not null default now(),
  unique (contest_id, user_id)
);

create index if not exists birthday_nominations_contest_id_idx
  on public.birthday_nominations (contest_id);

create index if not exists birthday_nominations_candidate_id_idx
  on public.birthday_nominations (candidate_id);

alter table public.birthday_nominations enable row level security;

drop policy if exists "birthday_nominations_select_member" on public.birthday_nominations;
create policy "birthday_nominations_select_member"
  on public.birthday_nominations for select
  using (public.is_contest_member(contest_id));

-- Submit birthday without a chart match (no candidate)
create or replace function public.register_birthday_no_match(
  p_contest_id uuid,
  p_birthday date,
  p_show_birthday boolean
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

  if v_contest.nomination_kind <> 'birthday' then
    raise exception 'NOT_BIRTHDAY_CONTEST';
  end if;

  if not v_contest.nominations_open then
    raise exception 'NOMINATIONS_CLOSED';
  end if;

  if v_contest.nomination_deadline is not null
     and v_contest.nomination_deadline < now() then
    raise exception 'NOMINATION_DEADLINE_PASSED';
  end if;

  select * into v_member
  from public.contest_members
  where contest_id = p_contest_id and user_id = v_uid;

  if not found then
    raise exception 'NOT_MEMBER';
  end if;

  if v_member.role = 'host' and v_contest.host_participates is false then
    raise exception 'HOST_ADMIN_ONLY';
  end if;

  if exists (
    select 1 from public.birthday_nominations
    where contest_id = p_contest_id and user_id = v_uid
  ) then
    raise exception 'ALREADY_NOMINATED';
  end if;

  insert into public.birthday_nominations (
    contest_id, user_id, birthday, show_birthday, candidate_id, chart_country
  ) values (
    p_contest_id, v_uid, p_birthday, coalesce(p_show_birthday, false), null,
    coalesce(v_contest.chart_country, 'US')
  );

  return jsonb_build_object('ok', true, 'matched', false);
end;
$$;

revoke all on function public.register_birthday_no_match(uuid, date, boolean) from public;
grant execute on function public.register_birthday_no_match(uuid, date, boolean) to authenticated;

-- Submit birthday with a chart hit (reuse candidate by chart_key when present)
create or replace function public.nominate_birthday_hit(
  p_contest_id uuid,
  p_birthday date,
  p_show_birthday boolean,
  p_title text,
  p_artist text,
  p_url text,
  p_chart_key text,
  p_chart_date date
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
  v_candidate public.candidates%rowtype;
  v_status text;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if char_length(trim(coalesce(p_title, ''))) < 1
     or char_length(trim(coalesce(p_artist, ''))) < 1
     or char_length(trim(coalesce(p_chart_key, ''))) < 1 then
    raise exception 'INVALID_SETTINGS';
  end if;

  select * into v_contest
  from public.contests
  where id = p_contest_id
  for update;

  if not found then
    raise exception 'CONTEST_NOT_FOUND';
  end if;

  if v_contest.nomination_kind <> 'birthday' then
    raise exception 'NOT_BIRTHDAY_CONTEST';
  end if;

  if v_contest.theme <> 'song' then
    raise exception 'INVALID_SETTINGS';
  end if;

  if not v_contest.nominations_open then
    raise exception 'NOMINATIONS_CLOSED';
  end if;

  if v_contest.nomination_deadline is not null
     and v_contest.nomination_deadline < now() then
    raise exception 'NOMINATION_DEADLINE_PASSED';
  end if;

  select * into v_member
  from public.contest_members
  where contest_id = p_contest_id and user_id = v_uid;

  if not found then
    raise exception 'NOT_MEMBER';
  end if;

  if v_member.role = 'host' and v_contest.host_participates is false then
    raise exception 'HOST_ADMIN_ONLY';
  end if;

  if exists (
    select 1 from public.birthday_nominations
    where contest_id = p_contest_id and user_id = v_uid
  ) then
    raise exception 'ALREADY_NOMINATED';
  end if;

  select * into v_candidate
  from public.candidates
  where contest_id = p_contest_id
    and chart_key = p_chart_key
    and status <> 'withdrawn'
    and status <> 'rejected'
  limit 1;

  if not found then
    v_status := case
      when v_contest.candidate_reveal = 'live' then 'visible'
      else 'pending'
    end;

    insert into public.candidates (
      contest_id,
      nominator_user_id,
      title,
      artist,
      url,
      description,
      status,
      chart_key,
      chart_date
    ) values (
      p_contest_id,
      v_uid,
      trim(p_title),
      trim(p_artist),
      nullif(trim(coalesce(p_url, '')), ''),
      null,
      v_status,
      p_chart_key,
      p_chart_date
    )
    returning * into v_candidate;

    if v_contest.candidate_sort = 'random' then
      perform public.reshuffle_contest_candidates(p_contest_id);
    end if;
  end if;

  insert into public.birthday_nominations (
    contest_id, user_id, birthday, show_birthday, candidate_id,
    chart_country, chart_date
  ) values (
    p_contest_id, v_uid, p_birthday, coalesce(p_show_birthday, false),
    v_candidate.id, coalesce(v_contest.chart_country, 'US'), p_chart_date
  );

  return jsonb_build_object(
    'ok', true,
    'matched', true,
    'candidate_id', v_candidate.id
  );
end;
$$;

revoke all on function public.nominate_birthday_hit(uuid, date, boolean, text, text, text, text, date) from public;
grant execute on function public.nominate_birthday_hit(uuid, date, boolean, text, text, text, text, date) to authenticated;

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
  v_ballot_reveal_order text := coalesce(v_settings->>'ballot_reveal_order', 'alphabetical');
  v_nomination_kind text := coalesce(v_settings->>'nomination_kind', 'standard');
  v_chart_country text := coalesce(v_settings->>'chart_country', 'US');
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
  if v_ballot_reveal_order not in ('alphabetical', 'first_submitted', 'last_submitted', 'random') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_nomination_kind not in ('standard', 'birthday') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_chart_country not in ('US') then
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

  if v_nomination_kind = 'birthday' then
    v_theme := 'song';
    v_source := 'user_single';
    v_max_noms := 1;
    v_max_candidates := null;
    v_allow_dupes := true;
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
        allow_vote_own_nominations,
        ballot_reveal_order,
        nomination_kind,
        chart_country
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
        v_allow_own_noms,
        v_ballot_reveal_order,
        v_nomination_kind,
        v_chart_country
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
  v_ballot_reveal_order text;
  v_nomination_kind text;
  v_chart_country text;
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
  v_ballot_reveal_order := coalesce(
    v_settings->>'ballot_reveal_order',
    v_contest.ballot_reveal_order,
    'alphabetical'
  );
  v_nomination_kind := coalesce(
    v_settings->>'nomination_kind',
    v_contest.nomination_kind,
    'standard'
  );
  v_chart_country := coalesce(
    v_settings->>'chart_country',
    v_contest.chart_country,
    'US'
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
  if v_ballot_reveal_order not in ('alphabetical', 'first_submitted', 'last_submitted', 'random') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_nomination_kind not in ('standard', 'birthday') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_chart_country not in ('US') then
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

  if v_nomination_kind = 'birthday' then
    v_theme := 'song';
    v_source := 'user_single';
    v_max_noms := 1;
    v_max_candidates := null;
    v_allow_dupes := true;
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
    ballot_reveal_order = v_ballot_reveal_order,
    nomination_kind = v_nomination_kind,
    chart_country = v_chart_country,
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
