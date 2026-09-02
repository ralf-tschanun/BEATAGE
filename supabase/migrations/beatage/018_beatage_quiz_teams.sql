-- Quiz teams (Plus/Pro): host assigns members; round scores are averaged.

create table if not exists public.beatage_teams (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.beatage_quizzes (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  sort_index integer not null default 0,
  created_at timestamptz not null default now(),
  unique (quiz_id, name)
);

create index if not exists beatage_teams_quiz_id_idx
  on public.beatage_teams (quiz_id, sort_index);

create table if not exists public.beatage_team_members (
  team_id uuid not null references public.beatage_teams (id) on delete cascade,
  quiz_id uuid not null references public.beatage_quizzes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (team_id, user_id),
  unique (quiz_id, user_id)
);

create index if not exists beatage_team_members_quiz_id_idx
  on public.beatage_team_members (quiz_id);

-- Drop team membership when the quiz member leaves / is removed.
create or replace function public.beatage_team_members_on_quiz_member_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.beatage_team_members
  where quiz_id = old.quiz_id
    and user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists beatage_quiz_members_delete_team on public.beatage_quiz_members;
create trigger beatage_quiz_members_delete_team
  after delete on public.beatage_quiz_members
  for each row
  execute function public.beatage_team_members_on_quiz_member_delete();

-- Drop empty teams after the last member is removed.
create or replace function public.beatage_delete_empty_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.beatage_team_members
    where team_id = old.team_id
  ) then
    delete from public.beatage_teams where id = old.team_id;
  end if;
  return old;
end;
$$;

drop trigger if exists beatage_team_members_delete_empty on public.beatage_team_members;
create trigger beatage_team_members_delete_empty
  after delete on public.beatage_team_members
  for each row
  execute function public.beatage_delete_empty_team();

alter table public.beatage_teams enable row level security;
alter table public.beatage_team_members enable row level security;

