-- Quiz page: expose host + caller membership (security definer, no RLS gap)

create or replace function public.get_beatage_quiz_by_join_code(p_join_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz public.beatage_quizzes%rowtype;
  v_member_count integer;
  v_my_role text;
begin
  select * into v_quiz
  from public.beatage_quizzes
  where join_code = upper(trim(p_join_code));

  if not found then
    return null;
  end if;

  if v_quiz.expires_at is not null and v_quiz.expires_at < now()
     and v_quiz.status in ('draft', 'open', 'playing') then
    update public.beatage_quizzes set status = 'expired' where id = v_quiz.id;
    v_quiz.status := 'expired';
  end if;

  select count(*)::integer into v_member_count
  from public.beatage_quiz_members
  where quiz_id = v_quiz.id;

  select m.role into v_my_role
  from public.beatage_quiz_members m
  where m.quiz_id = v_quiz.id
    and m.user_id = auth.uid();

  return jsonb_build_object(
    'id', v_quiz.id,
    'title', v_quiz.title,
    'description', v_quiz.description,
    'status', v_quiz.status,
    'source', v_quiz.source,
    'join_code', v_quiz.join_code,
    'host_user_id', v_quiz.host_user_id,
    'max_members', v_quiz.max_members,
    'member_count', v_member_count,
    'expires_at', v_quiz.expires_at,
    'my_role', v_my_role,
    'is_host', v_quiz.host_user_id is not distinct from auth.uid(),
    'is_full', case
      when v_quiz.max_members is null then false
      else v_member_count >= v_quiz.max_members
    end
  );
end;
$$;

revoke all on function public.get_beatage_quiz_by_join_code(text) from public;
grant execute on function public.get_beatage_quiz_by_join_code(text) to anon, authenticated;
