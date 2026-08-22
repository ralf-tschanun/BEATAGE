# BEATAGE

Music release-year guessing quiz. Host creates rules, participants join, host plays a Spotify track, everyone guesses the release year — scoring determines the winner.

Built on the same stack as [MyContest](../MyContest): Next.js 15, Supabase (shared auth), Polar (separate billing), Vercel.

## Hybrid model C

| Shared | Separate |
| --- | --- |
| `auth.users` (same login) | `beatage_*` tables (quiz data) |
| `public.profiles` (display name) | `beatage_profiles` (plan + Polar) |
| Supabase project | BEATAGE Polar org + products |

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Runs on [http://localhost:3001](http://localhost:3001) (MyContest uses 3000).

## Supabase setup

1. Use the **same Supabase project** as MyContest.
2. Run `supabase/migrations/beatage/001_beatage_initial.sql` in the SQL Editor.
3. Add BEATAGE redirect URLs under **Authentication → URL Configuration** (see `.env.example`).

## Deploy on Vercel

1. Push to GitHub repo `BEATAGE`.
2. Import project in Vercel, set env vars from `.env.example`.
3. Add custom domain `beatage.gosmooth.eu`.
4. Set `NEXT_PUBLIC_SITE_URL=https://beatage.gosmooth.eu`.

See [SETUP.md](./SETUP.md) for the full step-by-step guide.

## App routes (planned)

| Route | Purpose |
| --- | --- |
| `/` | Landing + dashboard |
| `/create` | Create quiz |
| `/join` | Enter join code |
| `/q/[code]` | Quiz home |
| `/billing/account` | Account for checkout |
| `/auth/callback` | OAuth / email confirm |
