-- Historical #1 chart entries (DE / AT / GB initially; extensible)
-- Paste ONLY this SQL into the Supabase SQL editor

create table if not exists public.chart_entries (
  id uuid primary key default gen_random_uuid(),

  country_code char(2) not null,
  chart_type text not null default 'singles',
  position smallint not null default 1,

  valid_from date not null,
  valid_to date not null,

  chart_frequency text not null,

  artist text not null,
  title text not null,

  musicbrainz_id text,
  spotify_id text,

  source text not null,
  source_url text,
  source_revision text,

  is_interpolated boolean not null default false,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chart_entries_dates_check check (valid_to >= valid_from),
  constraint chart_entries_position_check check (position >= 1),
  constraint chart_entries_country_check check (country_code ~ '^[A-Z]{2}$')
);

-- Natural identity for repeatable upserts (same run must not duplicate)
create unique index if not exists chart_entries_natural_uidx
  on public.chart_entries (
    country_code,
    chart_type,
    position,
    valid_from,
    md5(lower(btrim(artist) || chr(31) || btrim(title)))
  );

create index if not exists chart_entries_birthday_lookup_idx
  on public.chart_entries (country_code, chart_type, position, valid_from, valid_to);

create index if not exists chart_entries_country_type_idx
  on public.chart_entries (country_code, chart_type);

create index if not exists chart_entries_source_idx
  on public.chart_entries (source);

alter table public.chart_entries enable row level security;

drop policy if exists "chart_entries_select_authenticated" on public.chart_entries;
create policy "chart_entries_select_authenticated"
  on public.chart_entries for select
  to authenticated
  using (true);

drop policy if exists "chart_entries_select_anon" on public.chart_entries;
create policy "chart_entries_select_anon"
  on public.chart_entries for select
  to anon
  using (true);

-- Writes go through service role (bypasses RLS); no public insert/update policies.

comment on table public.chart_entries is
  'Historical chart positions (MVP: singles #1). Lookup by date via valid_from/valid_to.';
