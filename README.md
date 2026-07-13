# LitArcadeWordle

A two-stage Wordle tournament platform: **Prelims** ("Timed Wordle" — 6-minute clock, 6 tries, grace periods, time-banking) followed by **Playoffs** ("UNWORDLE" — reverse-Wordle, stopwatch-ranked). Built for a reusable multi-event admin platform supporting up to ~600 concurrent players per event.

The full product spec lives in [design/DESIGN_BRIEF.md](design/DESIGN_BRIEF.md) (page-wise requirements for all 18 screens) and [design/reference-design.html](design/reference-design.html) (open directly in a browser — a self-contained, high-fidelity mockup of every screen with an id badge in each frame's corner, e.g. "P3 — Timed Wordle Game", "A5 — Timed Wordle Admin Panel").

## Status

Every screen in the design brief is implemented and wired to real backend logic — both games are fully playable end-to-end, and the full admin console (event management, live session monitoring, messaging, the Prelims→Playoffs cutoff tool, puzzle authoring, winners, audit log) is built. 69 backend unit tests cover both games' engines against the PRDs' own worked examples and acceptance tables.

**Not yet done, called out explicitly so nothing here is assumed silently:**
- **No live database has been run against this code.** The sandbox this was built in has no Postgres available, so every route/service has been verified via unit tests, type-checking, and graceful-error-path browser checks (a DB outage returns a clean 500, never a crash or a hang) — but no migration has actually been executed, and no full create-event → play → advance → play → winners flow has been run against real data. **Run the migrations and do one full walkthrough before treating this as production-ready** (see Verification below).
- Concurrency/load testing at the target 600-concurrent-session scale hasn't been run.
- Definitions for the Timed Wordle reveal screen are admin-authored at puzzle-creation time, not fetched from an external dictionary API (kept deliberately — avoids a runtime dependency and matches the original architecture plan's "no external API at runtime" decision).
- There's no cross-linking yet from a Timed Wordle results screen to the UNWORDLE lobby for players who've advanced — they navigate there via the notification/URL directly. Small, easy follow-up if wanted.
- A few older modules (`events`, `admin auth`) return raw snake_case Postgres rows straight over the wire rather than camelCase DTOs like the newer game modules do — functionally fine (the frontend types match reality exactly), just an inconsistency worth normalizing at some point if the API's shape needs to stabilize for other consumers.

## Architecture

- `apps/api` — Express + Socket.IO backend (Node/TypeScript)
- `apps/web` — React + Vite + Tailwind + shadcn/ui frontend
- `packages/shared-types` — TypeScript types shared by both (socket payloads, DTOs, enums)

The Timed Wordle timer is **server-authoritative**: a single in-process scan loop (`apps/api/src/modules/timed-wordle/engine/timerScheduler.ts`) drives every active session's try/grace/global-clock transitions and persists them to Postgres on every change, so a redeploy mid-event recovers in-flight games from the database rather than losing them. No Redis is used — see the architecture notes in the original implementation plan for when that would become necessary (horizontal scaling across multiple Node instances).

## Running locally

```bash
npm install
cp apps/api/.env.example apps/api/.env   # then fill in DATABASE_URL — see below
npm run migrate:up                        # apply all Postgres migrations
npm run dev:api                           # http://localhost:4000
npm run dev:web                           # http://localhost:5173
```

### Environment variables (`apps/api/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `ADMIN_SECRET_KEY` | Shared admin passphrase — set this to your own secret, never commit the real value |
| `CORS_ORIGIN` | Frontend origin, e.g. `http://localhost:5173` |
| `PORT` | API port (default 4000) |
| `EVENT_TIMEZONE` | Default event timezone (default `Asia/Kolkata`) |

## Connecting this to Lovable / Supabase

Lovable projects run on Supabase under the hood, which is plain Postgres — this backend's `pg`-based data layer works against it unchanged. To wire it up:

1. In the Supabase dashboard for your Lovable project: **Project Settings → Database → Connection string** (use the direct connection, not the pooler, since `node-pg-migrate` needs a stable session for DDL).
2. Put that string in `apps/api/.env` as `DATABASE_URL`, then run `npm run migrate:up`.
3. **The Node/Socket.IO service itself needs to run somewhere that supports long-running processes** (Render, Railway, Fly.io, a small VPS) — Lovable hosts the frontend + Supabase, not arbitrary backend servers, since the timer scheduler and websocket connections need a persistent process. Point `apps/web`'s `VITE_API_BASE_URL` at wherever that ends up.
4. `apps/web` can be imported into Lovable as-is (it's a standard Vite + Tailwind + shadcn/ui app) for further design iteration there, pointed at the separately-hosted API.

## Verification

```bash
npm run test:api    # 69 unit tests — both game engines against the PRDs' worked examples
npm run build:api
npm run build:web
```

Before calling this event-ready:
1. Run migrations against a real Postgres instance.
2. Full manual walkthrough: create an event → upload a cohort → open Prelims → play a Timed Wordle game to completion (force a grace/skip and a Try-6 time-bank scenario) → use the Cutoff Tool to advance players → create + publish an UNWORDLE puzzle → start/play/end a Playoffs session → mark winners → check the audit log recorded everything.
3. Load-test at or near 600 concurrent simulated players.
