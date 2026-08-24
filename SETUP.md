# BEATAGE setup guide

Step-by-step checklist for launching BEATAGE alongside MyContest on `gosmooth.eu`.

## Architecture

```
gosmooth.eu (Porkbun)
├── mycontest.gosmooth.eu  →  Vercel project: MyContest
└── beatage.gosmooth.eu    →  Vercel project: BEATAGE

Supabase (1 project)
├── auth.users             →  shared logins
├── profiles               →  shared display names (MyContest)
└── beatage_*              →  BEATAGE quiz data + billing

Polar
├── MyContest org          →  MyContest products
└── BEATAGE org            →  BEATAGE products

Resend
└── gosmooth.eu            →  shared SMTP for Supabase Auth emails
```

---

## Phase 1 — Domain (Porkbun + gosmooth.eu)

**Yes, the same root domain works.** Use a subdomain per app:

| App | URL |
| --- | --- |
| MyContest | `https://mycontest.gosmooth.eu` (or your current subdomain) |
| BEATAGE | `https://beatage.gosmooth.eu` |

### Porkbun DNS (after Vercel project exists)

1. Log in to Porkbun → DNS for `gosmooth.eu`
2. Add record:
   - **Type:** CNAME
   - **Host:** `beatage`
   - **Answer:** `cname.vercel-dns.com`
3. Wait for propagation (5–30 min)

> No new domain purchase needed — only a new subdomain.

---

## Phase 2 — GitHub repo ✅ (local ready)

Local project: `/Users/ralf/Projects/BEATAGE`

```bash
cd ~/Projects/BEATAGE
gh repo create BEATAGE --private --source=. --remote=origin --push
```

Or create the repo manually on GitHub, then:

```bash
git remote add origin git@github.com:YOUR_USER/BEATAGE.git
git add -A && git commit -m "Initial BEATAGE foundation from MyContest"
git push -u origin main
```

---

## Phase 3 — Supabase (same project)

1. Open your **existing MyContest Supabase project**
2. **SQL Editor** → run `supabase/migrations/beatage/001_beatage_initial.sql`
3. **Authentication → URL Configuration** → add Redirect URLs:
   - `http://localhost:3001/auth/callback`
   - `https://beatage.gosmooth.eu/auth/callback`
4. Copy the same API keys into BEATAGE `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

### Optional: import MyContest users

Already done by the migration (`insert into beatage_profiles select id from auth.users`).
No contest data import — quiz schema is different. Spotify chart data in `chart_entries` is readable by both apps if needed later.

---

## Phase 4 — Resend (shared SMTP)

If MyContest already sends auth emails via Resend + `gosmooth.eu`:

1. **No new domain** needed — same SPF/DKIM on `gosmooth.eu` covers all subdomains
2. Optionally update Supabase email templates to say "BEATAGE" when users sign up from BEATAGE
3. For distinct sender branding later: `hello@beatage.gosmooth.eu` (requires extra Resend DNS record)

---

## Phase 5 — Polar (new BEATAGE org)

1. Create organization **BEATAGE** at [polar.sh](https://polar.sh)
2. Create products (mirror MyContest pricing or adjust):
   - Plus Monthly / Plus Yearly
   - Pro Monthly / Pro Yearly
   - Quiz Unlock (one-time, replaces contest unlock)
3. **Developers → Access Token** → `POLAR_ACCESS_TOKEN`
4. **Webhooks → Add endpoint:**
   - URL: `https://beatage.gosmooth.eu/api/billing/webhook`
   - Events: customer state changed, order paid
   - Copy secret → `POLAR_WEBHOOK_SECRET`
5. Copy product IDs into env vars (see `.env.example`)

Start with `POLAR_SERVER=sandbox`, test checkout, then switch to `production`.

---

## Phase 6 — Vercel

1. [vercel.com](https://vercel.com) → **Add New Project** → import `BEATAGE` repo
2. Framework: Next.js (auto-detected)
3. Set all env vars from `.env.example`
4. Deploy → note the `*.vercel.app` URL
5. **Settings → Domains** → add `beatage.gosmooth.eu`
6. Complete Porkbun CNAME (Phase 1)
7. Set `NEXT_PUBLIC_SITE_URL=https://beatage.gosmooth.eu` → redeploy

### Spotify Connect (host click-to-play)

MyContest only opened Spotify via `spotify:track:` links (no OAuth). BEATAGE host
playback uses Spotify Connect and needs Redirect URIs in the Spotify Dashboard:

1. Open [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) → your app → Settings
2. Add **Redirect URIs** (exact match; Spotify has no wildcards):
   - `http://127.0.0.1:3001/api/spotify/callback` (local — HTTP only allowed for loopback IP; **not** `localhost`)
   - `https://beatage.gosmooth.eu/api/spotify/callback`
   - `https://YOUR-PROJECT.vercel.app/api/spotify/callback` (stable Vercel production URL)
3. Local: set `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3001` and open the app at
   that same origin (cookies + OAuth redirect must match).
4. Vercel: set `NEXT_PUBLIC_SITE_URL=https://beatage.gosmooth.eu` so the OAuth
   `redirect_uri` is HTTPS (falls back to `https://$VERCEL_URL` when unset).
5. Host needs Spotify Premium + the Spotify app open (active device).

---

## Phase 7 — Smoke test checklist

- [ ] `npm run dev` on port 3001 — landing loads
- [ ] Anonymous session works (Supabase)
- [ ] Email signup sends mail (Resend)
- [ ] Polar sandbox checkout completes
- [ ] Webhook updates `beatage_profiles.plan`
- [ ] `beatage.gosmooth.eu` serves HTTPS

---

## What's next (app development)

The repo currently contains the MyContest codebase as a starting point. Next implementation steps:

1. Rebrand UI copy (quiz instead of contest)
2. Wire dashboard to `beatage_quizzes`
3. Quiz create/join/play flows
4. Spotify track picker + release year reveal
5. Scoring + winner presentation
