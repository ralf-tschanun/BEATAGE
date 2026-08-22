-- Combined contests: allow multiple nominations per participant (like user_multiple).
-- Previously create/update forced max_nominations_per_participant = 1 for combined.
-- Paste ONLY this SQL into the Supabase SQL editor.

do $patch$
declare
  r record;
  def text;
  v_old text;
  v_new text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_contest', 'update_contest_settings')
  loop
    def := pg_get_functiondef(r.oid);

    -- Compact one-line form (from older migrations / birthday patch).
    v_old := 'elsif v_source = ''user_multiple'' then';
    v_new := 'elsif v_source in (''user_multiple'', ''combined'') then';
    if position(v_old in def) > 0 then
      def := replace(def, v_old, v_new);
    end if;

    -- Multiline form used in some update_contest_settings variants.
    v_old := 'elsif v_source = ''user_multiple'' then
';
    v_new := 'elsif v_source in (''user_multiple'', ''combined'') then
';
    if position(v_old in def) > 0 then
      def := replace(def, v_old, v_new);
    end if;

    execute def;
  end loop;
end $patch$;
