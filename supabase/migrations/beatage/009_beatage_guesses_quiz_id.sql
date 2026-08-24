-- Add quiz_id to beatage_guesses for efficient Realtime filtering.
-- Without this column, the Realtime postgres_changes listener cannot filter by quiz,
-- so every guess in every quiz fires an event for every open quiz tab.

alter table public.beatage_guesses
  add column if not exists quiz_id uuid references public.beatage_quizzes (id) on delete cascade;

-- Backfill from the round reference.
update public.beatage_guesses g
set quiz_id = r.quiz_id
from public.beatage_rounds r
where r.id = g.round_id
  and g.quiz_id is null;

-- Make it not-null going forward.
alter table public.beatage_guesses
  alter column quiz_id set not null;

-- Index for filter queries and Realtime.
create index if not exists beatage_guesses_quiz_id_idx
  on public.beatage_guesses (quiz_id);

-- Keep the write-path (upsert in submit_beatage_guess) inserting quiz_id too.
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
  v_row   public.beatage_guesses%rowtype;
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

  insert into public.beatage_guesses (quiz_id, round_id, user_id, guessed_year)
  values (v_round.quiz_id, p_round_id, auth.uid(), p_guessed_year)
  on conflict (round_id, user_id) do update
  set
    guessed_year = excluded.guessed_year,
    submitted_at = now()
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- Update the RLS select policy so it can use quiz_id directly (faster — avoids join).
drop policy if exists beatage_guesses_select_member on public.beatage_guesses;
create policy beatage_guesses_select_member on public.beatage_guesses
  for select to authenticated
  using (
    exists (
      select 1
      from public.beatage_quiz_members m
      where m.quiz_id = beatage_guesses.quiz_id
        and m.user_id = auth.uid()
    )
  );

-- REPLICA IDENTITY FULL is already set (007); no change needed.
