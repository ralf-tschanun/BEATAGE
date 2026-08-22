-- Birthday contests: also force allow_vote_own_nominations = true
-- Paste ONLY this SQL into the Supabase SQL editor

create or replace function public.enforce_birthday_contest_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.nomination_kind = 'birthday' then
    new.theme := 'song';
    new.candidate_source := 'user_single';
    new.max_nominations_per_participant := 1;
    new.max_candidates := null;
    new.allow_duplicate_candidates := true;
    new.candidate_reveal := 'admin_batch';
    new.allow_vote_own_nominations := true;
  end if;
  return new;
end;
$$;

update public.contests
set allow_vote_own_nominations = true
where nomination_kind = 'birthday'
  and allow_vote_own_nominations is distinct from true;
