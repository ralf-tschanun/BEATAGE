-- Allow Topic seeding for Song and Photo contests (not only Anything/generic).
-- Paste ONLY this SQL into the Supabase SQL editor.

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
  v_theme text;
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

  v_theme := coalesce(v_contest.theme, 'generic');
  if v_theme not in ('generic', 'song', 'photo') then
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
