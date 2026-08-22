-- Polar billing: store customer id, contest unlocks, and apply plan from webhooks.

alter table public.profiles
  add column if not exists polar_customer_id text;

create unique index if not exists profiles_polar_customer_id_uidx
  on public.profiles (polar_customer_id)
  where polar_customer_id is not null;

alter table public.contests
  add column if not exists unlocked_at timestamptz;

create or replace function public.apply_billing_plan(
  p_user_id uuid,
  p_plan text,
  p_polar_customer_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text := lower(trim(coalesce(p_plan, '')));
  v_limits record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if v_plan not in ('free', 'plus', 'pro') then
    raise exception 'INVALID_PLAN';
  end if;

  insert into public.profiles (id, plan, polar_customer_id)
  values (p_user_id, v_plan, nullif(trim(coalesce(p_polar_customer_id, '')), ''))
  on conflict (id) do update
  set
    plan = excluded.plan,
    polar_customer_id = coalesce(excluded.polar_customer_id, public.profiles.polar_customer_id),
    updated_at = now();

  select * into v_limits from public.plan_limits(v_plan);

  -- Unlocked contests keep unlimited members / no expiry.
  update public.contests
  set
    mode = v_limits.mode,
    max_members = v_limits.max_members,
    expires_at = case
      when v_limits.inactivity_expiry_days is null then null
      else greatest(coalesce(last_activity_at, now()), now())
        + make_interval(days => v_limits.inactivity_expiry_days)
    end
  where host_user_id = p_user_id
    and unlocked_at is null
    and status in ('draft', 'open', 'voting', 'finished');

  return jsonb_build_object('ok', true, 'plan', v_plan);
end;
$$;

revoke all on function public.apply_billing_plan(uuid, text, text) from public;
grant execute on function public.apply_billing_plan(uuid, text, text) to service_role;

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
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select host_user_id into v_host
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
