-- Unlock-at-create must not hit ACTIVE_CONTEST_LIMIT (payment_pending slots are separate).
-- Migration 070's string replace often missed live create_contest bodies; patch robustly.

do $patch$
declare
  r record;
  def text;
  next_def text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_contest'
  loop
    def := pg_get_functiondef(r.oid);
    next_def := def;

    -- Declare unlock intent from settings (idempotent).
    if next_def not like '%v_requires_unlock%' then
      if next_def like '%v_chart_country text := coalesce(v_settings->>''chart_country''%' then
        next_def := regexp_replace(
          next_def,
          'v_chart_country text := coalesce\(v_settings->>''chart_country'', ''[^'']*''\);',
          E'v_chart_country text := coalesce(v_settings->>''chart_country'', ''US'');\n  v_requires_unlock boolean := coalesce((v_settings->>''requires_contest_unlock'')::boolean, false);'
        );
      end if;

      if next_def not like '%v_requires_unlock%' then
        next_def := replace(
          next_def,
          'v_settings jsonb := coalesce(p_settings, ''{}''::jsonb);',
          'v_settings jsonb := coalesce(p_settings, ''{}''::jsonb);
  v_requires_unlock boolean := coalesce((v_settings->>''requires_contest_unlock'')::boolean, false);'
        );
      end if;
    end if;

    -- Count only non-unlocked plan contests toward the slot cap.
    if position('unlocked_at is null' in next_def) = 0
       and next_def like '%status in (''draft'', ''open'', ''voting'')%' then
      next_def := replace(
        next_def,
        'status in (''draft'', ''open'', ''voting'')',
        'status in (''draft'', ''open'', ''voting'') and unlocked_at is null'
      );
    end if;

    -- Skip ACTIVE_CONTEST_LIMIT when creating an unlock (payment_pending) contest.
    if next_def like '%ACTIVE_CONTEST_LIMIT%'
       and next_def not like '%if not v_requires_unlock%' then
      next_def := regexp_replace(
        next_def,
        'if[[:space:]]+v_limits\.max_active_contests[[:space:]]+is[[:space:]]+not[[:space:]]+null[[:space:]]+and[[:space:]]+v_active_count[[:space:]]*>=[[:space:]]*v_limits\.max_active_contests[[:space:]]+then[[:space:]]+raise[[:space:]]+exception[[:space:]]+''ACTIVE_CONTEST_LIMIT'';[[:space:]]*end[[:space:]]+if;',
        $r$if not v_requires_unlock
     and v_limits.max_active_contests is not null
     and v_active_count >= v_limits.max_active_contests then
    raise exception 'ACTIVE_CONTEST_LIMIT';
  end if;$r$,
        'i'
      );
    end if;

    if next_def is distinct from def then
      if next_def not like '%v_requires_unlock%' then
        raise exception 'UNLOCK_PATCH_FAILED: could not add v_requires_unlock to create_contest';
      end if;
      execute next_def;
    end if;
  end loop;
end $patch$;
