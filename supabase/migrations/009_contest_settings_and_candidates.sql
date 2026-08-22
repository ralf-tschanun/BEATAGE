-- Contest settings + candidates
-- Paste ONLY this SQL into the Supabase SQL editor

alter table public.contests
  add column if not exists candidate_source text not null default 'user_single'
    check (candidate_source in ('curated', 'user_single', 'user_multiple', 'databased')),
  add column if not exists max_nominations_per_participant integer
    check (max_nominations_per_participant is null or max_nominations_per_participant > 0),
  add column if not exists max_candidates integer
    check (max_candidates is null or max_candidates > 0),
  add column if not exists allow_duplicate_candidates boolean not null default false,
  add column if not exists nomination_deadline timestamptz,
  add column if not exists candidate_reveal text not null default 'live'
    check (candidate_reveal in ('live', 'admin_batch', 'admin_sequential')),
  add column if not exists voting_access text not null default 'after_release'
    check (voting_access in ('live', 'after_release')),
  add column if not exists vote_mutability text not null default 'editable_until_close'
    check (vote_mutability in ('editable_until_close', 'locked_on_submit')),
  add column if not exists voting_close_mode text not null default 'manual'
    check (voting_close_mode in ('manual', 'scheduled')),
  add column if not exists voting_closes_at timestamptz,
  add column if not exists scoring_model text not null default 'linear5'
    check (scoring_model in ('best_only', 'linear3', 'linear5', 'linear12', 'dyn4', 'dyn6', 'dyn10')),
  add column if not exists nominations_open boolean not null default true,
  add column if not exists voting_open boolean not null default false;

-- Backfill nomination limits for existing rows
update public.contests
set max_nominations_per_participant = 1
where max_nominations_per_participant is null
  and candidate_source in ('user_single', 'user_multiple', 'databased');

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade,
  nominator_user_id uuid references auth.users (id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 120),
  url text,
  description text check (description is null or char_length(description) <= 500),
  meta jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'visible', 'in_voting', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now()
);

create index if not exists candidates_contest_id_idx on public.candidates (contest_id);
create index if not exists candidates_nominator_user_id_idx on public.candidates (nominator_user_id);

alter table public.candidates enable row level security;

drop policy if exists "candidates_select_member" on public.candidates;
create policy "candidates_select_member"
  on public.candidates for select
  using (public.is_contest_member(contest_id));

-- Create contest with settings JSON
drop function if exists public.create_contest(text, text, text);

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
  v_max_noms integer;
  v_max_candidates integer;
  v_allow_dupes boolean := coalesce((v_settings->>'allow_duplicate_candidates')::boolean, false);
  v_nom_deadline timestamptz := nullif(v_settings->>'nomination_deadline', '')::timestamptz;
  v_reveal text := coalesce(v_settings->>'candidate_reveal', 'live');
  v_voting_access text := coalesce(v_settings->>'voting_access', 'after_release');
  v_vote_mutability text := coalesce(v_settings->>'vote_mutability', 'editable_until_close');
  v_close_mode text := coalesce(v_settings->>'voting_close_mode', 'manual');
  v_closes_at timestamptz := nullif(v_settings->>'voting_closes_at', '')::timestamptz;
  v_scoring text := coalesce(v_settings->>'scoring_model', 'linear5');
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

  if v_source not in ('curated', 'user_single', 'user_multiple', 'databased') then
    raise exception 'INVALID_SETTINGS';
  end if;
  if v_reveal not in ('live', 'admin_batch', 'admin_sequential') then
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
  if v_close_mode = 'scheduled' and v_closes_at is null then
    raise exception 'VOTING_CLOSE_REQUIRED';
  end if;

  select coalesce(plan, 'free') into v_plan from public.profiles where id = v_uid;
  if v_plan is null then
    insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;
    v_plan := 'free';
  end if;

  select * into v_limits from public.plan_limits(v_plan);

  -- Plan caps for nominations / curated size
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
        voting_open
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
        false
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
    'candidate_source', v_contest.candidate_source
  );
end;
$$;

revoke all on function public.create_contest(text, text, text, jsonb) from public;
grant execute on function public.create_contest(text, text, text, jsonb) to authenticated;

-- Nominate a candidate (user_single / user_multiple for now)
create or replace function public.nominate_candidate(
  p_contest_id uuid,
  p_title text,
  p_url text default null,
  p_description text default null
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
  v_status text;
  v_candidate public.candidates%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if char_length(trim(coalesce(p_title, ''))) < 1 then
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

  if v_contest.candidate_source not in ('user_single', 'user_multiple') then
    raise exception 'NOMINATIONS_NOT_ALLOWED';
  end if;

  select * into v_member
  from public.contest_members
  where contest_id = p_contest_id and user_id = v_uid;

  if not found then
    raise exception 'NOT_A_MEMBER';
  end if;

  select count(*)::integer into v_count
  from public.candidates
  where contest_id = p_contest_id
    and nominator_user_id = v_uid
    and status <> 'withdrawn';

  if v_contest.max_nominations_per_participant is not null
     and v_count >= v_contest.max_nominations_per_participant then
    raise exception 'NOMINATION_LIMIT';
  end if;

  if not v_contest.allow_duplicate_candidates then
    if exists (
      select 1 from public.candidates
      where contest_id = p_contest_id
        and status <> 'withdrawn'
        and lower(trim(title)) = lower(trim(p_title))
    ) then
      raise exception 'DUPLICATE_CANDIDATE';
    end if;
  end if;

  v_status := case
    when v_contest.candidate_reveal = 'live' then 'visible'
    else 'pending'
  end;

  insert into public.candidates (
    contest_id, nominator_user_id, title, url, description, status
  )
  values (
    p_contest_id,
    v_uid,
    trim(p_title),
    nullif(trim(coalesce(p_url, '')), ''),
    nullif(trim(coalesce(p_description, '')), ''),
    v_status
  )
  returning * into v_candidate;

  update public.contests
  set last_activity_at = now()
  where id = p_contest_id;

  return jsonb_build_object(
    'id', v_candidate.id,
    'title', v_candidate.title,
    'status', v_candidate.status
  );
end;
$$;

revoke all on function public.nominate_candidate(uuid, text, text, text) from public;
grant execute on function public.nominate_candidate(uuid, text, text, text) to authenticated;
