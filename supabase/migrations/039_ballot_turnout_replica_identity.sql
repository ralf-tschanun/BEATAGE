-- Ensure ballot_turnout UPDATE/DELETE payloads include filter columns for Realtime.
alter table public.ballot_turnout replica identity full;
