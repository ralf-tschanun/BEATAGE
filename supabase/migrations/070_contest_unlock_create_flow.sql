-- Contest unlock at create: payment_pending drafts, plan slots exclude unlocked contests.

alter table public.contests
  drop constraint if exists contests_status_check;

alter table public.contests
  add constraint contests_status_check
  check (status in ('draft', 'open', 'voting', 'finished', 'expired', 'payment_pending'));

-- Unlock: lift all per-contest caps and publish payment_pending drafts.
create or replace function public.unlock_contest_from_billing(
  p_contest_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
  v_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select host_user_id, status into v_host, v_status
  from public.contests
  where id = p_contest_id;

  if v_host is null then
    raise exception 'CONTEST_NOT_FOUND';
  end if;

  if v_host is distinct from p_user_id then
    raise exception 'NOT_HOST';
  end if;

  update public.contests
  set
    unlocked_at = coalesce(unlocked_at, now()),
    status = case when status = 'payment_pending' then 'draft' else status end,
    max_members = null,
    expires_at = null,
    max_nominations_per_participant = null,
    max_candidates = null
  where id = p_contest_id;

  return jsonb_build_object('ok', true, 'contest_id', p_contest_id);
end;
$$;

revoke all on function public.unlock_contest_from_billing(uuid, uuid) from public;
grant execute on function public.unlock_contest_from_billing(uuid, uuid) to service_role;

-- Plan slots: only non-unlocked plan contests count toward max_active_contests.
-- Hosted list: hide payment_pending until unlock completes.
create or replace function public.get_my_dashboard()
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
  if v_uid is null then
    return jsonb_build_object(
      'plan', 'free',
      'hosted', '[]'::jsonb,
      'joined', '[]'::jsonb,
      'active_hosted_count', 0
    );
  end if;

  select coalesce(plan, 'free') into v_plan
  from public.profiles
  where id = v_uid;

  if v_plan is null then
    v_plan := 'free';
  end if;

  select coalesce(
    jsonb_agg(
      (
        to_jsonb(c)
        || jsonb_build_object('my_display_name', m.display_name)
      )
      order by c.created_at desc
    ),
    '[]'::jsonb
  )
  into v_hosted
  from public.contests c
  join public.contest_members m
    on m.contest_id = c.id
   and m.user_id = v_uid
   and m.role = 'host'
  where c.host_user_id = v_uid
    and c.status <> 'payment_pending';

  select coalesce(
    jsonb_agg(
      (
        to_jsonb(c)
        || jsonb_build_object('my_display_name', m.display_name)
      )
      order by m.joined_at desc
    ),
    '[]'::jsonb
  )
  into v_joined
  from public.contest_members m
  join public.contests c on c.id = m.contest_id
  where m.user_id = v_uid
    and m.role = 'participant'
    and c.status <> 'payment_pending';

  select count(*)::integer into v_active_count
  from public.contests
  where host_user_id = v_uid
    and status in ('draft', 'open', 'voting')
    and unlocked_at is null;

  return jsonb_build_object(
    'plan', v_plan,
    'hosted', v_hosted,
    'joined', v_joined,
    'active_hosted_count', v_active_count
  );
end;
$$;

-- Patch create_contest: payment_pending + unlock intent + plan slot rules.
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
      and p.proname = 'create_contest'
  loop
    def := pg_get_functiondef(r.oid);

    if def not like '%v_requires_unlock%' then
      def := replace(
        def,
        'v_chart_country text := coalesce(v_settings->>''chart_country'', ''US'');',
        'v_chart_country text := coalesce(v_settings->>''chart_country'', ''US'');
  v_requires_unlock boolean := coalesce((v_settings->>''requires_contest_unlock'')::boolean, false);'
      );
    end if;

    def := replace(
      def,
      '  select count(*)::integer into v_active_count
  from public.contests
  where host_user_id = v_uid
    and status in (''draft'', ''open'', ''voting'');

  if v_limits.max_active_contests is not null
     and v_active_count >= v_limits.max_active_contests then
    raise exception ''ACTIVE_CONTEST_LIMIT'';
  end if;',
      '  select count(*)::integer into v_active_count
  from public.contests
  where host_user_id = v_uid
    and status in (''draft'', ''open'', ''voting'')
    and unlocked_at is null;

  if not v_requires_unlock
     and v_limits.max_active_contests is not null
     and v_active_count >= v_limits.max_active_contests then
    raise exception ''ACTIVE_CONTEST_LIMIT'';
  end if;'
    );

    if def not like '%if v_requires_unlock then%' then
      def := replace(
        def,
        '  if v_source = ''user_single'' then
    v_max_noms := 1;
  elsif v_source = ''user_multiple'' then
    v_max_noms := greatest(1, coalesce((v_settings->>''max_nominations_per_participant'')::integer, 1));
    if v_plan = ''free'' then
      v_max_noms := least(v_max_noms, 2);
    elsif v_plan = ''plus'' then
      v_max_noms := least(v_max_noms, 5);
    end if;
  else
    v_max_noms := 1;
  end if;',
        '  if v_requires_unlock then
    if v_source = ''user_single'' then
      v_max_noms := 1;
    elsif v_source in (''user_multiple'', ''combined'') then
      v_max_noms := greatest(1, coalesce((v_settings->>''max_nominations_per_participant'')::integer, 1));
    else
      v_max_noms := 1;
    end if;
  elsif v_source = ''user_single'' then
    v_max_noms := 1;
  elsif v_source = ''user_multiple'' then
    v_max_noms := greatest(1, coalesce((v_settings->>''max_nominations_per_participant'')::integer, 1));
    if v_plan = ''free'' then
      v_max_noms := least(v_max_noms, 2);
    elsif v_plan = ''plus'' then
      v_max_noms := least(v_max_noms, 5);
    end if;
  else
    v_max_noms := 1;
  end if;'
      );

      def := replace(
        def,
        '  if v_source in (''curated'', ''combined'') then
    if v_plan = ''free'' then
      v_max_candidates := 10;
    elsif v_plan = ''plus'' then
      v_max_candidates := 50;
    else
      v_max_candidates := null;
    end if;
  elsif v_source = ''combined'' then
    if v_plan = ''free'' then v_max_candidates := 10; elsif v_plan = ''plus'' then v_max_candidates := 50; else v_max_candidates := null; end if;
  else v_max_candidates := null; end if;',
        '  if v_requires_unlock then
    if v_source in (''curated'', ''combined'') then
      v_max_candidates := nullif((v_settings->>''max_curated_candidates'')::integer, 0);
    else
      v_max_candidates := null;
    end if;
  elsif v_source in (''curated'', ''combined'') then
    if v_plan = ''free'' then
      v_max_candidates := 10;
    elsif v_plan = ''plus'' then
      v_max_candidates := 50;
    else
      v_max_candidates := null;
    end if;
  else v_max_candidates := null; end if;'
      );
    end if;

    def := replace(
      def,
      '        status,
        mode,',
      '        status,
        mode,'
    );

    if def like '%''draft'',%' and def not like '%payment_pending%' then
      def := replace(
        def,
        '''draft'',
        v_limits.mode,',
        'case when v_requires_unlock then ''payment_pending'' else ''draft'' end,
        v_limits.mode,'
      );
    end if;

    execute def;
  end loop;
end $patch$;
