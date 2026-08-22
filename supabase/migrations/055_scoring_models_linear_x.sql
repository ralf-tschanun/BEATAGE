-- Scoring models: add linear2 + linear_x; Best only as default; update slot helper.

alter table public.contests
  drop constraint if exists contests_scoring_model_check;

alter table public.contests
  add constraint contests_scoring_model_check
  check (
    scoring_model in (
      'best_only',
      'linear_x',
      'linear2',
      'linear3',
      'linear5',
      'linear12',
      'dyn4',
      'dyn6',
      'dyn10'
    )
  );

alter table public.contests
  alter column scoring_model set default 'best_only';

create or replace function public.scoring_slot_count(p_model text)
returns integer
language sql
immutable
as $$
  select case p_model
    when 'best_only' then 1
    when 'linear_x' then 1000
    when 'linear2' then 2
    when 'linear3' then 3
    when 'linear5' then 5
    when 'linear12' then 12
    when 'dyn4' then 4
    when 'dyn6' then 6
    when 'dyn10' then 10
    else 1
  end;
$$;

-- Allow new model ids in create_contest / update_contest_settings validators.
do $patch$
declare
  r record;
  def text;
  v_old text := '''best_only'', ''linear3'', ''linear5'', ''linear12'', ''dyn4'', ''dyn6'', ''dyn10''';
  v_new text := '''best_only'', ''linear_x'', ''linear2'', ''linear3'', ''linear5'', ''linear12'', ''dyn4'', ''dyn6'', ''dyn10''';
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_contest', 'update_contest_settings')
  loop
    def := pg_get_functiondef(r.oid);
    if position(v_old in def) > 0 then
      def := replace(def, v_old, v_new);
      execute def;
    end if;
  end loop;
end $patch$;
