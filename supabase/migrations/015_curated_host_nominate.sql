-- Curated contests: only the host may add candidates
-- Paste ONLY this SQL into the Supabase SQL editor

create or replace function public.nominate_candidate(
  p_contest_id uuid,
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

  if coalesce(v_contest.theme, 'generic') = 'song' then
    if v_artist is null then
      raise exception 'ARTIST_REQUIRED';
    end if;
    -- Song contests only store title + artist (+ optional preview).
    v_description := null;
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
    if coalesce(v_contest.theme, 'generic') = 'song' then
      if exists (
        select 1 from public.candidates
        where contest_id = p_contest_id
          and status <> 'withdrawn'
          and lower(trim(title)) = lower(v_title)
          and lower(trim(coalesce(artist, ''))) = lower(v_artist)
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
    contest_id, nominator_user_id, title, artist, url, description, status
  )
  values (
    p_contest_id,
    v_uid,
    v_title,
    v_artist,
    v_url,
    v_description,
    v_status
  )
  returning * into v_candidate;

  update public.contests
  set last_activity_at = now()
  where id = p_contest_id;

  return jsonb_build_object(
    'id', v_candidate.id,
    'title', v_candidate.title,
    'artist', v_candidate.artist,
    'status', v_candidate.status
  );
end;
$$;

revoke all on function public.nominate_candidate(uuid, text, text, text, text) from public;
grant execute on function public.nominate_candidate(uuid, text, text, text, text) to authenticated;
