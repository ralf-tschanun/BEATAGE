-- Remember whether a Plus/Pro subscription bills monthly or yearly.
-- Free plans keep this null. Webhook sync writes it; the app can backfill from Polar.

alter table public.beatage_profiles
  add column if not exists billing_interval text;

alter table public.beatage_profiles
  drop constraint if exists beatage_profiles_billing_interval_check;

alter table public.beatage_profiles
  add constraint beatage_profiles_billing_interval_check
  check (billing_interval is null or billing_interval in ('monthly', 'yearly'));

comment on column public.beatage_profiles.billing_interval is
  'Active Polar subscription cadence for plus/pro: monthly or yearly. Null on free.';

drop function if exists public.beatage_apply_billing_plan(uuid, text, text);

create or replace function public.beatage_apply_billing_plan(
  p_user_id uuid,
  p_plan text,
  p_polar_customer_id text default null,
  p_billing_interval text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text := lower(trim(coalesce(p_plan, '')));
  v_interval text := lower(trim(coalesce(p_billing_interval, '')));
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

  if v_interval <> '' and v_interval not in ('monthly', 'yearly') then
    raise exception 'INVALID_BILLING_INTERVAL';
  end if;

  insert into public.beatage_profiles (id, plan, polar_customer_id, billing_interval)
  values (
    p_user_id,
    v_plan,
    nullif(trim(coalesce(p_polar_customer_id, '')), ''),
    case
      when v_plan = 'free' or v_interval = '' then null
      else v_interval
    end
  )
  on conflict (id) do update
  set
    plan = excluded.plan,
    polar_customer_id = coalesce(excluded.polar_customer_id, public.beatage_profiles.polar_customer_id),
    billing_interval = case
      when excluded.plan = 'free' then null
      when excluded.billing_interval is not null then excluded.billing_interval
      else public.beatage_profiles.billing_interval
    end,
    updated_at = now();

  select * into v_limits from public.beatage_plan_limits(v_plan);

  update public.beatage_quizzes
  set
    max_members = v_limits.max_members,
    max_rounds = v_limits.max_curated_tracks,
    expires_at = case
      when v_limits.inactivity_expiry_days is null then null
      else greatest(coalesce(last_activity_at, now()), now())
        + make_interval(days => v_limits.inactivity_expiry_days)
    end
  where host_user_id = p_user_id
    and unlocked_at is null
    and status in ('draft', 'open', 'playing', 'finished');

  return jsonb_build_object(
    'ok', true,
    'plan', v_plan,
    'billing_interval', case when v_plan = 'free' or v_interval = '' then null else v_interval end
  );
end;
$$;

revoke all on function public.beatage_apply_billing_plan(uuid, text, text, text) from public;
grant execute on function public.beatage_apply_billing_plan(uuid, text, text, text) to service_role;
