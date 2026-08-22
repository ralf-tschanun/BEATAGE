-- Re-enable admin_sequential candidate reveal (one-by-one by host).
-- Paste into the Supabase SQL editor.

-- Table check was narrowed in 021 to live|admin_batch only — restore sequential.
alter table public.contests
  drop constraint if exists contests_candidate_reveal_check;

alter table public.contests
  add constraint contests_candidate_reveal_check
  check (candidate_reveal in ('live', 'admin_batch', 'admin_sequential'));

-- Stop coercing admin_sequential → admin_batch on create/update.
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
    def := regexp_replace(def, '^CREATE (OR REPLACE )?FUNCTION', 'CREATE OR REPLACE FUNCTION');

    -- Remove legacy coercion (present in older create/update bodies).
    def := replace(
      def,
      'if v_reveal = ''admin_sequential'' then v_reveal := ''admin_batch''; end if;',
      ''
    );
    def := replace(
      def,
      E'if v_reveal = ''admin_sequential'' then\n    v_reveal := ''admin_batch'';\n  end if;',
      ''
    );

    -- Allow sequential in the settings check.
    def := replace(
      def,
      'v_reveal not in (''live'', ''admin_batch'')',
      'v_reveal not in (''live'', ''admin_batch'', ''admin_sequential'')'
    );

    execute def;
  end loop;
end $patch$;

-- Reveal next pending candidate in the contest's candidate_sort order.
create or replace function public.reveal_next_candidate(p_contest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_candidate public.candidates%rowtype;
  v_sort text;
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

  if v_contest.status in ('finished', 'expired') then
    raise exception 'CONTEST_LOCKED';
  end if;

  if coalesce(v_contest.candidate_reveal, 'live') <> 'admin_sequential' then
    raise exception 'REVEAL_NOT_REQUIRED';
  end if;

  if v_contest.voting_open or v_contest.status = 'voting' then
    raise exception 'VOTING_ALREADY_OPEN';
  end if;

  v_sort := coalesce(v_contest.candidate_sort, 'nominated_at');

  select * into v_candidate
  from public.candidates
  where contest_id = p_contest_id
    and status = 'pending'
  order by
    case when v_sort = 'alphabetical' then lower(title) end asc nulls last,
    case when v_sort = 'random' then display_order end asc nulls last,
    created_at asc,
    id asc
  limit 1
  for update;

  if not found then
    raise exception 'NO_PENDING_CANDIDATES';
  end if;

  update public.candidates
  set status = 'visible'
  where id = v_candidate.id
  returning * into v_candidate;

  -- First reveal ends nominations.
  update public.contests
  set
    nominations_open = false,
    last_activity_at = now()
  where id = p_contest_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_candidate.id,
    'title', v_candidate.title,
    'artist', v_candidate.artist,
    'status', v_candidate.status,
    'nominations_open', false
  );
end;
$$;

revoke all on function public.reveal_next_candidate(uuid) from public;
grant execute on function public.reveal_next_candidate(uuid) to authenticated;
