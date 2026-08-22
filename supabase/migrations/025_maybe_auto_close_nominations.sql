-- Auto-close nominations when nomination_deadline has passed
-- Paste ONLY this SQL into the Supabase SQL editor

create or replace function public.maybe_auto_close_nominations(p_contest_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contest public.contests%rowtype;
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
