-- Nominator results reveal: first_to_last (stepped reveal from first place down).
-- Paste ONLY this SQL into the Supabase SQL editor if not applied via CLI.

alter table public.contests
  drop constraint if exists contests_nominator_results_reveal_check;

alter table public.contests
  add constraint contests_nominator_results_reveal_check
  check (
    nominator_results_reveal in (
      'immediate',
      'last_to_first',
      'first_to_last'
    )
  );

-- Allow the new value in create_contest / update_contest_settings validators.
do $patch$
declare
  r record;
  def text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_contest', 'update_contest_settings')
  loop
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, '^CREATE (OR REPLACE )?FUNCTION', 'CREATE OR REPLACE FUNCTION');

    def := replace(
      def,
      'v_nominator_results_reveal not in (''immediate'', ''last_to_first'')',
      'v_nominator_results_reveal not in (''immediate'', ''last_to_first'', ''first_to_last'')'
    );

    execute def;
  end loop;
end $patch$;

-- Stepped nominator reveal: last_to_first and first_to_last share the same step counter.
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
  v_nom_mode text;
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
  v_nom_mode := coalesce(v_contest.nominator_results_reveal, 'immediate');

  if v_phase = 'nominators' then
    if v_nom_mode in ('last_to_first', 'first_to_last') then
      if v_contest.nomination_kind = 'birthday'
         and v_contest.candidate_source = 'curated' then
        select count(*)::integer into v_max
        from public.curated_birthday_entries e
        join public.candidates c on c.id = e.candidate_id
        where e.contest_id = p_contest_id
          and c.status = 'in_voting';
      else
        select count(*)::integer into v_max
        from (
          select nominator_user_id
          from public.candidates
          where contest_id = p_contest_id
            and status = 'in_voting'
            and nominator_user_id is not null
          group by nominator_user_id
        ) t;
      end if;

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

  if v_phase = 'candidates' then
    if v_mode = 'immediate' or v_mode = 'live' then
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

  return jsonb_build_object(
    'ok', true,
    'results_phase', v_contest.results_phase,
    'complete', true
  );
end;
$$;

revoke all on function public.advance_results_reveal(uuid) from public;
grant execute on function public.advance_results_reveal(uuid) to authenticated;
