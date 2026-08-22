-- Archive participants removed by the host (host-visible "Removed users" list)
-- Paste ONLY this SQL into the Supabase SQL editor

create table if not exists public.contest_removed_members (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  joined_at timestamptz not null,
  removed_at timestamptz not null default now(),
  removed_by uuid not null references auth.users (id) on delete cascade,
  unique (contest_id, user_id)
);

create index if not exists contest_removed_members_contest_id_idx
  on public.contest_removed_members (contest_id, removed_at desc);

alter table public.contest_removed_members enable row level security;

drop policy if exists "removed_members_select_host" on public.contest_removed_members;
create policy "removed_members_select_host"
  on public.contest_removed_members
  for select
  using (
    exists (
      select 1
      from public.contests c
      where c.id = contest_id
        and c.host_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- remove_contest_member: archive then hard-delete membership
-- ---------------------------------------------------------------------------
create or replace function public.remove_contest_member(
  p_contest_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_member public.contest_members%rowtype;
  v_host_plan text;
  v_expiry_days integer;
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

  if p_user_id is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  if p_user_id = v_uid then
    raise exception 'CANNOT_REMOVE_HOST';
  end if;

  select * into v_member
  from public.contest_members
  where contest_id = p_contest_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  if v_member.role = 'host' then
    raise exception 'CANNOT_REMOVE_HOST';
  end if;

  insert into public.contest_removed_members (
    contest_id,
    user_id,
    display_name,
    joined_at,
    removed_at,
    removed_by
  )
  values (
    p_contest_id,
    p_user_id,
    v_member.display_name,
    v_member.joined_at,
    now(),
    v_uid
  )
  on conflict (contest_id, user_id) do update
  set
    display_name = excluded.display_name,
    joined_at = excluded.joined_at,
    removed_at = excluded.removed_at,
    removed_by = excluded.removed_by;

  delete from public.ballots
  where contest_id = p_contest_id
    and voter_user_id = p_user_id;

  delete from public.birthday_nominations
  where contest_id = p_contest_id
    and user_id = p_user_id;

  delete from public.contest_members
  where id = v_member.id;

  select coalesce(p.plan, 'free') into v_host_plan
  from public.contests c
  left join public.profiles p on p.id = c.host_user_id
  where c.id = p_contest_id;

  select inactivity_expiry_days into v_expiry_days
  from public.plan_limits(v_host_plan);

  update public.contests
  set
    last_activity_at = now(),
    expires_at = case
      when v_expiry_days is null then null
      else now() + make_interval(days => v_expiry_days)
    end
  where id = p_contest_id;

  return jsonb_build_object(
    'ok', true,
    'contest_id', p_contest_id,
    'removed_user_id', p_user_id
  );
end;
$$;

revoke all on function public.remove_contest_member(uuid, uuid) from public;
grant execute on function public.remove_contest_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- join_contest: clear removed archive if the user rejoins
-- ---------------------------------------------------------------------------
create or replace function public.join_contest(
  p_join_code text,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_member_count integer;
  v_existing public.contest_members%rowtype;
  v_expiry_days integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if char_length(trim(coalesce(p_display_name, ''))) < 1 then
    raise exception 'DISPLAY_NAME_REQUIRED';
  end if;

  select * into v_contest
  from public.contests
  where join_code = upper(trim(p_join_code))
  for update;

  if not found then
    raise exception 'CONTEST_NOT_FOUND';
  end if;

  if v_contest.expires_at is not null and v_contest.expires_at < now() then
    update public.contests set status = 'expired' where id = v_contest.id;
    raise exception 'CONTEST_EXPIRED';
  end if;

  if v_contest.status not in ('open', 'voting') then
    raise exception 'CONTEST_NOT_JOINABLE';
  end if;

  select * into v_existing
  from public.contest_members
  where contest_id = v_contest.id and user_id = v_uid;

  if found then
    return jsonb_build_object(
      'id', v_contest.id,
      'join_code', v_contest.join_code,
      'already_member', true,
      'role', v_existing.role
    );
  end if;

  select count(*)::integer into v_member_count
  from public.contest_members
  where contest_id = v_contest.id;

  if v_contest.max_members is not null and v_member_count >= v_contest.max_members then
    raise exception 'CONTEST_FULL';
  end if;

  insert into public.contest_members (contest_id, user_id, display_name, role)
  values (v_contest.id, v_uid, trim(p_display_name), 'participant');

  delete from public.contest_removed_members
  where contest_id = v_contest.id
    and user_id = v_uid;

  -- Extend expiry based on host plan
  select inactivity_expiry_days into v_expiry_days
  from public.plan_limits(
    (select coalesce(plan, 'free') from public.profiles where id = v_contest.host_user_id)
  );

  update public.contests
  set
    last_activity_at = now(),
    expires_at = case
      when v_expiry_days is null then null
      else now() + make_interval(days => v_expiry_days)
    end
  where id = v_contest.id;

  update public.profiles
  set display_name = trim(p_display_name), updated_at = now()
  where id = v_uid
    and (display_name is null or btrim(display_name) = '');

  return jsonb_build_object(
    'id', v_contest.id,
    'join_code', v_contest.join_code,
    'already_member', false,
    'role', 'participant'
  );
end;
$$;

revoke all on function public.join_contest(text, text) from public;
grant execute on function public.join_contest(text, text) to authenticated;
