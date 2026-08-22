-- Combined contests: participating hosts nominate like other participants.
-- Curated host adds use p_as_curated (or admin-only host). Seeded entries are marked curated.
-- Paste ONLY this SQL into the Supabase SQL editor.

drop function if exists public.nominate_candidate(uuid, text, text, text, text, boolean, uuid);

create or replace function public.nominate_candidate(
  p_contest_id uuid,
  p_title text,
  p_url text default null,
  p_description text default null,
  p_artist text default null,
  p_delete_photo_on_finish boolean default false,
  p_question_id uuid default null,
  p_as_curated boolean default false
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
  v_curated_count integer;
  v_status text;
  v_candidate public.candidates%rowtype;
  v_title text := trim(coalesce(p_title, ''));
  v_artist text := nullif(trim(coalesce(p_artist, '')), '');
  v_url text := nullif(trim(coalesce(p_url, '')), '');
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_source text;
  v_is_host_curated boolean := false;
  v_theme text;
  v_delete_photo boolean := coalesce(p_delete_photo_on_finish, false);
  v_question_id uuid := p_question_id;
  v_origin text := 'user';
  v_meta jsonb := '{}'::jsonb;
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
  v_source := coalesce(v_contest.candidate_source, 'user_single');

  if v_theme <> 'photo' then
    v_delete_photo := false;
  end if;

  if v_theme <> 'generic' then
    v_question_id := null;
  elsif v_question_id is not null then
    if not exists (
      select 1 from public.contest_questions q
      where q.id = v_question_id and q.contest_id = p_contest_id
    ) then
      raise exception 'INVALID_SETTINGS';
    end if;
  end if;

  if not v_contest.nominations_open or v_contest.status not in ('open', 'voting') then
    raise exception 'NOMINATIONS_CLOSED';
  end if;

  if v_contest.nomination_deadline is not null and v_contest.nomination_deadline < now() then
    raise exception 'NOMINATION_DEADLINE_PASSED';
  end if;

  if v_source not in ('user_single', 'user_multiple', 'curated', 'combined') then
    raise exception 'NOMINATIONS_NOT_ALLOWED';
  end if;

  -- Curated contests: host always adds curated entries.
  -- Combined: curated only when explicitly requested, or host is admin-only.
  -- Participating hosts in combined nominate like everyone else.
  if v_source = 'curated' then
    v_is_host_curated := true;
  elsif v_source = 'combined' and v_contest.host_user_id = v_uid then
    if coalesce(p_as_curated, false)
       or coalesce(v_contest.host_participates, true) = false then
      v_is_host_curated := true;
    end if;
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

  select * into v_member
  from public.contest_members
  where contest_id = p_contest_id and user_id = v_uid;

  if not found then
    raise exception 'NOT_A_MEMBER';
  end if;

  if v_is_host_curated then
    if v_contest.host_user_id <> v_uid or v_member.role <> 'host' then
      raise exception 'CURATED_HOST_ONLY';
    end if;
  else
    if v_member.role = 'host' and coalesce(v_contest.host_participates, true) = false then
      raise exception 'HOST_NOT_PARTICIPATING';
    end if;
  end if;

  if v_is_host_curated then
    v_origin := 'curated';
    select count(*)::integer into v_curated_count
    from public.candidates
    where contest_id = p_contest_id
      and status <> 'withdrawn'
      and (
        coalesce(meta->>'nomination_origin', '') = 'curated'
        or v_source = 'curated'
        or (
          v_source = 'combined'
          and nominator_user_id = v_contest.host_user_id
          and coalesce(meta->>'nomination_origin', 'curated') = 'curated'
        )
      );

    if v_contest.max_candidates is not null
       and v_curated_count >= v_contest.max_candidates then
      raise exception 'CANDIDATE_LIMIT';
    end if;
  else
    v_origin := 'user';
    select count(*)::integer into v_count
    from public.candidates
    where contest_id = p_contest_id
      and nominator_user_id = v_uid
      and status <> 'withdrawn'
      and case coalesce(meta->>'nomination_origin', '')
        when 'curated' then false
        when 'user' then true
        -- Legacy combined host seeds had no origin flag; treat as curated.
        else not (
          v_source = 'combined'
          and nominator_user_id = v_contest.host_user_id
        )
      end;

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
          and question_id is not distinct from v_question_id
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

  v_meta := jsonb_build_object('nomination_origin', v_origin);

  insert into public.candidates (
    contest_id, nominator_user_id, title, artist, url, description, status,
    delete_photo_on_finish, question_id, meta
  )
  values (
    p_contest_id,
    v_uid,
    v_title,
    v_artist,
    v_url,
    v_description,
    v_status,
    v_delete_photo,
    v_question_id,
    v_meta
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
    'display_order', v_candidate.display_order,
    'question_id', v_candidate.question_id
  );
end;
$$;

revoke all on function public.nominate_candidate(uuid, text, text, text, text, boolean, uuid, boolean) from public;
grant execute on function public.nominate_candidate(uuid, text, text, text, text, boolean, uuid, boolean) to authenticated;
