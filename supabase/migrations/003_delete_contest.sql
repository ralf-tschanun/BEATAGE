-- Host can delete own contests from the contest page
-- Paste ONLY this SQL into the Supabase SQL editor

create or replace function public.delete_contest(p_contest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
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

  delete from public.contests where id = p_contest_id;

  return jsonb_build_object('ok', true, 'id', p_contest_id);
end;
$$;

revoke all on function public.delete_contest(uuid) from public;
grant execute on function public.delete_contest(uuid) to authenticated;
