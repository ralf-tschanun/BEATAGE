-- After unlock-at-create payment: contest must be joinable/nominatable (open), not draft.

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
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select host_user_id, status into v_host, v_status
  from public.contests
  where id = p_contest_id;

  if v_host is null then
    raise exception 'CONTEST_NOT_FOUND';
  end if;

  if v_host is distinct from p_user_id then
    raise exception 'NOT_HOST';
  end if;

  update public.contests
  set
    unlocked_at = coalesce(unlocked_at, now()),
    -- payment_pending unlocks become open so host/participants can nominate immediately
    status = case when status = 'payment_pending' then 'open' else status end,
    nominations_open = case
      when status = 'payment_pending' then true
      else nominations_open
    end,
    max_members = null,
    expires_at = null,
    max_nominations_per_participant = null,
    max_candidates = null
  where id = p_contest_id;

  return jsonb_build_object('ok', true, 'contest_id', p_contest_id);
end;
$$;

revoke all on function public.unlock_contest_from_billing(uuid, uuid) from public;
grant execute on function public.unlock_contest_from_billing(uuid, uuid) to service_role;

-- Repair contests already unlocked into draft (cannot nominate while draft).
update public.contests
set
  status = 'open',
  nominations_open = true
where unlocked_at is not null
  and status = 'draft';
