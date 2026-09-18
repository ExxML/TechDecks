<div align="center">

<img src="public/icon-512.png" alt="TechDecks Icon" width="120" height="120">

# TechDecks

A mobile-first web app that turns technical interview problems into AI-generated multiple-choice decks, so you can train pattern recognition by swiping instead of typing code.

[![Next.js](https://img.shields.io/badge/Next.js-000000?logo=next.js&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-%230D6EFD?logo=react)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Gemini](https://img.shields.io/badge/Gemini-8E75B2?logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-orange.svg)](https://www.gnu.org/licenses/gpl-3.0)

### Check it out! https://techdecks.vercel.app

</div>

## 📑 Table of Contents

- [✨ Features](#-features)
- [🛠️ Tech Stack](#️-tech-stack)
- [📁 Project Structure](#-project-structure)
- [🚀 Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Supabase Setup](#supabase-setup)
  - [App Setup](#app-setup)
- [🔄 Content Sync](#-content-sync)
- [🏢 Deployment](#-deployment)
  - [App Deployment (Vercel)](#app-deployment-vercel)
  - [Sync Deployment (GitHub Actions)](#sync-deployment-github-actions)
- [🔧 Configuration](#-configuration)
- [📡 API Endpoints](#-api-endpoints)
- [📊 Data Sources](#-data-sources)
- [📝 License](#-license)

## ✨ Features

- **Swipeable problem deck** — one problem per card, with custom pointer-driven scrolling that behaves identically on desktop mouse, touchpad, and mobile touch. Drag to peek at the next card; release to commit or snap back.
- **Four-question AI decks** — generate a set of multiple-choice questions per problem, each targeting a different layer of interview readiness:
  - **Approach** — which problem-solving strategy the problem calls for
  - **Algorithm** — the optimal solution method
  - **Complexity** — Big O time and space
  - **Solution** — pick the correct complete implementation
- **Bring your own key** — generation runs against *your* Gemini API key on *your* free-tier quota. The app never pays for, proxies, or pools generation. Keys can be kept in-session only, or saved encrypted in Supabase Vault so they follow your account across devices.
- **Model picker** — choose any Gemini model your key has access to; the list is fetched live rather than hardcoded.
- **Search, bookmarks, and history** — per-word title search, bookmark any problem, and an automatically maintained history ordered by most recent visit.
- **Author your own problems** — write and tag your own problems alongside the synced LeetCode catalog, and generate decks against them the same way.
- **Answer persistence** — selections and scores are stored per set, so closing the tab and returning keeps your progress. Retry a single question or reset an entire set.
- **Installable PWA** — add to home screen and it opens without browser chrome, with the card layout sized for a real phone viewport.
- **Light and dark themes** — applied before first paint, so there is no flash on reload.
- **Row Level Security everywhere** — every table is RLS-protected, and the deployed app runs entirely on the public anon key. No service-role key is ever present in the deployment.

## 🛠️ Tech Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| UI | React 19, Tailwind CSS v4 (`@theme`), hand-built primitives |
| Icons | Lucide |
| Server state | TanStack Query v5 |
| Client state | Zustand |
| Validation | Zod — one schema drives Gemini's `responseSchema`, the runtime parse, and the TS types |
| Database + Auth | Supabase (Postgres, Google OAuth, RLS, Vault) |
| AI | Google Gemini, via a server route |
| HTML safety | `isomorphic-dompurify`, sanitizing at both ingest and render |
| Hosting | Vercel (app) + GitHub Actions (sync) |

**No component library.** The ~6 UI primitives (`Button`, `Input`, `Select`, `Dialog`, `Badge`, `Skeleton`) are hand-built.

**Why a server is required:** `generativelanguage.googleapis.com` rejects browser fetches carrying the headers the API needs, so generation and model listing are proxied through Route Handlers. A pure static SPA cannot do this.

## 📁 Project Structure

```
TechDecks/
├── .github/workflows/      # Scheduled sync + Supabase keep-alive
│   ├── sync.yml            # Monthly LeetCode delta sync
│   ├── keepalive.yml       # Daily DB heartbeat (Free tier pauses after 7 idle days)
│   └── workflow-keepalive.yml
├── public/                 # PWA icons
├── scripts/
│   ├── lib/
│   │   ├── leetcode.ts     # The only module that talks to LeetCode
│   │   └── sync.ts         # Shared bulk-load / delta-sync logic
│   ├── seed.ts             # One-time bulk catalog load
│   ├── sync-delta.ts       # Incremental sync + heartbeat
│   └── verify-*.ts         # Verification suite (RLS, auth, search, sanitize, ...)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── feed/       # Paginated, RLS-scoped feed pages
│   │   │   └── gemini/     # generate + models proxies
│   │   ├── auth/callback/  # Supabase PKCE exchange
│   │   ├── problems/       # Feed and problem detail
│   │   ├── search/         # Search + filters
│   │   ├── bookmarks/      # Saved problems
│   │   ├── history/        # Recently visited
│   │   ├── my/             # Authored problems
│   │   ├── settings/       # API key, model, theme, account
│   │   └── manifest.ts     # PWA manifest
│   ├── components/
│   │   ├── mcq/            # Question panel, stepper, options, summary
│   │   ├── ui/             # Hand-built primitives
│   │   └── ProblemFeed.tsx # Custom card scrolling
│   └── lib/
│       ├── gemini/         # Client, prompt, schema, key resolution
│       ├── mcq/            # Generation, local + Supabase stores, migration
│       ├── supabase/       # Browser and server clients
│       └── queries.ts      # Feed, search, and item queries
└── supabase/migrations/    # 0001–0012, all idempotent
```

## 🚀 Getting Started

### Prerequisites

- **Node.js 20+** and npm
- A **Supabase** account (free tier is enough)
- A **Google Cloud** project, for the OAuth client
- A **Gemini API key** from [aistudio.google.com](https://aistudio.google.com/app/apikey) — create a dedicated one for this app, not a key you already use elsewhere

### Supabase Setup

1. **Create the project.** At [supabase.com](https://supabase.com), create a new free-tier project. Provisioning takes 2–3 minutes.

2. **Collect the credentials.** Under **Project Settings → API**:

   | What | Goes to |
   |---|---|
   | Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
   | `anon` / `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
   | `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` — **local scripts and GitHub Actions only** |

   > ⚠️ **The `service_role` key bypasses Row Level Security completely.** Anyone holding it can read or delete every row in the database, including other users' data. It must never carry a `NEXT_PUBLIC_` prefix, never be imported anywhere a client component can reach, and never be set in Vercel. Only the seed script and the sync workflow use it, both of which run outside the deployed app on purpose.

3. **Apply the migrations.** Open **SQL Editor → New query**, then paste and run each file in `supabase/migrations/` **in numbered order**, `0001` through `0012`. Every migration is idempotent, so re-running one is safe.

   Confirm it worked:

   ```sql
   select tablename, rowsecurity from pg_tables
   where schemaname = 'public' order by tablename;
   ```

   Expect ten rows — `bookmarks`, `content_item_tags`, `content_items`, `content_references`, `mcq_sets`, `problem_visits`, `sources`, `sync_runs`, `tags`, `user_settings` — with **`rowsecurity` true on every one**. A `false` anywhere means that table is world-writable through the public anon key; re-run `0001_init.sql` before going further.

4. **Set up Google sign-in.** Google is the only supported sign-in method.

   - Copy the callback URL from **Authentication → Sign In / Providers → Google** (it looks like `https://<ref>.supabase.co/auth/v1/callback`).
   - In [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services**, configure an **External** OAuth consent screen and **publish** it. Only the default `email`, `profile`, and `openid` scopes are needed, so no verification review is required. Users will see an "unverified app" interstitial; that is expected.
   - Create an **OAuth client ID** (Web application). Authorized JavaScript origins: `http://localhost:3000` and your production URL. Authorized redirect URI: the **Supabase** callback URL from above — not a route in this app.
   - Paste the resulting Client ID and secret back into Supabase → **Authentication → Google**, and enable the provider.
   - Under **Authentication → URL Configuration**, set the Site URL and add `http://localhost:3000/**` and `https://your-domain.vercel.app/**` to the redirect allow-list. Supabase silently bounces to the homepage for any URL not on this list.

5. **Load the catalog.** With `.env.local` filled in (below), run the one-time bulk load:

   ```bash
   npm run seed
   npm run verify:seed
   ```

### App Setup

```bash
git clone https://github.com/ExxML/TechDeck.git
cd TechDeck
npm install
cp .env.local.example .env.local   # PowerShell: Copy-Item .env.local.example .env.local
```

Fill in `.env.local` (see [Configuration](#-configuration)), then:

```bash
npm run dev
```

The app runs at `http://localhost:3000` and redirects to `/problems`.

**Other useful scripts:**

```bash
npm run build        # Production build
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run verify:rls   # Full RLS matrix audit
npm run verify:auth  # Auth and Vault orphan checks
```

The `verify:*` scripts cover seed integrity, RLS, sanitization, Gemini logic, MCQ storage, auth, migrations, authored problems, search, and sync. Run them all before deploying.

## 🔄 Content Sync

The LeetCode catalog is loaded once locally and kept current by a scheduled job:

- **Bulk load** — `npm run seed`, run locally. One-time, and long enough that it does not belong on a serverless function.
- **Delta sync** — `npm run sync:delta`, or the monthly **Sync LeetCode deltas** workflow. Picks up new and changed problems only.
- **Heartbeat** — `npm run sync:heartbeat`, run daily by `keepalive.yml`. A free Supabase project pauses after 7 days without database activity, and a monthly sync does not clear that bar.

All LeetCode traffic goes through a single module (`scripts/lib/leetcode.ts`) that throttles to 1 request per second and harvests its own CSRF token.

Sync runs on GitHub Actions rather than Vercel for two reasons, both fatal there: writing `content_items` requires the service-role key, which is banned from Vercel, and the deliberate throttle over up to 200 detail fetches exceeds Vercel Hobby's 300 s ceiling.

## 🏢 Deployment

### App Deployment (Vercel)

1. Push the repo to GitHub, then **Add New → Project** at [vercel.com](https://vercel.com) and import it. Vercel detects Next.js; accept the defaults.
2. Add **exactly three** environment variables — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SITE_URL`.
3. Deploy, then correct `NEXT_PUBLIC_SITE_URL` to the real domain and redeploy. Add that domain to the Google OAuth origins and the Supabase redirect allow-list.

> **`SUPABASE_SERVICE_ROLE_KEY` does not belong in Vercel, in any environment.** Nothing in the deployed app needs it: `/api/gemini/generate` never writes to the database (the browser persists results on its own RLS-scoped session), and reading a saved Gemini key uses `get_gemini_key()`, which takes no parameter and resolves the row from `auth.uid()` on the caller's session. If a saved key fails on a second device, the fix is applying `0010_vault_session_read.sql` — not adding the service-role key.

> **Leave Fluid Compute ON** (Settings → Functions). It is on by default. With it enabled a function may run 300 s on Hobby; disabled, the ceiling silently drops to 60 s, and `/api/gemini/generate` declares `maxDuration = 300`, which Vercel clamps without warning. The failure is invisible — fast models keep working while thinking-enabled models time out for no apparent reason.

### Sync Deployment (GitHub Actions)

Under **Settings → Secrets and variables → Actions**, add two repository secrets:

| Secret | Value |
|---|---|
| `SUPABASE_URL` | Your project URL (no `NEXT_PUBLIC_` prefix — this is not a browser context) |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service-role key. Sync writes `content_items`, `tags`, and `sync_runs`, all of which RLS blocks for anon |

These power both the monthly delta sync and the daily keep-alive. To run a sync on demand: **Actions → Sync LeetCode deltas → Run workflow**. It takes `max_detail` (default 200) and `dry_run` — use `dry_run: true` the first time.

## 🔧 Configuration

| Variable | Client-safe? | What it is |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Public key. Safe **only because RLS is on every table** |
| `NEXT_PUBLIC_SITE_URL` | ✅ | Origin of this deployment. Used for OAuth redirects and the `/api/gemini/*` same-origin check |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ | Bypasses RLS entirely. Local scripts and GitHub Actions only — **never Vercel** |
| `GH_DISPATCH_TOKEN` | ❌ | *Optional.* GitHub PAT for a manual-sync route |
| `GH_REPO` | ❌ | *Optional.* `owner/repo` for the same route |
| `SYNC_TRIGGER_SECRET` | ❌ | *Optional.* Bearer token guarding that route |

Any variable named `NEXT_PUBLIC_*` is inlined into the browser bundle at build time and is readable by anyone. Everything else is server-only.

**No Gemini key appears here.** Each user enters their own at runtime; it is never an environment variable.

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/feed` | Paginated feed pages for infinite scroll. Read-only and RLS-scoped — it uses the session client, never service-role, so it can only return rows the caller may already see. Supports catalog, bookmarks, and history scopes, keyset-paginated over a per-load shuffle |
| `POST` | `/api/gemini/generate` | Generates, validates, and returns an MCQ set. Never writes to the database. Same-origin checked, rate limited, `maxDuration = 300` |
| `GET` | `/api/gemini/models` | Lists the Gemini models the caller's key can access. Proxied because the Gemini API rejects browser fetches with the required headers. Cached privately for 24 h |
| `GET` | `/auth/callback` | Supabase PKCE exchange. Only ever redirects to a path on this origin |

Both Gemini routes resolve the key in order: the caller's saved Vault key, then the `x-gemini-key` request header. Upstream error text is never forwarded — only mapped messages — because it can contain the API key.

## 📊 Data Sources

- **[LeetCode](https://leetcode.com)** — problem titles, descriptions, difficulty, and topic tags, fetched through the public GraphQL endpoint at 1 request per second. Only free problems are stored.
- **[Google Gemini](https://ai.google.dev/)** — generates every question, option, explanation, and reference solution at request time, using the signed-in user's own API key and quota.
- **Authored problems** — anything you write yourself, stored under the `user` source alongside the synced catalog.

Schema note: there is no `leetcode_problems` table. Universal fields are real columns on `content_items`, and source-specific fields live in a `metadata` JSONB column. Adding a new content type (system design, hardware, static question banks) is one `sources` row and one loader, with no migration.

Problem HTML from any source is untrusted and is sanitized both at ingest and at render.

## 📝 License

Licensed under the [GNU General Public License v3.0](LICENSE).
