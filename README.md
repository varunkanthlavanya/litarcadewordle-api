# LitArcadeWordle

A two-stage Wordle tournament platform: **Prelims** ("Timed Wordle" — 6-minute clock, 6 tries, grace periods, time-banking) followed by **Playoffs** ("UNWORDLE" — reverse-Wordle, stopwatch-ranked). Built for a reusable multi-event admin platform supporting up to ~600 concurrent players per event.

The full product spec lives in [design/DESIGN_BRIEF.md](design/DESIGN_BRIEF.md) (page-wise requirements for all 18 screens) and [design/reference-design.html](design/reference-design.html) (open directly in a browser — a self-contained, high-fidelity mockup of every screen with an id badge in each frame's corner, e.g. "P3 — Timed Wordle Game", "A5 — Timed Wordle Admin Panel").

## Status

Every screen in the design brief is implemented and wired to real backend logic — both games are fully playable end-to-end, and the full admin console (event management, live session monitoring, messaging, the Prelims→Playoffs cutoff tool, puzzle authoring, winners, audit log) is built.

**Not yet done, called out explicitly so nothing here is assumed silently:**
- **No live database has been run against this code yet.** Every route has been verified by careful manual review against the original (previously-tested) Express implementation this was ported from, and by type-checking, but no migration has actually been executed against a real Supabase project. **Run the migrations and do one full walkthrough before treating this as production-ready** (see Verification below).
- Concurrency/load testing at the target 600-concurrent-session scale hasn't been run — see the design note on this below for why it should hold up, but that's a claim to verify, not a guarantee.
- Definitions for the Timed Wordle reveal screen are admin-authored at puzzle-creation time, not fetched from an external dictionary API (kept deliberately — avoids a runtime dependency).
- A few "online now" / "delivery status" admin-facing indicators are approximated via recent activity timestamps rather than true live presence, since there's no persistent server holding open connections anymore (see Architecture below) — this only affects a couple of cosmetic badges, not gameplay or data correctness.

## Architecture

- `apps/web` — React + Vite + Tailwind + shadcn/ui frontend
- `apps/web/supabase/migrations` — Postgres schema (every table/type prefixed `wl_` so it can't collide with anything else in a shared Supabase project)
- `apps/web/supabase/functions` — Supabase Edge Functions (Deno) — this is the backend. One function per module (`wl-admin-auth`, `wl-player-auth`, `wl-events`, `wl-timed-wordle`, `wl-unwordle`, `wl-cutoff`, `wl-winners`, `wl-audit`, `wl-notifications`), plus `wl-sweep` (a cron-invoked safety net, see below). `apps/web/supabase/functions/_shared` holds the pure game-logic files (state machines, scoring, validation) ported essentially unchanged from the original design, plus shared auth/CORS/token helpers.
- `packages/shared-types` — TypeScript types shared across the frontend (DTOs, enums)

This intentionally has **no persistent Node process** — it runs entirely on Supabase (Postgres + Edge Functions), which is what makes it hostable inside a Lovable Cloud project alongside other, unrelated functionality.

### Timed Wordle's timer, without a persistent server

The original design used a single in-process 500ms scan loop to proactively fire timer transitions (try → grace → skip, global timeout). Supabase Edge Functions have no equivalent persistent process, so this became:

1. **Lazy reconcile-on-read**: every call that touches a Timed Wordle session first checks stored deadlines against `now()` and applies any due transitions (`apps/web/supabase/functions/_shared/timedWordle/repo.ts`'s `loadAndReconcile`) before returning fresh state — the same transition logic as before, just invoked synchronously instead of on a loop.
2. **Event-driven client timers, not polling**: the player's browser already knows its own next deadline (it's in the state it was just given), so instead of polling on a fixed interval, it schedules exactly one `setTimeout` for the moment that deadline elapses and calls back in then — this keeps request volume low even at 600 concurrent players, since most of the time nothing is due yet.
3. **`wl-sweep` cron job** (see the pg_cron migration) reconciles every `IN_PROGRESS` session once a minute — a safety net for sessions nobody is actively polling (an abandoned tab), not the primary correctness mechanism.

UNWORDLE has no per-try timer at all (just an admin-driven start/stop stopwatch), so it needed none of this — just plain read-mutate-write per action, with a short interval poll on the player side to notice an admin-initiated start/end.

Optimistic concurrency (a `row_version` column, checked-and-incremented on every session write) replaces holding open a database transaction across a request — appropriate here since a given session realistically only has one real writer at a time (its own player, plus the occasional reconcile).

Admin dashboards poll every ~5 seconds instead of receiving Socket.IO pushes — the UI was already fully-refetch-on-update rather than diff-patched, so this reads identically, just interval-driven instead of event-driven.

## Running locally

```bash
npm install
npm run dev:web       # http://localhost:5173
```

The frontend talks directly to Supabase Edge Functions — there's no separate local API server to run. To exercise the backend locally you need the [Supabase CLI](https://supabase.com/docs/guides/cli) and Docker:

```bash
supabase start                 # local Postgres + Edge Functions runtime
supabase db reset              # applies every migration in apps/web/supabase/migrations
supabase functions serve       # serves every function in apps/web/supabase/functions
```

### Environment variables (`apps/web/.env`)

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Your Supabase project's anon/publishable key |

### Edge Function secrets (set via `supabase secrets set` or the Supabase dashboard)

| Secret | Purpose |
|---|---|
| `ADMIN_SECRET_KEY` | Shared admin passphrase — never commit the real value |
| `CORS_ORIGIN` | Comma-separated allowed origins, e.g. `https://your-app.lovable.app,https://preview--your-app.lovable.app` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Auto-provided by Supabase inside every Edge Function — no action needed |
| `CRON_SECRET` | A separate, randomly-generated secret (NOT the service-role key) that authorizes the `wl-sweep` cron job — see the pg_cron migration's comments for setup |
| `ADMIN_SESSION_TTL_HOURS` / `PLAYER_SESSION_TTL_HOURS` | Session lengths (default 12 / 6) |
| `EVENT_TIMEZONE` | Default event timezone (default `Asia/Kolkata`) |

## Connecting this to Lovable Cloud

1. Push `apps/web/supabase/migrations` and `apps/web/supabase/functions` to the repo your Lovable project syncs with — Lovable's own GitHub integration picks up schema/function changes from there.
2. Set every secret in the table above via the Supabase dashboard for that project (Project Settings → Edge Functions → Secrets).
3. Fill in the two placeholders in the `wl_sweep_cron` migration (your project ref and a freshly-generated `CRON_SECRET`) before it runs.
4. `apps/web` itself needs no separate hosting step beyond what Lovable already does for the rest of the project — there's no standalone backend to deploy anywhere else.

## Verification

Before calling this event-ready:
1. Run the migrations against a real Supabase project (local `supabase start` first, then the real one).
2. Full manual walkthrough: create an event → upload a cohort → open Prelims → play a Timed Wordle game to completion (force a grace/skip and a Try-6 time-bank scenario) → use the Cutoff Tool to advance players → create + publish an UNWORDLE puzzle → start/play/end a Playoffs session → mark winners → check the audit log recorded everything.
3. Confirm the admin secret key works end-to-end via the real login form, not just as a stored Edge Function secret.
4. Load-test a burst of ≥600 simultaneous requests against `wl-timed-wordle` (k6/artillery) and confirm no Postgres connection-limit errors — the design above is intended to hold up at this scale, but that's a claim to verify, not assume.
