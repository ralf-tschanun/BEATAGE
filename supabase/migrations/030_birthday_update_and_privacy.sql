-- Birthday nominations: allow update while nominations open;
-- chart hits stay pending until host reveal (participants never see songs early).
-- Paste ONLY this SQL into the Supabase SQL editor

-- Helper: unlink user from a candidate; withdraw if nobody else is linked
create or replace function public._birthday_detach_candidate(
  p_contest_id uuid,
  p_user_id uuid,
  p_old_candidate_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_old_candidate_id is null then
    return;
  end if;

  -- Clear link on this user's row first (caller may already have updated)
  if not exists (
    select 1
    from public.birthday_nominations
    where contest_id = p_contest_id
      and candidate_id = p_old_candidate_id
      and user_id <> p_user_id
  ) then
    update public.candidates
    set status = 'withdrawn'
    where id = p_old_candidate_id
      and contest_id = p_contest_id
      and status not in ('withdrawn', 'rejected');
  end if;
end;
$$;

revoke all on function public._birthday_detach_candidate(uuid, uuid, uuid) from public;

create or replace function public.register_birthday_no_match(
  p_contest_id uuid,
  p_birthday date,
  p_show_birthday boolean
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
  v_existing public.birthday_nominations%rowtype;
  v_old_candidate_id uuid;
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

  if v_contest.nomination_kind <> 'birthday' then
    raise exception 'NOT_BIRTHDAY_CONTEST';
  end if;

  if not v_contest.nominations_open then
    raise exception 'NOMINATIONS_CLOSED';
  end if;

  if v_contest.nomination_deadline is not null
     and v_contest.nomination_deadline < now() then
    raise exception 'NOMINATION_DEADLINE_PASSED';
  end if;

  select * into v_member
  from public.contest_members
  where contest_id = p_contest_id and user_id = v_uid;

  if not found then
    raise exception 'NOT_MEMBER';
  end if;

  if v_member.role = 'host' and v_contest.host_participates is false then
    raise exception 'HOST_ADMIN_ONLY';
  end if;

  select * into v_existing
  from public.birthday_nominations
  where contest_id = p_contest_id and user_id = v_uid;

  if found then
    v_old_candidate_id := v_existing.candidate_id;

    update public.birthday_nominations
    set
      birthday = p_birthday,
      show_birthday = coalesce(p_show_birthday, false),
      candidate_id = null,
      chart_date = null,
      chart_country = coalesce(v_contest.chart_country, 'US')
    where id = v_existing.id;

    perform public._birthday_detach_candidate(
      p_contest_id, v_uid, v_old_candidate_id
    );

    return jsonb_build_object('ok', true, 'matched', false, 'updated', true);
  end if;

  insert into public.birthday_nominations (
    contest_id, user_id, birthday, show_birthday, candidate_id, chart_country
  ) values (
    p_contest_id, v_uid, p_birthday, coalesce(p_show_birthday, false), null,
    coalesce(v_contest.chart_country, 'US')
  );

  return jsonb_build_object('ok', true, 'matched', false, 'updated', false);
end;
$$;

revoke all on function public.register_birthday_no_match(uuid, date, boolean) from public;
grant execute on function public.register_birthday_no_match(uuid, date, boolean) to authenticated;

create or replace function public.nominate_birthday_hit(
  p_contest_id uuid,
  p_birthday date,
  p_show_birthday boolean,
  p_title text,
  p_artist text,
  p_url text,
  p_chart_key text,
  p_chart_date date
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
  v_candidate public.candidates%rowtype;
  v_existing public.birthday_nominations%rowtype;
  v_old_candidate_id uuid;
  v_status text;
  v_updated boolean := false;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if char_length(trim(coalesce(p_title, ''))) < 1
     or char_length(trim(coalesce(p_artist, ''))) < 1
     or char_length(trim(coalesce(p_chart_key, ''))) < 1 then
    raise exception 'INVALID_SETTINGS';
  end if;

  select * into v_contest
  from public.contests
  where id = p_contest_id
  for update;

  if not found then
    raise exception 'CONTEST_NOT_FOUND';
  end if;

  if v_contest.nomination_kind <> 'birthday' then
    raise exception 'NOT_BIRTHDAY_CONTEST';
  end if;

  if v_contest.theme <> 'song' then
    raise exception 'INVALID_SETTINGS';
  end if;

  if not v_contest.nominations_open then
    raise exception 'NOMINATIONS_CLOSED';
  end if;

  if v_contest.nomination_deadline is not null
     and v_contest.nomination_deadline < now() then
    raise exception 'NOMINATION_DEADLINE_PASSED';
  end if;

  select * into v_member
  from public.contest_members
  where contest_id = p_contest_id and user_id = v_uid;

  if not found then
    raise exception 'NOT_MEMBER';
  end if;

  if v_member.role = 'host' and v_contest.host_participates is false then
    raise exception 'HOST_ADMIN_ONLY';
  end if;

  select * into v_existing
  from public.birthday_nominations
  where contest_id = p_contest_id and user_id = v_uid;

  if found then
    v_updated := true;
    v_old_candidate_id := v_existing.candidate_id;
  end if;

  -- Birthday hits stay hidden until the host reveals them
  select * into v_candidate
  from public.candidates
  where contest_id = p_contest_id
    and chart_key = p_chart_key
    and status <> 'withdrawn'
    and status <> 'rejected'
  limit 1;

  if not found then
    v_status := 'pending';

    insert into public.candidates (
      contest_id,
      nominator_user_id,
      title,
      artist,
      url,
      description,
      status,
      chart_key,
      chart_date
    ) values (
      p_contest_id,
      v_uid,
      trim(p_title),
      trim(p_artist),
      nullif(trim(coalesce(p_url, '')), ''),
      null,
      v_status,
      p_chart_key,
      p_chart_date
    )
    returning * into v_candidate;

    if v_contest.candidate_sort = 'random' then
      perform public.reshuffle_contest_candidates(p_contest_id);
    end if;
  end if;

  if v_updated then
    update public.birthday_nominations
    set
      birthday = p_birthday,
      show_birthday = coalesce(p_show_birthday, false),
      candidate_id = v_candidate.id,
      chart_date = p_chart_date,
      chart_country = coalesce(v_contest.chart_country, 'US')
    where id = v_existing.id;

    if v_old_candidate_id is distinct from v_candidate.id then
      perform public._birthday_detach_candidate(
        p_contest_id, v_uid, v_old_candidate_id
      );
    end if;
  else
    insert into public.birthday_nominations (
      contest_id, user_id, birthday, show_birthday, candidate_id,
      chart_country, chart_date
    ) values (
      p_contest_id, v_uid, p_birthday, coalesce(p_show_birthday, false),
      v_candidate.id, coalesce(v_contest.chart_country, 'US'), p_chart_date
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'matched', true,
    'updated', v_updated,
    'candidate_id', v_candidate.id
  );
end;
$$;

revoke all on function public.nominate_birthday_hit(uuid, date, boolean, text, text, text, text, date) from public;
grant execute on function public.nominate_birthday_hit(uuid, date, boolean, text, text, text, text, date) to authenticated;

-- Keep birthday chart hits host-revealed only
create or replace function public.enforce_birthday_contest_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.nomination_kind = 'birthday' then
    new.theme := 'song';
    new.candidate_source := 'user_single';
    new.max_nominations_per_participant := 1;
    new.max_candidates := null;
    new.allow_duplicate_candidates := true;
    new.candidate_reveal := 'admin_batch';
  end if;
  return new;
end;
$$;

drop trigger if exists contests_enforce_birthday_rules on public.contests;
create trigger contests_enforce_birthday_rules
  before insert or update on public.contests
  for each row
  execute function public.enforce_birthday_contest_rules();

update public.contests
set candidate_reveal = 'admin_batch'
where nomination_kind = 'birthday'
  and candidate_reveal is distinct from 'admin_batch';
