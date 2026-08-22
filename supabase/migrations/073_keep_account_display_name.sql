-- Contest host nickname must never overwrite the account profile name.
-- Also repair profiles polluted with the literal fallback "Host".

-- 1) Restore account names from signup metadata when profile was overwritten with "Host".
update public.profiles p
set
  display_name = left(trim(u.raw_user_meta_data->>'display_name'), 40),
  updated_at = now()
from auth.users u
where p.id = u.id
  and lower(btrim(coalesce(p.display_name, ''))) = 'host'
  and nullif(btrim(u.raw_user_meta_data->>'display_name'), '') is not null
  and lower(btrim(u.raw_user_meta_data->>'display_name')) <> 'host';

-- 2) Align host member labels that still say "Host" with the repaired profile name.
update public.contest_members m
set display_name = p.display_name
from public.profiles p
where m.user_id = p.id
  and m.role = 'host'
  and lower(btrim(m.display_name)) = 'host'
  and nullif(btrim(p.display_name), '') is not null
  and lower(btrim(p.display_name)) <> 'host';

-- 3) Stop create_contest from writing p_host_name into profiles (idempotent string patch).
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

    -- Unconditional profile overwrite (older bodies).
    next_def := regexp_replace(
      next_def,
      E'update public\\.profiles\\s+set display_name = trim\\(p_host_name\\), updated_at = now\\(\\)\\s+where id = v_uid;\\s*',
      '',
      'gi'
    );

    -- Fill-only-when-empty variant (still wrong when fallback is "Host").
    next_def := regexp_replace(
      next_def,
      E'update public\\.profiles\\s+set display_name = trim\\(p_host_name\\), updated_at = now\\(\\)\\s+where id = v_uid\\s+and \\(display_name is null or btrim\\(display_name\\) = ''''\\);\\s*',
      '',
      'gi'
    );

    -- Compact one-liner variant from curated birthday migration.
    next_def := regexp_replace(
      next_def,
      E'update public\\.profiles set display_name = trim\\(p_host_name\\), updated_at = now\\(\\) where id = v_uid and \\(display_name is null or btrim\\(display_name\\) = ''''\\);\\s*',
      '',
      'gi'
    );

    if next_def is distinct from def then
      execute next_def;
    end if;
  end loop;
end $patch$;