drop policy if exists beatage_teams_select_member on public.beatage_teams;
create policy beatage_teams_select_member on public.beatage_teams
  for select using (
    exists (
      select 1
      from public.beatage_quiz_members m
      where m.quiz_id = beatage_teams.quiz_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists beatage_team_members_select_member on public.beatage_team_members;
create policy beatage_team_members_select_member on public.beatage_team_members
  for select using (
    exists (
      select 1
      from public.beatage_quiz_members m
      where m.quiz_id = beatage_team_members.quiz_id
        and m.user_id = auth.uid()
    )
  );

do $$
begin
  alter publication supabase_realtime add table public.beatage_teams;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.beatage_team_members;
exception
  when duplicate_object then null;
end $$;

alter table public.beatage_teams replica identity full;
alter table public.beatage_team_members replica identity full;

-- Team mode: joining closes when the official quiz locks (first official round /
-- live Start Quiz Now). Already-members may still resume.
create or replace function public.join_beatage_quiz(
  p_join_code text,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_quiz public.beatage_quizzes%rowtype;
  v_member_count integer;
  v_existing public.beatage_quiz_members%rowtype;
  v_teams_enabled boolean := false;
  v_source text;
  v_quiz_started text;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if char_length(trim(coalesce(p_display_name, ''))) < 1 then
    raise exception 'DISPLAY_NAME_REQUIRED';
  end if;

  select * into v_quiz
  from public.beatage_quizzes
  where join_code = upper(trim(p_join_code));

  if not found then
    raise exception 'QUIZ_NOT_FOUND';
  end if;

  if v_quiz.status = 'payment_pending' then
    raise exception 'QUIZ_NOT_JOINABLE';
  end if;

  if v_quiz.status not in ('open', 'playing') then
    raise exception 'QUIZ_NOT_JOINABLE';
  end if;

  if v_quiz.expires_at is not null and v_quiz.expires_at < now() then
    delete from public.beatage_quizzes where id = v_quiz.id;
    raise exception 'QUIZ_EXPIRED';
  end if;

  select * into v_existing
  from public.beatage_quiz_members
  where quiz_id = v_quiz.id and user_id = v_uid;

  if found then
    return jsonb_build_object(
      'quiz_id', v_quiz.id,
      'join_code', v_quiz.join_code,
      'already_member', true
    );
  end if;

  v_teams_enabled := coalesce((v_quiz.settings->>'teamsEnabled')::boolean, false);
  v_source := coalesce(v_quiz.source, '');
  v_quiz_started := v_quiz.settings->>'quizStarted';

  if v_teams_enabled then
    if v_source in ('spotify_live', 'lastfm_live') then
      -- Missing/true = already started (legacy). Explicit false = pre-rounds.
      if v_quiz_started is distinct from 'false' then
        raise exception 'TEAMS_LOCKED';
      end if;
    elsif exists (
      select 1
      from public.beatage_rounds r
      where r.quiz_id = v_quiz.id
        and r.status in ('active', 'revealed', 'skipped', 'excluded')
    ) then
      raise exception 'TEAMS_LOCKED';
    end if;
  end if;

  select count(*)::integer into v_member_count
  from public.beatage_quiz_members
  where quiz_id = v_quiz.id;

  if v_quiz.max_members is not null and v_member_count >= v_quiz.max_members then
    raise exception 'QUIZ_FULL';
  end if;

  insert into public.beatage_quiz_members (quiz_id, user_id, display_name, role)
  values (
    v_quiz.id,
    v_uid,
    trim(p_display_name),
    case when v_quiz.host_user_id = v_uid then 'host' else 'participant' end
  );

  update public.profiles
  set display_name = trim(p_display_name), updated_at = now()
  where id = v_uid
    and (display_name is null or btrim(display_name) = '');

  update public.beatage_quizzes
  set last_activity_at = now()
  where id = v_quiz.id;

  return jsonb_build_object(
    'quiz_id', v_quiz.id,
    'join_code', v_quiz.join_code,
    'already_member', false
  );
end;
$$;

revoke all on function public.join_beatage_quiz(text, text) from public;
grant execute on function public.join_beatage_quiz(text, text) to authenticated;

-- Finished-quiz dashboard placement: rank teams when team mode is on.
create or replace function public.beatage_quiz_member_rank(
  p_quiz_id uuid,
  p_user_id uuid
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
  v_low_wins boolean;
  v_teams_enabled boolean;
  v_rank integer;
begin
  select
    q.status,
    coalesce(q.settings->'scoringModes', '[]'::jsonb)
      ?| array['year_distance', 'year_distance_dynamic'],
    coalesce((q.settings->>'teamsEnabled')::boolean, false)
  into v_status, v_low_wins, v_teams_enabled
  from public.beatage_quizzes q
  where q.id = p_quiz_id;

  if v_status is null or v_status not in ('finished', 'expired') then
    return null;
  end if;

  if v_teams_enabled then
    with member_totals as (
      select
        g.user_id,
        sum(coalesce(g.points_total, g.points, 0))::numeric as total_points
      from public.beatage_guesses g
      join public.beatage_rounds r
        on r.id = g.round_id
       and r.quiz_id = p_quiz_id
       and r.status = 'revealed'
      group by g.user_id
    ),
    team_scores as (
      select
        t.id as team_id,
        avg(coalesce(mt.total_points, 0)) as team_points,
        t.name as display_name
      from public.beatage_teams t
      join public.beatage_team_members tm
        on tm.team_id = t.id
      left join member_totals mt
        on mt.user_id = tm.user_id
      where t.quiz_id = p_quiz_id
      group by t.id, t.name
      having count(tm.user_id) > 0
    ),
    ranked as (
      select
        ts.team_id,
        row_number() over (
          order by
            case when v_low_wins then ts.team_points end asc nulls last,
            case when not v_low_wins then ts.team_points end desc nulls last,
            ts.display_name asc
        )::integer as rank
      from team_scores ts
    )
    select r.rank into v_rank
    from ranked r
    join public.beatage_team_members tm
      on tm.team_id = r.team_id
     and tm.quiz_id = p_quiz_id
    where tm.user_id = p_user_id;

    return v_rank;
  end if;

  with totals as (
    select
      g.user_id,
      sum(coalesce(g.points_total, g.points, 0))::integer as total_points,
      coalesce(m.display_name, '') as display_name
    from public.beatage_guesses g
    join public.beatage_rounds r
      on r.id = g.round_id
     and r.quiz_id = p_quiz_id
     and r.status = 'revealed'
    left join public.beatage_quiz_members m
      on m.quiz_id = p_quiz_id
     and m.user_id = g.user_id
    group by g.user_id, m.display_name
  ),
  ranked as (
    select
      t.user_id,
      row_number() over (
        order by
          case when v_low_wins then t.total_points end asc nulls last,
          case when not v_low_wins then t.total_points end desc nulls last,
          t.display_name asc
      )::integer as rank
    from totals t
  )
  select r.rank into v_rank
  from ranked r
  where r.user_id = p_user_id;

  return v_rank;
end;
$$;

revoke all on function public.beatage_quiz_member_rank(uuid, uuid) from public;
grant execute on function public.beatage_quiz_member_rank(uuid, uuid) to authenticated;
