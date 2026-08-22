-- Fix contest_members RLS recursion + dashboard helper
-- Paste ONLY this SQL into the Supabase SQL editor (not a file path)

create or replace function public.is_contest_member(p_contest_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.contest_members
    where contest_id = p_contest_id
      and user_id = auth.uid()
  );
$$;

revoke all on function public.is_contest_member(uuid) from public;
grant execute on function public.is_contest_member(uuid) to authenticated;

-- Replace recursive policies
drop policy if exists "contests_select_member" on public.contests;
create policy "contests_select_member"
  on public.contests for select
  using (public.is_contest_member(id));

drop policy if exists "members_select_same_contest" on public.contest_members;
drop policy if exists "members_select_own" on public.contest_members;
drop policy if exists "members_select_peers" on public.contest_members;

-- Own membership rows (no subquery on contest_members)
create policy "members_select_own"
  on public.contest_members for select
  using (auth.uid() = user_id);

-- Fellow members via SECURITY DEFINER helper (no RLS recursion)
create policy "members_select_peers"
  on public.contest_members for select
  using (public.is_contest_member(contest_id));

-- Dashboard payload for the current user
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

  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
  into v_hosted
  from public.contests c
  where c.host_user_id = v_uid;

  select coalesce(jsonb_agg(to_jsonb(c) order by m.joined_at desc), '[]'::jsonb)
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

revoke all on function public.get_my_dashboard() from public;
grant execute on function public.get_my_dashboard() to authenticated;
