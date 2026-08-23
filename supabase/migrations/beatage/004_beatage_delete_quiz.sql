-- Host can delete own BEATAGE quizzes (frees active quiz limit on Free)

create or replace function public.delete_beatage_quiz(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_quiz public.beatage_quizzes%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_quiz
  from public.beatage_quizzes
  where id = p_quiz_id
  for update;

  if not found then
    raise exception 'QUIZ_NOT_FOUND';
  end if;

  if v_quiz.host_user_id <> v_uid then
    raise exception 'NOT_HOST';
  end if;

  delete from public.beatage_quizzes where id = p_quiz_id;

  return jsonb_build_object('ok', true, 'id', p_quiz_id);
end;
$$;

revoke all on function public.delete_beatage_quiz(uuid) from public;
grant execute on function public.delete_beatage_quiz(uuid) to authenticated;
