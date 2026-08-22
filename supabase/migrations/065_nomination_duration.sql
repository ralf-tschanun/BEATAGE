-- Timed nomination window: host starts nominations, then closes after a fixed duration.
-- Paste ONLY this SQL into the Supabase SQL editor.

alter table public.contests
  add column if not exists nomination_duration_seconds integer
    check (
      nomination_duration_seconds is null
      or (
        nomination_duration_seconds >= 1
        and nomination_duration_seconds <= 86400
      )
    );

comment on column public.contests.nomination_duration_seconds is
  'When set, opening nominations starts a countdown of this many seconds (1–86400).';

create or replace function public.open_nominations(p_contest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_deadline timestamptz := null;
  v_duration integer;
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

  if v_contest.status <> 'open' then
    raise exception 'NOMINATIONS_CANNOT_REOPEN';
  end if;

  if v_contest.voting_open then
    raise exception 'VOTING_IN_PROGRESS';
  end if;

  v_duration := v_contest.nomination_duration_seconds;
  if v_duration is not null then
    if v_duration < 1 or v_duration > 86400 then
      raise exception 'INVALID_SETTINGS';
    end if;
    v_deadline := now() + make_interval(secs => v_duration);
  end if;

  update public.contests
  set
    nominations_open = true,
    nomination_deadline = v_deadline,
    nominations_reopened_at = now(),
    last_activity_at = now()
  where id = p_contest_id
  returning * into v_contest;

  return jsonb_build_object(
    'ok', true,
    'nominations_open', v_contest.nominations_open,
    'nomination_deadline', v_contest.nomination_deadline,
    'nominations_reopened_at', v_contest.nominations_reopened_at,
    'nomination_duration_seconds', v_contest.nomination_duration_seconds
  );
end;
$$;

revoke all on function public.open_nominations(uuid) from public;
grant execute on function public.open_nominations(uuid) to authenticated;
