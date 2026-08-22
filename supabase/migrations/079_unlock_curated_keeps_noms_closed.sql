-- After unlock payment: curated contests keep nominations closed (list already seeded).
-- User/combined contests open nominations so participants can add entries.

create or replace function public.unlock_contest_from_billing(
  p_contest_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
  v_status text;
  v_source text;
  v_nomination_kind text;
  v_open_nominations boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select
    host_user_id,
    status,
    candidate_source,
    coalesce(nomination_kind, 'standard')
  into v_host, v_status, v_source, v_nomination_kind
  from public.contests
  where id = p_contest_id;

  if v_host is null then
    raise exception 'CONTEST_NOT_FOUND';
  end if;

  if v_host is distinct from p_user_id then
    raise exception 'NOT_HOST';
  end if;

  -- Match createContestAction: curated (non-birthday) is seeded at create —
  -- do not dump the host on an empty Nominate tab after Polar returns.
  v_open_nominations := not (
    v_source = 'curated'
    and v_nomination_kind is distinct from 'birthday'
  );

  update public.contests
  set
    unlocked_at = coalesce(unlocked_at, now()),
    status = case when status = 'payment_pending' then 'open' else status end,
    nominations_open = case
      when status = 'payment_pending' then v_open_nominations
      else nominations_open
    end,
    max_members = null,
    expires_at = null
  where id = p_contest_id;

  return jsonb_build_object('ok', true, 'contest_id', p_contest_id);
end;
$$;

revoke all on function public.unlock_contest_from_billing(uuid, uuid) from public;
grant execute on function public.unlock_contest_from_billing(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
