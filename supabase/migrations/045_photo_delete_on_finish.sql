-- Opt-out: delete nominated photos when the contest finishes
-- Paste into the Supabase SQL editor

alter table public.candidates
  add column if not exists delete_photo_on_finish boolean not null default false;

-- Clear opted-out photo URLs (image disappears from the contest forever).
-- Stores the old URL in meta so the app can remove the Storage object.
create or replace function public.clear_opt_out_contest_photos(p_contest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.candidates
  set
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'storage_delete_url', url,
      'photo_cleared_at', to_jsonb(now()::text)
    ),
    url = null
  where contest_id = p_contest_id
    and delete_photo_on_finish = true
    and url is not null
    and length(trim(url)) > 0;
end;
$$;

revoke all on function public.clear_opt_out_contest_photos(uuid) from public;
grant execute on function public.clear_opt_out_contest_photos(uuid) to authenticated;

-- Host (or service) ack after Storage delete
create or replace function public.ack_contest_photo_storage_deleted(
  p_contest_id uuid,
  p_candidate_ids uuid[]
)
returns void
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

  select * into v_contest from public.contests where id = p_contest_id;
  if not found then
    raise exception 'CONTEST_NOT_FOUND';
  end if;
  if v_contest.host_user_id <> v_uid then
    raise exception 'NOT_HOST';
  end if;

  update public.candidates
  set meta = (coalesce(meta, '{}'::jsonb) - 'storage_delete_url')
    || jsonb_build_object('photo_storage_deleted', true)
  where contest_id = p_contest_id
    and id = any (p_candidate_ids);
end;
$$;

revoke all on function public.ack_contest_photo_storage_deleted(uuid, uuid[]) from public;
grant execute on function public.ack_contest_photo_storage_deleted(uuid, uuid[]) to authenticated;

