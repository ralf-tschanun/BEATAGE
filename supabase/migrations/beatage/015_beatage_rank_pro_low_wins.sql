-- Fix dashboard placement badges for Pro (Closer wins Dynamic):
-- low-wins ranking must include year_distance_dynamic, not only year_distance.

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
  v_rank integer;
begin
  select
    q.status,
    coalesce(q.settings->'scoringModes', '[]'::jsonb)
      ?| array['year_distance', 'year_distance_dynamic']
  into v_status, v_low_wins
  from public.beatage_quizzes q
  where q.id = p_quiz_id;

  if v_status is null or v_status not in ('finished', 'expired') then
    return null;
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
