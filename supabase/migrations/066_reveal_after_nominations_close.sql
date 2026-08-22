-- Candidate reveal: after_nominations_close — auto-reveal all when nominations end.
-- Paste ONLY this SQL into the Supabase SQL editor.

alter table public.contests
  drop constraint if exists contests_candidate_reveal_check;

alter table public.contests
  add constraint contests_candidate_reveal_check
  check (
    candidate_reveal in (
      'live',
      'admin_batch',
      'admin_sequential',
      'after_nominations_close'
    )
  );

-- Allow the new value in create_contest / update_contest_settings checks.
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

    def := replace(
      def,
      'v_reveal not in (''live'', ''admin_batch'', ''admin_sequential'')',
      'v_reveal not in (''live'', ''admin_batch'', ''admin_sequential'', ''after_nominations_close'')'
    );
    def := replace(
      def,
      'v_reveal not in (''live'', ''admin_batch'')',
      'v_reveal not in (''live'', ''admin_batch'', ''admin_sequential'', ''after_nominations_close'')'
    );

    execute def;
  end loop;
end $patch$;

create or replace function public.close_nominations(p_contest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_now timestamptz := now();
  v_revealed integer := 0;
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

  if v_contest.status in ('finished', 'expired') then
    raise exception 'CONTEST_LOCKED';
  end if;

  if coalesce(v_contest.candidate_reveal, 'live') = 'after_nominations_close' then
    update public.candidates
    set
      status = 'visible',
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('revealed_at', v_now)
    where contest_id = p_contest_id
      and status = 'pending';
    get diagnostics v_revealed = row_count;
  end if;

  update public.contests
  set
    nominations_open = false,
    last_activity_at = now()
  where id = p_contest_id
  returning * into v_contest;

  return jsonb_build_object(
    'ok', true,
    'nominations_open', v_contest.nominations_open,
    'revealed_count', v_revealed
  );
end;
$$;

revoke all on function public.close_nominations(uuid) from public;
grant execute on function public.close_nominations(uuid) to authenticated;

create or replace function public.maybe_auto_close_nominations(p_contest_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contest public.contests%rowtype;
  v_now timestamptz := now();
begin
  select * into v_contest
  from public.contests
  where id = p_contest_id
  for update;

  if not found then
    return false;
  end if;

  if not v_contest.nominations_open then
    return false;
  end if;

  if v_contest.status not in ('open', 'voting') then
    return false;
  end if;

  if v_contest.nomination_deadline is null then
    return false;
  end if;

  if v_contest.nomination_deadline > now() then
    return false;
  end if;

  if coalesce(v_contest.candidate_reveal, 'live') = 'after_nominations_close' then
    update public.candidates
    set
      status = 'visible',
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('revealed_at', v_now)
    where contest_id = p_contest_id
      and status = 'pending';
  end if;

  update public.contests
  set
    nominations_open = false,
    last_activity_at = now()
  where id = p_contest_id;

  return true;
end;
$$;

revoke all on function public.maybe_auto_close_nominations(uuid) from public;
grant execute on function public.maybe_auto_close_nominations(uuid) to authenticated;

create or replace function public.start_voting(p_contest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_count integer;
  v_pending integer;
  v_now timestamptz := now();
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

  if v_contest.status in ('finished', 'expired') then
    raise exception 'CONTEST_LOCKED';
  end if;

  if v_contest.status = 'voting' and v_contest.voting_open then
    return jsonb_build_object(
      'ok', true,
      'status', v_contest.status,
      'voting_open', v_contest.voting_open
    );
  end if;

  if v_contest.status not in ('open', 'voting') then
    raise exception 'VOTING_NOT_ALLOWED';
  end if;

  select count(*)::integer into v_count
  from public.candidates
  where contest_id = p_contest_id
    and status <> 'withdrawn'
    and status <> 'rejected';

  if v_count < 1 then
    raise exception 'NO_CANDIDATES';
  end if;

  -- Closing nominations by starting voting also reveals for this mode.
  if coalesce(v_contest.candidate_reveal, 'live') = 'after_nominations_close' then
    update public.candidates
    set
      status = 'visible',
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('revealed_at', v_now)
    where contest_id = p_contest_id
      and status = 'pending';
  end if;

  if coalesce(v_contest.candidate_reveal, 'live') = 'admin_batch' then
    select count(*)::integer into v_pending
    from public.candidates
    where contest_id = p_contest_id
      and status = 'pending';

    if v_pending > 0 then
      raise exception 'CANDIDATES_NOT_REVEALED';
    end if;
  end if;

  if v_contest.voting_close_mode = 'scheduled'
     and (
       v_contest.voting_closes_at is null
       or v_contest.voting_closes_at <= now()
     ) then
    raise exception 'VOTING_CLOSE_REQUIRED';
  end if;

  if coalesce(v_contest.candidate_reveal, 'live') = 'live' then
    update public.candidates
    set status = 'in_voting'
    where contest_id = p_contest_id
      and status in ('pending', 'visible');
  else
    update public.candidates
    set status = 'in_voting'
    where contest_id = p_contest_id
      and status = 'visible';
  end if;

  select count(*)::integer into v_count
  from public.candidates
  where contest_id = p_contest_id
    and status = 'in_voting';

  if v_count < 1 then
    raise exception 'NO_CANDIDATES';
  end if;

  update public.contests
  set
    status = 'voting',
    voting_open = true,
    nominations_open = false,
    last_activity_at = now()
  where id = p_contest_id
  returning * into v_contest;

  return jsonb_build_object(
    'ok', true,
    'status', v_contest.status,
    'voting_open', v_contest.voting_open,
    'candidate_count', v_count
  );
end;
$$;

revoke all on function public.start_voting(uuid) from public;
grant execute on function public.start_voting(uuid) to authenticated;
