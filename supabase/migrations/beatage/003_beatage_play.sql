-- BEATAGE Phase 8b: curated tracks + round play RPCs

create or replace function public.beatage_is_quiz_host(p_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.beatage_quizzes q
    where q.id = p_quiz_id
      and q.host_user_id = auth.uid()
  );
$$;

create or replace function public.beatage_is_quiz_member(p_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.beatage_quiz_members m
    where m.quiz_id = p_quiz_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.add_beatage_curated_track(
  p_quiz_id uuid,
  p_track_name text,
  p_artist_name text,
  p_spotify_track_id text default null,
  p_album_art_url text default null,
  p_preview_url text default null,
  p_release_year integer default null,
  p_original_release_year integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sort integer;
  v_row public.beatage_curated_tracks%rowtype;
begin
  if not public.beatage_is_quiz_host(p_quiz_id) then
    raise exception 'NOT_HOST';
  end if;

  if char_length(trim(coalesce(p_track_name, ''))) < 1 then
    raise exception 'TRACK_NAME_REQUIRED';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_sort
  from public.beatage_curated_tracks
  where quiz_id = p_quiz_id;

  insert into public.beatage_curated_tracks (
    quiz_id,
    sort_order,
    spotify_track_id,
    track_name,
    artist_name,
    album_art_url,
    preview_url,
    release_year,
    original_release_year
  )
  values (
    p_quiz_id,
    v_sort,
    nullif(trim(coalesce(p_spotify_track_id, '')), ''),
    trim(p_track_name),
    nullif(trim(coalesce(p_artist_name, '')), ''),
    nullif(trim(coalesce(p_album_art_url, '')), ''),
    nullif(trim(coalesce(p_preview_url, '')), ''),
    p_release_year,
    coalesce(p_original_release_year, p_release_year)
  )
  returning * into v_row;

  update public.beatage_quizzes
  set last_activity_at = now()
  where id = p_quiz_id;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.add_beatage_curated_track(uuid, text, text, text, text, text, integer, integer) from public;
grant execute on function public.add_beatage_curated_track(uuid, text, text, text, text, text, integer, integer) to authenticated;

create or replace function public.start_beatage_round(
  p_quiz_id uuid,
  p_curated_track_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz public.beatage_quizzes%rowtype;
  v_track public.beatage_curated_tracks%rowtype;
  v_round public.beatage_rounds%rowtype;
  v_round_number integer;
  v_active uuid;
begin
  if not public.beatage_is_quiz_host(p_quiz_id) then
    raise exception 'NOT_HOST';
  end if;

  select * into v_quiz from public.beatage_quizzes where id = p_quiz_id;
  if not found then
    raise exception 'QUIZ_NOT_FOUND';
  end if;

  select id into v_active
  from public.beatage_rounds
  where quiz_id = p_quiz_id and status = 'active'
  limit 1;

  if v_active is not null then
    raise exception 'ROUND_ALREADY_ACTIVE';
  end if;

  if p_curated_track_id is not null then
    select * into v_track
    from public.beatage_curated_tracks
    where id = p_curated_track_id and quiz_id = p_quiz_id;
    if not found then
      raise exception 'TRACK_NOT_FOUND';
    end if;
  else
    select * into v_track
    from public.beatage_curated_tracks
    where quiz_id = p_quiz_id
    order by sort_order asc
    offset v_quiz.current_round_number
    limit 1;
    if not found then
      raise exception 'NO_TRACK_AVAILABLE';
    end if;
  end if;

  v_round_number := v_quiz.current_round_number + 1;

  insert into public.beatage_rounds (
    quiz_id,
    round_number,
    status,
    spotify_track_id,
    track_name,
    artist_name,
    album_art_url,
    preview_url,
    correct_release_year,
    original_release_year,
    started_at,
    guess_opens_at,
    host_confirmed_at
  )
  values (
    p_quiz_id,
    v_round_number,
    'active',
    v_track.spotify_track_id,
    v_track.track_name,
    v_track.artist_name,
    v_track.album_art_url,
    v_track.preview_url,
    v_track.release_year,
    v_track.original_release_year,
    now(),
    now(),
    now()
  )
  returning * into v_round;

  update public.beatage_quizzes
  set
    status = 'playing',
    current_round_number = v_round_number,
    last_activity_at = now()
  where id = p_quiz_id;

  return to_jsonb(v_round);
end;
$$;

revoke all on function public.start_beatage_round(uuid, uuid) from public;
grant execute on function public.start_beatage_round(uuid, uuid) to authenticated;

create or replace function public.submit_beatage_guess(
  p_round_id uuid,
  p_guessed_year integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.beatage_rounds%rowtype;
  v_row public.beatage_guesses%rowtype;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_round from public.beatage_rounds where id = p_round_id;
  if not found then
    raise exception 'ROUND_NOT_FOUND';
  end if;

  if not public.beatage_is_quiz_member(v_round.quiz_id) then
    raise exception 'NOT_MEMBER';
  end if;

  if v_round.status <> 'active' then
    raise exception 'ROUND_NOT_ACTIVE';
  end if;

  if p_guessed_year is null or p_guessed_year < 1900 or p_guessed_year > 2100 then
    raise exception 'INVALID_YEAR';
  end if;

  insert into public.beatage_guesses (round_id, user_id, guessed_year)
  values (p_round_id, auth.uid(), p_guessed_year)
  on conflict (round_id, user_id) do update
  set
    guessed_year = excluded.guessed_year,
    submitted_at = now()
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.submit_beatage_guess(uuid, integer) from public;
grant execute on function public.submit_beatage_guess(uuid, integer) to authenticated;

create or replace function public.close_beatage_round(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.beatage_rounds%rowtype;
  v_correct integer;
begin
  select * into v_round from public.beatage_rounds where id = p_round_id;
  if not found then
    raise exception 'ROUND_NOT_FOUND';
  end if;

  if not public.beatage_is_quiz_host(v_round.quiz_id) then
    raise exception 'NOT_HOST';
  end if;

  if v_round.status <> 'active' then
    raise exception 'ROUND_NOT_ACTIVE';
  end if;

  v_correct := v_round.correct_release_year;

  update public.beatage_guesses g
  set
    points = case
      when v_correct is not null and g.guessed_year = v_correct then 1
      else 0
    end,
    points_total = case
      when v_correct is not null and g.guessed_year = v_correct then 1
      else 0
    end,
    points_breakdown = jsonb_build_object(
      'year_exact', case
        when v_correct is not null and g.guessed_year = v_correct then 1
        else 0
      end
    )
  where g.round_id = p_round_id;

  update public.beatage_rounds
  set
    status = 'revealed',
    revealed_at = now(),
    guess_closes_at = now()
  where id = p_round_id;

  update public.beatage_quizzes
  set last_activity_at = now()
  where id = v_round.quiz_id;

  return jsonb_build_object(
    'round_id', p_round_id,
    'correct_release_year', v_correct,
    'original_release_year', v_round.original_release_year
  );
end;
$$;

revoke all on function public.close_beatage_round(uuid) from public;
grant execute on function public.close_beatage_round(uuid) to authenticated;

-- 002 already created beatage_curated_tracks_select_member — only add missing policies.
drop policy if exists beatage_curated_tracks_insert_host on public.beatage_curated_tracks;
create policy beatage_curated_tracks_insert_host on public.beatage_curated_tracks
  for insert to authenticated
  with check (
    exists (
      select 1 from public.beatage_quizzes q
      where q.id = beatage_curated_tracks.quiz_id
        and q.host_user_id = auth.uid()
    )
  );

drop policy if exists beatage_rounds_update_host on public.beatage_rounds;
create policy beatage_rounds_update_host on public.beatage_rounds
  for update to authenticated
  using (
    exists (
      select 1 from public.beatage_quizzes q
      where q.id = beatage_rounds.quiz_id and q.host_user_id = auth.uid()
    )
  );
