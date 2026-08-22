-- Candidate order: as_entered; Results reveal: live (ranking during voting).
-- Paste ONLY this SQL into the Supabase SQL editor if not applied via CLI.

alter table public.contests
  drop constraint if exists contests_candidate_sort_check;

alter table public.contests
  add constraint contests_candidate_sort_check
  check (
    candidate_sort in (
      'as_entered',
      'nominated_at',
      'alphabetical',
      'random'
    )
  );

alter table public.contests
  drop constraint if exists contests_results_reveal_check;

alter table public.contests
  add constraint contests_results_reveal_check
  check (
    results_reveal in (
      'live',
      'immediate',
      'last_to_first',
      'by_participant'
    )
  );

-- Stable entry order (created_at), used when switching to as_entered.
create or replace function public.assign_entered_candidate_order(p_contest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with ranked as (
    select
      id,
      row_number() over (order by created_at asc, id asc)::integer as rn
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

revoke all on function public.assign_entered_candidate_order(uuid) from public;
grant execute on function public.assign_entered_candidate_order(uuid) to authenticated;

-- Allow new enum values in create_contest / update_contest_settings validators.
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
      '''nominated_at'', ''alphabetical'', ''random''',
      '''as_entered'', ''nominated_at'', ''alphabetical'', ''random'''
    );

    def := replace(
      def,
      '''immediate'', ''last_to_first'', ''by_participant''',
      '''live'', ''immediate'', ''last_to_first'', ''by_participant'''
    );

    def := replace(
      def,
      'if v_candidate_sort = ''random'' then
    perform public.reshuffle_contest_candidates(p_contest_id);
  end if;',
      'if v_candidate_sort = ''random'' then
    perform public.reshuffle_contest_candidates(p_contest_id);
  elsif v_candidate_sort = ''as_entered'' then
    perform public.assign_entered_candidate_order(p_contest_id);
  end if;'
    );

    execute def;
  end loop;
end $patch$;

-- Append display_order for as_entered nominations (latest nominate_candidate).
do $patch_nominate$
declare
  r record;
  def text;
  v_old text := $old$
  if coalesce(v_contest.candidate_sort, 'nominated_at') = 'random' then
    perform public.reshuffle_contest_candidates(p_contest_id);
    select * into v_candidate from public.candidates where id = v_candidate.id;
  else
    update public.contests
    set last_activity_at = now()
    where id = p_contest_id;
  end if;
$old$;
  v_new text := $new$
  if coalesce(v_contest.candidate_sort, 'nominated_at') = 'random' then
    perform public.reshuffle_contest_candidates(p_contest_id);
    select * into v_candidate from public.candidates where id = v_candidate.id;
  elsif coalesce(v_contest.candidate_sort, 'nominated_at') = 'as_entered' then
    update public.candidates
    set display_order = coalesce(
      (
        select max(c2.display_order)
        from public.candidates c2
        where c2.contest_id = p_contest_id
          and c2.id <> v_candidate.id
          and c2.status <> 'withdrawn'
          and c2.status <> 'rejected'
      ),
      0
    ) + 1
    where id = v_candidate.id
    returning * into v_candidate;

    update public.contests
    set last_activity_at = now()
    where id = p_contest_id;
  else
    update public.contests
    set last_activity_at = now()
    where id = p_contest_id;
  end if;
$new$;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'nominate_candidate'
  loop
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, '^CREATE (OR REPLACE )?FUNCTION', 'CREATE OR REPLACE FUNCTION');
    if position(v_old in def) > 0 then
      def := replace(def, v_old, v_new);
      execute def;
    end if;
  end loop;
end $patch_nominate$;

-- Sequential reveal order also respects as_entered display_order.
do $patch_reveal$
declare
  r record;
  def text;
  v_old text := $old$
    case when v_sort = 'alphabetical' then lower(title) end asc nulls last,
    case when v_sort = 'random' then display_order end asc nulls last,
    created_at asc,
$old$;
  v_new text := $new$
    case when v_sort = 'alphabetical' then lower(title) end asc nulls last,
    case when v_sort in ('random', 'as_entered') then display_order end asc nulls last,
    created_at asc,
$new$;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('reveal_next_candidate', 'reveal_candidates')
  loop
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, '^CREATE (OR REPLACE )?FUNCTION', 'CREATE OR REPLACE FUNCTION');
    if position(v_old in def) > 0 then
      def := replace(def, v_old, v_new);
      execute def;
    end if;
  end loop;
end $patch_reveal$;
