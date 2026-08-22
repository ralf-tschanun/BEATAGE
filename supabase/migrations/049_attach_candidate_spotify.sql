-- Attach Spotify track metadata to a candidate (host or nominator).
-- Paste into the Supabase SQL editor.

create or replace function public.attach_candidate_spotify(
  p_candidate_id uuid,
  p_spotify_url text,
  p_spotify_id text default null,
  p_spotify_uri text default null
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
  v_url text := nullif(trim(coalesce(p_spotify_url, '')), '');
  v_id text := nullif(trim(coalesce(p_spotify_id, '')), '');
  v_uri text := nullif(trim(coalesce(p_spotify_uri, '')), '');
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if v_url is null then
    raise exception 'SPOTIFY_URL_REQUIRED';
  end if;

  select * into v_candidate
  from public.candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'CANDIDATE_NOT_FOUND';
  end if;

  select * into v_contest
  from public.contests
  where id = v_candidate.contest_id;

  if not found then
    raise exception 'CONTEST_NOT_FOUND';
  end if;

  if v_contest.host_user_id <> v_uid
     and v_candidate.nominator_user_id is distinct from v_uid then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.candidates
  set
    meta = coalesce(meta, '{}'::jsonb) || jsonb_strip_nulls(
      jsonb_build_object(
        'spotify_url', v_url,
        'spotify_id', v_id,
        'spotify_uri', v_uri
      )
    )
  where id = p_candidate_id
  returning * into v_candidate;

  return jsonb_build_object(
    'ok', true,
    'id', v_candidate.id,
    'spotify_url', v_url,
    'spotify_id', v_id
  );
end;
$$;

revoke all on function public.attach_candidate_spotify(uuid, text, text, text) from public;
grant execute on function public.attach_candidate_spotify(uuid, text, text, text) to authenticated;