create or replace function public.close_voting(p_contest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_phase text := 'candidates';
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

  if v_contest.status = 'finished' then
    perform public.clear_opt_out_contest_photos(p_contest_id);
    return jsonb_build_object(
      'ok', true,
      'status', 'finished',
      'results_reveal', v_contest.results_reveal,
      'results_reveal_step', v_contest.results_reveal_step,
      'results_phase', v_contest.results_phase
    );
  end if;

  if v_contest.status <> 'voting' then
    raise exception 'VOTING_NOT_OPEN';
  end if;

  if v_contest.nominator_ranking and v_contest.nominator_ranking_when = 'before' then
    v_phase := 'nominators';
  else
    v_phase := 'candidates';
  end if;

  update public.contests
  set
    status = 'finished',
    voting_open = false,
    nominations_open = false,
    results_reveal_step = 0,
    nominator_reveal_step = 0,
    results_phase = v_phase,
    last_activity_at = now()
  where id = p_contest_id
  returning * into v_contest;

  perform public.clear_opt_out_contest_photos(p_contest_id);

  return jsonb_build_object(
    'ok', true,
    'status', v_contest.status,
    'voting_open', v_contest.voting_open,
    'results_reveal', v_contest.results_reveal,
    'results_reveal_step', v_contest.results_reveal_step,
    'results_phase', v_contest.results_phase,
    'nominator_reveal_step', v_contest.nominator_reveal_step
  );
end;
$$;

revoke all on function public.close_voting(uuid) from public;
grant execute on function public.close_voting(uuid) to authenticated;

create or replace function public.maybe_auto_close_voting(p_contest_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contest public.contests%rowtype;
  v_phase text := 'candidates';
begin
  select * into v_contest
  from public.contests
  where id = p_contest_id
  for update;

  if not found then
    return false;
  end if;

  if v_contest.status = 'finished' then
    return false;
  end if;

  if v_contest.voting_close_mode = 'scheduled'
     and v_contest.voting_closes_at is not null
     and v_contest.voting_closes_at <= now()
     and v_contest.status = 'voting'
     and v_contest.voting_open
  then
    if v_contest.nominator_ranking and v_contest.nominator_ranking_when = 'before' then
      v_phase := 'nominators';
    else
      v_phase := 'candidates';
    end if;

    update public.contests
    set
      status = 'finished',
      voting_open = false,
      nominations_open = false,
      results_reveal_step = 0,
      nominator_reveal_step = 0,
      results_phase = v_phase,
      last_activity_at = now()
    where id = p_contest_id;

    perform public.clear_opt_out_contest_photos(p_contest_id);
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.maybe_auto_close_voting(uuid) from public;
grant execute on function public.maybe_auto_close_voting(uuid) to authenticated;

-- Nominate / update with delete-on-finish flag
drop function if exists public.nominate_candidate(uuid, text, text, text, text);

create or replace function public.nominate_candidate(
  p_contest_id uuid,
  p_title text,
  p_url text default null,
  p_description text default null,
  p_artist text default null,
  p_delete_photo_on_finish boolean default false
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
  v_count integer;
  v_total integer;
  v_status text;
  v_candidate public.candidates%rowtype;
  v_title text := trim(coalesce(p_title, ''));
  v_artist text := nullif(trim(coalesce(p_artist, '')), '');
  v_url text := nullif(trim(coalesce(p_url, '')), '');
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_is_curated boolean;
  v_theme text;
  v_delete_photo boolean := coalesce(p_delete_photo_on_finish, false);
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if char_length(v_title) < 1 then
    raise exception 'TITLE_REQUIRED';
  end if;

  select * into v_contest from public.contests where id = p_contest_id for update;
  if not found then
    raise exception 'CONTEST_NOT_FOUND';
  end if;

  v_theme := coalesce(v_contest.theme, 'generic');
  if v_theme <> 'photo' then
    v_delete_photo := false;
  end if;

  if not v_contest.nominations_open or v_contest.status not in ('open', 'voting') then
    raise exception 'NOMINATIONS_CLOSED';
  end if;

  if v_contest.nomination_deadline is not null and v_contest.nomination_deadline < now() then
    raise exception 'NOMINATION_DEADLINE_PASSED';
  end if;

  if v_contest.candidate_source not in ('user_single', 'user_multiple', 'curated') then
    raise exception 'NOMINATIONS_NOT_ALLOWED';
  end if;

  v_is_curated := v_contest.candidate_source = 'curated';

  if v_theme = 'song' then
    if v_artist is null then
      raise exception 'ARTIST_REQUIRED';
    end if;
    v_description := null;
  end if;

  if v_theme = 'photo' then
    v_artist := null;
    v_description := null;
    if v_url is null then
      raise exception 'TITLE_REQUIRED';
    end if;
  end if;

  select * into v_member
  from public.contest_members
  where contest_id = p_contest_id and user_id = v_uid;

  if not found then
    raise exception 'NOT_A_MEMBER';
  end if;

  if v_is_curated then
    if v_contest.host_user_id <> v_uid or v_member.role <> 'host' then
      raise exception 'CURATED_HOST_ONLY';
    end if;
  else
    if v_member.role = 'host' and coalesce(v_contest.host_participates, true) = false then
      raise exception 'HOST_NOT_PARTICIPATING';
    end if;
  end if;

  if v_is_curated then
    select count(*)::integer into v_total
    from public.candidates
    where contest_id = p_contest_id
      and status <> 'withdrawn';

    if v_contest.max_candidates is not null
       and v_total >= v_contest.max_candidates then
      raise exception 'CANDIDATE_LIMIT';
    end if;
  else
    select count(*)::integer into v_count
    from public.candidates
    where contest_id = p_contest_id
      and nominator_user_id = v_uid
      and status <> 'withdrawn';

    if v_contest.max_nominations_per_participant is not null
       and v_count >= v_contest.max_nominations_per_participant then
      raise exception 'NOMINATION_LIMIT';
    end if;
  end if;

  if not v_contest.allow_duplicate_candidates then
    if v_theme = 'song' then
      if exists (
        select 1 from public.candidates
        where contest_id = p_contest_id
          and status <> 'withdrawn'
          and lower(trim(title)) = lower(v_title)
          and lower(trim(coalesce(artist, ''))) = lower(v_artist)
      ) then
        raise exception 'DUPLICATE_CANDIDATE';
      end if;
    elsif v_theme = 'photo' then
      if exists (
        select 1 from public.candidates
        where contest_id = p_contest_id
          and status <> 'withdrawn'
          and url is not null
          and url = v_url
      ) then
        raise exception 'DUPLICATE_CANDIDATE';
      end if;
    else
      if exists (
        select 1 from public.candidates
        where contest_id = p_contest_id
          and status <> 'withdrawn'
          and lower(trim(title)) = lower(v_title)
      ) then
        raise exception 'DUPLICATE_CANDIDATE';
      end if;
    end if;
  end if;

  v_status := case
    when v_contest.candidate_reveal = 'live' then 'visible'
    else 'pending'
  end;

  insert into public.candidates (
    contest_id, nominator_user_id, title, artist, url, description, status,
    delete_photo_on_finish
  )
  values (
    p_contest_id,
    v_uid,
    v_title,
    v_artist,
    v_url,
    v_description,
    v_status,
    v_delete_photo
  )
  returning * into v_candidate;

  if coalesce(v_contest.candidate_sort, 'nominated_at') = 'random' then
    perform public.reshuffle_contest_candidates(p_contest_id);
    select * into v_candidate from public.candidates where id = v_candidate.id;
  else
    update public.contests
    set last_activity_at = now()
    where id = p_contest_id;
  end if;

  return jsonb_build_object(
    'id', v_candidate.id,
    'title', v_candidate.title,
    'artist', v_candidate.artist,
    'status', v_candidate.status,
    'display_order', v_candidate.display_order
  );
end;
$$;

revoke all on function public.nominate_candidate(uuid, text, text, text, text, boolean) from public;
grant execute on function public.nominate_candidate(uuid, text, text, text, text, boolean) to authenticated;

drop function if exists public.update_candidate(uuid, text, text, text, text);

create or replace function public.update_candidate(
  p_candidate_id uuid,
  p_title text,
  p_url text default null,
  p_description text default null,
  p_artist text default null,
  p_delete_photo_on_finish boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_candidate public.candidates%rowtype;
  v_contest public.contests%rowtype;
  v_title text := trim(coalesce(p_title, ''));
  v_artist text := nullif(trim(coalesce(p_artist, '')), '');
  v_url text := nullif(trim(coalesce(p_url, '')), '');
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_theme text;
  v_delete_photo boolean;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if char_length(v_title) < 1 then
    raise exception 'TITLE_REQUIRED';
  end if;

  select * into v_candidate
  from public.candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'CANDIDATE_NOT_FOUND';
  end if;

  if v_candidate.status = 'withdrawn' then
    raise exception 'CANDIDATE_WITHDRAWN';
  end if;

  if v_candidate.nominator_user_id is distinct from v_uid then
    raise exception 'NOT_OWNER';
  end if;

  select * into v_contest
  from public.contests
  where id = v_candidate.contest_id
  for update;

  if not found then
    raise exception 'CONTEST_NOT_FOUND';
  end if;

  v_theme := coalesce(v_contest.theme, 'generic');
  v_delete_photo := case
    when v_theme <> 'photo' then false
    when p_delete_photo_on_finish is null then v_candidate.delete_photo_on_finish
    else p_delete_photo_on_finish
  end;

  if not v_contest.nominations_open or v_contest.status not in ('open', 'voting') then
    raise exception 'NOMINATIONS_CLOSED';
  end if;

  if v_contest.nomination_deadline is not null and v_contest.nomination_deadline < now() then
    raise exception 'NOMINATION_DEADLINE_PASSED';
  end if;

  if v_theme = 'song' then
    if v_artist is null then
      raise exception 'ARTIST_REQUIRED';
    end if;
    v_description := null;
  end if;

  if v_theme = 'photo' then
    v_artist := null;
    v_description := null;
    if v_url is null then
      raise exception 'TITLE_REQUIRED';
    end if;
  end if;

  if not v_contest.allow_duplicate_candidates then
    if v_theme = 'song' then
      if exists (
        select 1 from public.candidates
        where contest_id = v_contest.id
          and id <> p_candidate_id
          and status <> 'withdrawn'
          and lower(trim(title)) = lower(v_title)
          and lower(trim(coalesce(artist, ''))) = lower(v_artist)
      ) then
        raise exception 'DUPLICATE_CANDIDATE';
      end if;
    elsif v_theme = 'photo' then
      if exists (
        select 1 from public.candidates
        where contest_id = v_contest.id
          and id <> p_candidate_id
          and status <> 'withdrawn'
          and url is not null
          and url = v_url
      ) then
        raise exception 'DUPLICATE_CANDIDATE';
      end if;
    else
      if exists (
        select 1 from public.candidates
        where contest_id = v_contest.id
          and id <> p_candidate_id
          and status <> 'withdrawn'
          and lower(trim(title)) = lower(v_title)
      ) then
        raise exception 'DUPLICATE_CANDIDATE';
      end if;
    end if;
  end if;

  update public.candidates
  set
    title = v_title,
    artist = v_artist,
    url = v_url,
    description = v_description,
    delete_photo_on_finish = v_delete_photo
  where id = p_candidate_id
  returning * into v_candidate;

  update public.contests
  set last_activity_at = now()
  where id = v_contest.id;

  return jsonb_build_object(
    'id', v_candidate.id,
    'title', v_candidate.title,
    'artist', v_candidate.artist,
    'status', v_candidate.status
  );
end;
$$;

revoke all on function public.update_candidate(uuid, text, text, text, text, boolean) from public;
grant execute on function public.update_candidate(uuid, text, text, text, text, boolean) to authenticated;

-- Host may delete any object under their contest folder (for finish purge)
drop policy if exists "contest_photos_host_delete" on storage.objects;
create policy "contest_photos_host_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'contest-photos'
    and exists (
      select 1
      from public.contests c
      where c.id::text = (storage.foldername(name))[1]
        and c.host_user_id = auth.uid()
    )
  );
