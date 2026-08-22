# Historical chart data (Supabase)

MyContest stores historical singles **#1** charts in `public.chart_entries` for birthday-style lookups.

## Setup

1. Run migration `supabase/migrations/032_chart_entries.sql` in the Supabase SQL editor.
2. Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` (see `.env.example`).
3. Install deps and import:

```bash
npm install
npm run import:charts -- --country=all
```

Country filters:

```bash
npm run import:charts -- --country=DE
npm run import:charts -- --country=AT
npm run import:charts -- --country=GB
npm run import:charts -- --country=DE --dry-run
```

Sources (MVP): English Wikipedia number-one lists via the MediaWiki API. Each row stores `source`, `source_url`, and `source_revision`.

## Lookup

```ts
import { getNumberOneSong } from "@/lib/charts/lookup";

const hit = await getNumberOneSong("DE", "1978-05-14");
// { artist, title, validFrom, validTo, ... } | null
```

`getChartNumberOne()` (`src/lib/charts/resolve.ts`) uses Billboard (live) for `US` and `chart_entries` for `DE` / `AT` / `GB`.

Client UI imports country labels from `@/lib/charts` (safe barrel). Do not import `lookup` / `resolve` into Client Components.

## Scope

- Singles position #1 only
- Countries: DE, AT, GB (US remains Billboard Hot 100)
- No Spotify / MusicBrainz enrichment in the importer
