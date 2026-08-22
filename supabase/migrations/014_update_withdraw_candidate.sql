-- Update / withdraw candidates while nominations are open
-- Paste ONLY this SQL into the Supabase SQL editor

create or replace function public.update_candidate(
  p_candidate_id uuid,
  p_title text,
  p_url text default null,
  p_description text default null,
  p_artist text default null
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

  if not v_contest.nominations_open or v_contest.status not in ('open', 'voting') then
    raise exception 'NOMINATIONS_CLOSED';
  end if;

  if v_contest.nomination_deadline is not null and v_contest.nomination_deadline < now() then
    raise exception 'NOMINATION_DEADLINE_PASSED';
  end if;

  if coalesce(v_contest.theme, 'generic') = 'song' then
    if v_artist is null then
      raise exception 'ARTIST_REQUIRED';
    end if;
    v_description := null;
  end if;

  if not v_contest.allow_duplicate_candidates then
    if coalesce(v_contest.theme, 'generic') = 'song' then
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
    description = v_description
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

revoke all on function public.update_candidate(uuid, text, text, text, text) from public;
grant execute on function public.update_candidate(uuid, text, text, text, text) to authenticated;

create or replace function public.withdraw_candidate(
  p_candidate_id uuid
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
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_candidate
  from public.candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'CANDIDATE_NOT_FOUND';
  end if;

  if v_candidate.status = 'withdrawn' then
    return jsonb_build_object('ok', true, 'id', v_candidate.id, 'status', 'withdrawn');
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

  if not v_contest.nominations_open or v_contest.status not in ('open', 'voting') then
    raise exception 'NOMINATIONS_CLOSED';
  end if;

  if v_contest.nomination_deadline is not null and v_contest.nomination_deadline < now() then
    raise exception 'NOMINATION_DEADLINE_PASSED';
  end if;

  update public.candidates
  set status = 'withdrawn'
  where id = p_candidate_id
  returning * into v_candidate;

  update public.contests
  set last_activity_at = now()
  where id = v_contest.id;

  return jsonb_build_object(
    'ok', true,
    'id', v_candidate.id,
    'status', v_candidate.status
  );
end;
$$;

revoke all on function public.withdraw_candidate(uuid) from public;
grant execute on function public.withdraw_candidate(uuid) to authenticated;
