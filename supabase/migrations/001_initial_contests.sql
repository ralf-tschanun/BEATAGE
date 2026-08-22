-- MyContest initial schema: guest-first contests with create/join
-- Run in Supabase SQL Editor (Dashboard → SQL → New query)

create extension if not exists pgcrypto;

-- Profiles (1:1 with auth.users; anonymous users included)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  plan text not null default 'free' check (plan in ('free', 'plus', 'pro')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contests (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  status text not null default 'open'
    check (status in ('draft', 'open', 'voting', 'finished', 'expired')),
  mode text not null default 'simple' check (mode in ('simple', 'advanced')),
  host_user_id uuid not null references auth.users (id) on delete cascade,
  max_members integer check (max_members is null or max_members > 0),
  join_code text not null unique,
  manage_token text not null unique,
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists contests_host_user_id_idx on public.contests (host_user_id);
create index if not exists contests_join_code_idx on public.contests (join_code);
create index if not exists contests_status_idx on public.contests (status);

create table if not exists public.contest_members (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  role text not null check (role in ('host', 'participant')),
  joined_at timestamptz not null default now(),
  unique (contest_id, user_id)
);

create index if not exists contest_members_contest_id_idx on public.contest_members (contest_id);
create index if not exists contest_members_user_id_idx on public.contest_members (user_id);

-- Auto-create profile for every auth user (including anonymous)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', null)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Plan limits (kept in sync with src/lib/plans.ts)
create or replace function public.plan_limits(p_plan text)
returns table (
  max_active_contests integer,
  max_members integer,
  mode text,
  inactivity_expiry_days integer
)
language sql
immutable
as $$
  select
    t.max_active_contests,
    t.max_members,
    t.mode,
    t.inactivity_expiry_days
  from (
    values
      ('free'::text, 1::integer, 10::integer, 'simple'::text, 7::integer),
      ('plus'::text, 5::integer, 20::integer, 'advanced'::text, 183::integer),
      ('pro'::text, null::integer, null::integer, 'advanced'::text, null::integer)
  ) as t(plan, max_active_contests, max_members, mode, inactivity_expiry_days)
  where t.plan = coalesce(p_plan, 'free');
$$;

create or replace function public.generate_join_code()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i integer;
begin
  for i in 1..6 loop
    result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  end loop;
  return result;
end;
$$;

create or replace function public.generate_manage_token()
returns text
language sql
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

-- Create contest (anonymous or signed-in)
create or replace function public.create_contest(
  p_title text,
  p_host_name text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan text;
  v_limits record;
  v_active_count integer;
  v_join_code text;
  v_manage_token text;
  v_contest public.contests%rowtype;
  v_attempts integer := 0;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if char_length(trim(coalesce(p_title, ''))) < 1 then
    raise exception 'TITLE_REQUIRED';
  end if;

  if char_length(trim(coalesce(p_host_name, ''))) < 1 then
    raise exception 'HOST_NAME_REQUIRED';
  end if;

  select coalesce(plan, 'free') into v_plan from public.profiles where id = v_uid;
  if v_plan is null then
    insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;
    v_plan := 'free';
  end if;

  select * into v_limits from public.plan_limits(v_plan);

  select count(*)::integer into v_active_count
  from public.contests
  where host_user_id = v_uid
    and status in ('draft', 'open', 'voting');

  if v_limits.max_active_contests is not null
     and v_active_count >= v_limits.max_active_contests then
    raise exception 'ACTIVE_CONTEST_LIMIT';
  end if;

  loop
    v_join_code := public.generate_join_code();
    v_manage_token := public.generate_manage_token();
    begin
      insert into public.contests (
        title,
        description,
        status,
        mode,
        host_user_id,
        max_members,
        join_code,
        manage_token,
        last_activity_at,
        expires_at
      )
      values (
        trim(p_title),
        nullif(trim(coalesce(p_description, '')), ''),
        'open',
        v_limits.mode,
        v_uid,
        v_limits.max_members,
        v_join_code,
        v_manage_token,
        now(),
        case
          when v_limits.inactivity_expiry_days is null then null
          else now() + make_interval(days => v_limits.inactivity_expiry_days)
        end
      )
      returning * into v_contest;
      exit;
    exception when unique_violation then
      v_attempts := v_attempts + 1;
      if v_attempts > 8 then
        raise exception 'CODE_GENERATION_FAILED';
      end if;
    end;
  end loop;

  insert into public.contest_members (contest_id, user_id, display_name, role)
  values (v_contest.id, v_uid, trim(p_host_name), 'host');

  update public.profiles
  set display_name = trim(p_host_name), updated_at = now()
  where id = v_uid
    and (display_name is null or btrim(display_name) = '');

  return jsonb_build_object(
    'id', v_contest.id,
    'title', v_contest.title,
    'join_code', v_contest.join_code,
    'manage_token', v_contest.manage_token,
    'max_members', v_contest.max_members,
    'mode', v_contest.mode,
    'expires_at', v_contest.expires_at
  );
end;
$$;

-- Preview contest for join page (no membership required)
create or replace function public.get_contest_by_join_code(p_join_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contest public.contests%rowtype;
  v_member_count integer;
begin
  select * into v_contest
  from public.contests
  where join_code = upper(trim(p_join_code));

  if not found then
    return null;
  end if;

  -- Expire on read if needed
  if v_contest.expires_at is not null and v_contest.expires_at < now()
     and v_contest.status in ('draft', 'open', 'voting') then
    update public.contests set status = 'expired' where id = v_contest.id;
    v_contest.status := 'expired';
  end if;

  select count(*)::integer into v_member_count
  from public.contest_members
  where contest_id = v_contest.id;

  return jsonb_build_object(
    'id', v_contest.id,
    'title', v_contest.title,
    'description', v_contest.description,
    'status', v_contest.status,
    'mode', v_contest.mode,
    'max_members', v_contest.max_members,
    'member_count', v_member_count,
    'expires_at', v_contest.expires_at,
    'is_full', case
      when v_contest.max_members is null then false
      else v_member_count >= v_contest.max_members
    end
  );
end;
$$;

-- Join contest
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

revoke all on function public.create_contest(text, text, text) from public;
revoke all on function public.join_contest(text, text) from public;
revoke all on function public.get_contest_by_join_code(text) from public;
revoke all on function public.plan_limits(text) from public;

grant execute on function public.create_contest(text, text, text) to authenticated;
grant execute on function public.join_contest(text, text) to authenticated;
grant execute on function public.get_contest_by_join_code(text) to anon, authenticated;

-- Membership check without RLS recursion (SECURITY DEFINER bypasses policies)
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

-- RLS
alter table public.profiles enable row level security;
alter table public.contests enable row level security;
alter table public.contest_members enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "contests_select_member" on public.contests;
create policy "contests_select_member"
  on public.contests for select
  using (public.is_contest_member(id));

drop policy if exists "contests_update_host" on public.contests;
create policy "contests_update_host"
  on public.contests for update
  using (auth.uid() = host_user_id);

drop policy if exists "members_select_same_contest" on public.contest_members;
create policy "members_select_same_contest"
  on public.contest_members for select
  using (public.is_contest_member(contest_id));
