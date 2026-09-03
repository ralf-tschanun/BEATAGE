-- Only one live round per quiz. Concurrent host/cron opens used to insert two
-- active rows; maybeSingle() then returned nothing and guessing froze.
with ranked as (
  select
    id,
    row_number() over (partition by quiz_id order by round_number desc) as rn
  from public.beatage_rounds
  where status = 'active'
)
update public.beatage_rounds r
set
  status = 'skipped',
  revealed_at = coalesce(r.revealed_at, now()),
  guess_closes_at = coalesce(r.guess_closes_at, now())
from ranked
where r.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists beatage_rounds_one_active_per_quiz
  on public.beatage_rounds (quiz_id)
  where status = 'active';
