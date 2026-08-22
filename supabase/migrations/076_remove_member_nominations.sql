-- Optional: remove a participant's nominations when the host kicks them
-- Paste ONLY this SQL into the Supabase SQL editor

create table if not exists public.contest_removed_candidates (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade,
  candidate_id uuid not null,
  title text not null,
  artist text,
  url text,
  description text,
  nominator_user_id uuid,
  nominator_display_name text not null,
  original_status text not null,
  removed_at timestamptz not null default now(),
  removed_by uuid not null references auth.users (id) on delete cascade,
  unique (contest_id, candidate_id)
);

create index if not exists contest_removed_candidates_contest_id_idx
  on public.contest_removed_candidates (contest_id, removed_at desc);

alter table public.contest_removed_candidates enable row level security;

drop policy if exists "removed_candidates_select_host" on public.contest_removed_candidates;
create policy "removed_candidates_select_host"
  on public.contest_removed_candidates
  for select
  using (
    exists (
      select 1
      from public.contests c
      where c.id = contest_id
        and c.host_user_id = auth.uid()
    )
  );

-- Replace any existing overloads with optional nominations cleanup flag
drop function if exists public.remove_contest_member(uuid, uuid);
drop function if exists public.remove_contest_member(uuid, uuid, boolean);

create or replace function public.remove_contest_member(
  p_contest_id uuid,
  p_user_id uuid,
  p_remove_nominations boolean default false
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
  v_removed_candidate_count integer := 0;
  v_cand record;
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

  if coalesce(p_remove_nominations, false) then
    for v_cand in
      select c.*
      from public.candidates c
      where c.contest_id = p_contest_id
        and c.nominator_user_id = p_user_id
        and c.status not in ('withdrawn', 'rejected')
      for update
    loop
      insert into public.contest_removed_candidates (
        contest_id,
        candidate_id,
        title,
        artist,
        url,
        description,
        nominator_user_id,
        nominator_display_name,
        original_status,
        removed_at,
        removed_by
      )
      values (
        p_contest_id,
        v_cand.id,
        v_cand.title,
        v_cand.artist,
        v_cand.url,
        v_cand.description,
        v_cand.nominator_user_id,
        v_member.display_name,
        v_cand.status,
        now(),
        v_uid
      )
      on conflict (contest_id, candidate_id) do update
      set
        title = excluded.title,
        artist = excluded.artist,
        url = excluded.url,
        description = excluded.description,
        nominator_user_id = excluded.nominator_user_id,
        nominator_display_name = excluded.nominator_display_name,
        original_status = excluded.original_status,
        removed_at = excluded.removed_at,
        removed_by = excluded.removed_by;

      update public.candidates
      set status = 'withdrawn'
      where id = v_cand.id;

      v_removed_candidate_count := v_removed_candidate_count + 1;
    end loop;
  end if;

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
    'removed_user_id', p_user_id,
    'removed_candidate_count', v_removed_candidate_count
  );
end;
$$;

revoke all on function public.remove_contest_member(uuid, uuid, boolean) from public;
grant execute on function public.remove_contest_member(uuid, uuid, boolean) to authenticated;

-- Refresh PostgREST so the new RPC signature is visible immediately
notify pgrst, 'reload schema';
