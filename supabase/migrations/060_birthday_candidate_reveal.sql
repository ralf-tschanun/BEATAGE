-- Birthday contests: keep the host-chosen candidate reveal instead of forcing
-- admin_batch. The create UI still defaults to Admin batch release.
-- Paste ONLY this SQL into the Supabase SQL editor.

create or replace function public.enforce_birthday_contest_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.nomination_kind = 'birthday' then
    new.theme := 'song';
    if coalesce(new.candidate_source, 'user_single') <> 'curated' then
      new.candidate_source := 'user_single';
      new.max_nominations_per_participant := 1;
      new.max_candidates := null;
    end if;
    new.allow_duplicate_candidates := true;
    new.allow_vote_own_nominations := true;
  end if;
  return new;
end;
$$;

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

    -- Birthday block used to overwrite whatever the host picked.
    def := replace(
      def,
      E'v_allow_dupes := true;\n    v_reveal := ''admin_batch'';',
      'v_allow_dupes := true;'
    );
    def := replace(
      def,
      'v_allow_dupes := true; v_reveal := ''admin_batch'';',
      'v_allow_dupes := true;'
    );

    execute def;
  end loop;
end $patch$;
