-- Create wizard: combined source, Anything questions/candidates, anonymous results.
-- Paste into the Supabase SQL editor.

alter table public.contests
  add column if not exists results_anonymous boolean not null default false;

-- Allow combined candidate source
alter table public.contests
  drop constraint if exists contests_candidate_source_check;

alter table public.contests
  add constraint contests_candidate_source_check
  check (candidate_source in ('curated', 'user_single', 'user_multiple', 'combined', 'databased'));

create table if not exists public.contest_questions (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests(id) on delete cascade,
  sort_order integer not null default 0,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists contest_questions_contest_id_idx
  on public.contest_questions (contest_id);

create table if not exists public.contest_anything_candidates (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests(id) on delete cascade,
  question_id uuid not null references public.contest_questions(id) on delete cascade,
  sort_order integer not null default 0,
  label text not null,
  label_mode text not null default 'custom'
    check (label_mode in ('numeric', 'alpha_lower', 'alpha_upper', 'custom')),
  created_at timestamptz not null default now()
);

create index if not exists contest_anything_candidates_contest_id_idx
  on public.contest_anything_candidates (contest_id);

alter table public.contest_questions enable row level security;
alter table public.contest_anything_candidates enable row level security;

drop policy if exists "contest_questions_select_member" on public.contest_questions;
create policy "contest_questions_select_member"
  on public.contest_questions for select
  using (
    exists (
      select 1 from public.contest_members m
      where m.contest_id = contest_questions.contest_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "contest_anything_candidates_select_member" on public.contest_anything_candidates;
create policy "contest_anything_candidates_select_member"
  on public.contest_anything_candidates for select
  using (
    exists (
      select 1 from public.contest_members m
      where m.contest_id = contest_anything_candidates.contest_id
        and m.user_id = auth.uid()
    )
  );

-- Host seeds Anything questions + candidate labels at create time.
create or replace function public.seed_contest_questions(
  p_contest_id uuid,
  p_questions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_item jsonb;
  v_sort integer := 0;
  v_name text;
  v_id uuid;
  v_ids uuid[] := '{}'::uuid[];
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

  if coalesce(v_contest.theme, 'generic') not in ('generic', 'song', 'photo') then
    raise exception 'INVALID_SETTINGS';
  end if;

  if jsonb_typeof(p_questions) <> 'array' then
    raise exception 'INVALID_SETTINGS';
  end if;

  for v_item in select value from jsonb_array_elements(p_questions)
  loop
    v_name := trim(coalesce(v_item->>'name', ''));
    if char_length(v_name) < 1 then
      continue;
    end if;
    v_sort := v_sort + 1;
    insert into public.contest_questions (contest_id, sort_order, name)
    values (p_contest_id, v_sort, v_name)
    returning id into v_id;
    v_ids := array_append(v_ids, v_id);
  end loop;

  return jsonb_build_object('ok', true, 'question_ids', to_jsonb(v_ids));
end;
$$;

revoke all on function public.seed_contest_questions(uuid, jsonb) from public;
grant execute on function public.seed_contest_questions(uuid, jsonb) to authenticated;

create or replace function public.seed_anything_candidates(
  p_contest_id uuid,
  p_candidates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_item jsonb;
  v_sort integer := 0;
  v_label text;
  v_question_id uuid;
  v_label_mode text;
  v_count integer := 0;
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

  if jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'INVALID_SETTINGS';
  end if;

  for v_item in select value from jsonb_array_elements(p_candidates)
  loop
    v_label := trim(coalesce(v_item->>'label', ''));
    v_question_id := nullif(v_item->>'questionId', '')::uuid;
    v_label_mode := coalesce(nullif(v_item->>'labelMode', ''), 'custom');
    if char_length(v_label) < 1 or v_question_id is null then
      continue;
    end if;
    if not exists (
      select 1 from public.contest_questions q
      where q.id = v_question_id and q.contest_id = p_contest_id
    ) then
      continue;
    end if;
    v_sort := v_sort + 1;
    insert into public.contest_anything_candidates (
      contest_id, question_id, sort_order, label, label_mode
    ) values (
      p_contest_id, v_question_id, v_sort, v_label, v_label_mode
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

revoke all on function public.seed_anything_candidates(uuid, jsonb) from public;
grant execute on function public.seed_anything_candidates(uuid, jsonb) to authenticated;

-- Combined: host curated nominations + participant nominations.
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

  if not v_contest.nominations_open or v_contest.status not in ('open', 'voting') then
    raise exception 'NOMINATIONS_CLOSED';
  end if;

  if v_contest.nomination_deadline is not null and v_contest.nomination_deadline < now() then
    raise exception 'NOMINATION_DEADLINE_PASSED';
  end if;

  if v_source not in ('user_single', 'user_multiple', 'curated', 'combined') then
    raise exception 'NOMINATIONS_NOT_ALLOWED';
  end if;

  if v_source = 'combined' then
    v_is_host_curated := v_contest.host_user_id = v_uid;
  elsif v_source = 'curated' then
    v_is_host_curated := true;
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
    select count(*)::integer into v_curated_count
    from public.candidates
    where contest_id = p_contest_id
      and status <> 'withdrawn'
      and (
        nominator_user_id = v_contest.host_user_id
        or v_source = 'curated'
      );

    if v_contest.max_candidates is not null
       and v_curated_count >= v_contest.max_candidates then
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

-- Patch create/update for combined + updated nomination caps + anonymous flag.
do $patch$
declare
  r record;
  def text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_contest', 'update_contest_settings')
  loop
    def := pg_get_functiondef(r.oid);

    def := replace(
      def,
      '''curated'', ''user_single'', ''user_multiple'', ''databased''',
      '''curated'', ''user_single'', ''user_multiple'', ''combined'', ''databased'''
    );

    def := replace(
      def,
      'if v_plan = ''free'' then v_max_noms := 1; elsif v_plan = ''plus'' then v_max_noms := least(v_max_noms, 5); end if;',
      'if v_plan = ''free'' then v_max_noms := least(v_max_noms, 2); elsif v_plan = ''plus'' then v_max_noms := least(v_max_noms, 5); end if;'
    );

    def := replace(
      def,
      'if v_source = ''curated'' then',
      'if v_source in (''curated'', ''combined'') then'
    );

    def := replace(
      def,
      'else v_max_candidates := null; end if;',
      'elsif v_source = ''combined'' then
    if v_plan = ''free'' then v_max_candidates := 10; elsif v_plan = ''plus'' then v_max_candidates := 50; else v_max_candidates := null; end if;
  else v_max_candidates := null; end if;'
    );

    if def not like '%results_anonymous%' then
      def := replace(
        def,
        'v_chart_country text := coalesce(v_settings->>''chart_country'', ''US'');',
        'v_chart_country text := coalesce(v_settings->>''chart_country'', ''US'');
  v_results_anonymous boolean := coalesce((v_settings->>''results_anonymous'')::boolean, false);'
      );
      def := replace(
        def,
        'allow_vote_own_nominations, ballot_reveal_order, nomination_kind, chart_country',
        'allow_vote_own_nominations, ballot_reveal_order, nomination_kind, chart_country, results_anonymous'
      );
      def := replace(
        def,
        'v_ballot_reveal_order, v_nomination_kind, v_chart_country',
        'v_ballot_reveal_order, v_nomination_kind, v_chart_country, v_results_anonymous'
      );
    end if;

    execute def;
  end loop;
end $patch$;
