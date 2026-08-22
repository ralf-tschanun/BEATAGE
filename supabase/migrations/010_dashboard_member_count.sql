-- Include participant count in dashboard contest rows
-- Paste ONLY this SQL into the Supabase SQL editor

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
        || jsonb_build_object(
          'my_display_name', m.display_name,
          'member_count', (
            select count(*)::integer
            from public.contest_members cm
            where cm.contest_id = c.id
          )
        )
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
  where c.host_user_id = v_uid;

  select coalesce(
    jsonb_agg(
      (
        to_jsonb(c)
        || jsonb_build_object(
          'my_display_name', m.display_name,
          'member_count', (
            select count(*)::integer
            from public.contest_members cm
            where cm.contest_id = c.id
          )
        )
      )
      order by m.joined_at desc
    ),
    '[]'::jsonb
  )
  into v_joined
  from public.contest_members m
  join public.contests c on c.id = m.contest_id
  where m.user_id = v_uid
    and m.role = 'participant';

  select count(*)::integer into v_active_count
  from public.contests
  where host_user_id = v_uid
    and status in ('draft', 'open', 'voting');

  return jsonb_build_object(
    'plan', v_plan,
    'hosted', v_hosted,
    'joined', v_joined,
    'active_hosted_count', v_active_count
  );
end;
$$;
