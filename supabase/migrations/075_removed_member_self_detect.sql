-- Allow removed participants to detect their own kick (no auto-rejoin via /j/CODE)
-- Paste ONLY this SQL into the Supabase SQL editor

drop policy if exists "removed_members_select_own" on public.contest_removed_members;
create policy "removed_members_select_own"
  on public.contest_removed_members
  for select
  using (user_id = auth.uid());

-- True when the current user was removed from the contest identified by join code.
create or replace function public.was_removed_from_contest(p_join_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest_id uuid;
begin
  if v_uid is null then
    return false;
  end if;

  select c.id into v_contest_id
  from public.contests c
  where c.join_code = upper(trim(p_join_code));

  if v_contest_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.contest_removed_members r
    where r.contest_id = v_contest_id
      and r.user_id = v_uid
  );
end;
$$;

revoke all on function public.was_removed_from_contest(text) from public;
grant execute on function public.was_removed_from_contest(text) to authenticated;
