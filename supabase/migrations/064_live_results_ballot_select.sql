-- Live results: members may read all ballots while results_reveal = live.
-- Paste ONLY this SQL into the Supabase SQL editor if not applied via CLI.

drop policy if exists "ballots_select_member" on public.ballots;
create policy "ballots_select_member"
  on public.ballots for select
  using (
    public.is_contest_member(contest_id)
    and (
      voter_user_id = auth.uid()
      or exists (
        select 1 from public.contests c
        where c.id = contest_id
          and (
            c.status = 'finished'
            or c.host_user_id = auth.uid()
            or c.results_reveal = 'live'
          )
      )
    )
  );
