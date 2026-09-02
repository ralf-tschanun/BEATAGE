-- Dashboard placement: team quizzes use team standings (same rules as play UI).
-- Official rounds only (pre-rounds / skipped / excluded stay out). Team score is
-- the 1-decimal average of member totals, matching averageTeamPoints().

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
  v_pre_cutoff integer;
  v_rank integer;
begin
  select
    q.status,
    coalesce(q.settings->'scoringModes', '[]'::jsonb)
      ?| array['year_distance', 'year_distance_dynamic'],
    lower(coalesce(q.settings->>'teamsEnabled', 'false')) in ('true', 't', '1'),
    greatest(
      0,
      coalesce((q.settings->>'preRoundCutoff')::integer, 0)
    )
  into v_status, v_low_wins, v_teams_enabled, v_pre_cutoff
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
       and r.round_number > v_pre_cutoff
      group by g.user_id
    ),
    team_scores as (
      select
        t.id as team_id,
        round(avg(coalesce(mt.total_points, 0))::numeric, 1) as team_points,
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

    -- Team quiz: never fall back to individual standings.
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
     and r.round_number > v_pre_cutoff
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

-- Surface team mode on dashboard cards so placement copy can say "(team)".
create or replace function public.get_beatage_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan text := 'free';
  v_hosted jsonb;
  v_joined jsonb;
  v_active_count integer;
begin
  begin
    perform public.beatage_purge_expired_quizzes();
  exception when others then
    null;
  end;

  if v_uid is null then
    return jsonb_build_object(
      'plan', 'free',
      'hosted', '[]'::jsonb,
      'joined', '[]'::jsonb,
      'active_hosted_count', 0
    );
  end if;

  select coalesce(plan, 'free') into v_plan
  from public.beatage_profiles
  where id = v_uid;

  if v_plan is null then
    insert into public.beatage_profiles (id) values (v_uid) on conflict (id) do nothing;
    v_plan := 'free';
  end if;

  select coalesce(
    jsonb_agg(
      (
        to_jsonb(q)
        || jsonb_build_object(
          'my_display_name', m.display_name,
          'member_count', (
            select count(*)::integer
            from public.beatage_quiz_members mm
            where mm.quiz_id = q.id
          ),
          'teams_enabled', lower(coalesce(q.settings->>'teamsEnabled', 'false'))
            in ('true', 't', '1'),
          'my_rank', public.beatage_quiz_member_rank(q.id, v_uid)
        )
      )
      order by q.created_at desc
    ),
    '[]'::jsonb
  )
  into v_hosted
  from public.beatage_quizzes q
  join public.beatage_quiz_members m
    on m.quiz_id = q.id
   and m.user_id = v_uid
   and m.role = 'host'
  where q.host_user_id = v_uid;

  select coalesce(
    jsonb_agg(
      (
        to_jsonb(q)
        || jsonb_build_object(
          'my_display_name', m.display_name,
          'member_count', (
            select count(*)::integer
            from public.beatage_quiz_members mm
            where mm.quiz_id = q.id
          ),
          'teams_enabled', lower(coalesce(q.settings->>'teamsEnabled', 'false'))
            in ('true', 't', '1'),
          'my_rank', public.beatage_quiz_member_rank(q.id, v_uid)
        )
      )
      order by m.joined_at desc
    ),
    '[]'::jsonb
  )
  into v_joined
  from public.beatage_quiz_members m
  join public.beatage_quizzes q on q.id = m.quiz_id
  where m.user_id = v_uid
    and m.role = 'participant'
    and q.status <> 'payment_pending';

  select count(*)::integer into v_active_count
  from public.beatage_quizzes
  where host_user_id = v_uid
    and status in ('draft', 'open', 'playing')
    and unlocked_at is null;

  return jsonb_build_object(
    'plan', v_plan,
    'hosted', v_hosted,
    'joined', v_joined,
    'active_hosted_count', v_active_count
  );
end;
$$;

revoke all on function public.get_beatage_dashboard() from public;
grant execute on function public.get_beatage_dashboard() to authenticated;
