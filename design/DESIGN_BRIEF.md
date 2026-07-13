# Handoff: LitArcadeWordle — Tournament Platform UI

## Overview
Full UI design for a two-stage Wordle tournament platform: **Prelims** ("Timed Wordle" — 6-minute clock, 6 tries) followed by **Playoffs** ("UNWORDLE" — reverse-Wordle, stopwatch-ranked). Covers 8 player-facing mobile screens and 10 admin-facing desktop screens, plus the cross-cutting patterns (status badges, notification toasts, presence indicators, confirm modals) called out in the product brief.

## About the Design Files
The file in this bundle — `reference-design.html` — is a **design reference**, not production code. It's a static, high-fidelity HTML/CSS mockup built to communicate layout, color, type, spacing, and content precisely. It is **not React**, has no state, and none of its buttons/inputs/tables are wired up.

Your job: **recreate these screens in the existing codebase** — React + Vite + Tailwind + shadcn/ui (New York style), using the project's existing component primitives (`Button`, `Input`, `Table`, `Badge`, `Dialog`, `Card`, etc.) and its existing CSS-variable token system in `tailwind.config.ts` / `index.css`. Do not copy raw HTML/inline-styles from the reference file — translate it into idiomatic shadcn/Tailwind components, and extend the token set (see below) rather than introducing a parallel palette.

Open `reference-design.html` directly in a browser to view all 18 screens on one pannable canvas. Each screen has a visible id badge (e.g. "P1 — Player Login", "A5 — Timed Wordle Admin Panel") in the top-left corner of its frame — use these ids to cross-reference this README.

## Fidelity
**High-fidelity.** Colors, type, spacing, and copy shown are final-intent, not placeholders (aside from the two data-entry inputs which show illustrative example values — real inputs are empty by default). Recreate pixel-close using the codebase's own component library rather than the raw markup.

## Design Tokens

The reference uses a warm-beige palette layered on top of the existing shadcn token names. Add these as new CSS variables / Tailwind extensions — **do not replace** existing shadcn tokens, extend them:

### Core surface & text
- `--background`: `oklch(0.975 0.008 80)` — warm near-white app background (screen bodies)
- Canvas/page backdrop (design-review only, not app UI): `oklch(0.94 0.014 75)`
- `--foreground`: `oklch(0.22 0.02 65)` — warm charcoal text
- `--muted-foreground`: `oklch(0.5 0.02 65)`
- `--card`: `oklch(0.995 0.004 85)`
- `--border`: `oklch(0.87 0.016 70)`

### Brand / interactive
- `--primary`: `oklch(0.53 0.15 43)` — terracotta/rust (all primary CTAs, focus rings, active nav pips)
- `--primary-foreground`: `oklch(0.99 0.005 80)` (white text on primary)
- `--secondary`: `oklch(0.91 0.02 75)` — light beige (secondary buttons, chip backgrounds, inactive stepper segments)
- `--accent`: `oklch(0.74 0.13 85)` — warm gold (used sparingly: "Finalist" badge, 1st-place medal chip)

### Status (already-defined `success` / `warning` extended; add `info`)
- `--success`: `oklch(0.56 0.13 148)` (green) — bg tint `oklch(0.93 0.05 148)` — Online dot, Found/Completed badges, correct tiles
- `--warning`: `oklch(0.68 0.15 65)` (orange) — bg tint `oklch(0.94 0.06 75)` — grace-period badge, Ended badge
- `--destructive`: `oklch(0.55 0.19 25)` (red) — bg tint `oklch(0.94 0.05 25)` — End Session actions, Exited badge, invalid-guess text
- `--info` *(new token needed)*: `oklch(0.55 0.14 250)` (blue) — bg tint `oklch(0.91 0.04 250)` — "In Game" badge only (kept a distinct hue from primary/brand per brief)
- Neutral/offline: `oklch(0.68 0.01 70)` dot on `oklch(0.9 0.006 70)` chip

### Wordle tile tokens (extend existing `tile-*`)
- `--tile-green`: `oklch(0.58 0.13 145)`
- `--tile-yellow`: `oklch(0.78 0.14 95)`
- `--tile-gray`: `oklch(0.62 0.012 70)`
- Empty tile: transparent fill, `2px solid oklch(0.85 0.015 70)` border
- **Skipped tile** *(new — see P3 notes)*: `repeating-linear-gradient(135deg, oklch(0.9 0.012 70) 0 6px, oklch(0.855 0.015 70) 6px 12px)` fill + `2px dashed oklch(0.68 0.018 70)` border + small mono "SKIP" tag centered or corner-anchored, text color `oklch(0.46 0.02 70)`

### Typography
- UI/body/headings: **Manrope** (400/500/600/700/800) — Google Font
- Timers, elapsed clocks, mono data (tile letters optional), audit-log timestamps, event/session IDs: **JetBrains Mono** (400/500/700)
- Only 2 families used throughout, no others.

### Radius / shadow scale
- Cards / panels: `12px`–`16px` radius, `1px solid var(--border)`
- Buttons / inputs: `10px`–`12px` radius
- Pills / badges: fully rounded (`999px`)
- Tiles: `7px`–`8px` radius
- Elevated surfaces (toast, admin login card): `0 12px–20px 28px–50px rgba(0,0,0,0.10–0.12)`

## Screens

### Player-facing (mobile-first, build at ~375–430px, then scale up gracefully)

**P1 — Player Login** (`/play/:eventId`)
- Single column, centered logo mark (44px rounded-square, primary bg, white "L") + wordmark + event name.
- Phone input: leading "+91" country code, no OTP step. Numeric keyboard on focus.
- Inline error row below input (destructive color, small "!" glyph in a filled circle + text): "This number isn't on the whitelist for this event."
- Full-width primary button "Continue".
- Footer helper text, muted, small.
- States: idle → submitting (button shows loading spinner, disabled) → error (as above) → success (navigate to lobby).

**P2 — Waiting Lobby** *(not yet built in codebase)*
- Minimal header: event name + status pill ("Prelims", info-blue).
- Center-stage: large mono countdown (`HH:MM:SS`), caption "until Prelims opens", secondary line "Opens at 3:00 PM IST".
- Bottom: full-width disabled button reading "Waiting for round to open" pre-open; becomes an enabled primary "Start" CTA when the round opens (same slot, swap disabled→enabled state, don't reflow).
- Other states (build all, not shown as separate frames): already-completed → auto-redirect to results; window closed without playing → replace center block with a muted "You missed this round's window" message, no countdown.

**P3 — Timed Wordle Game** (`/play/:eventId/game`)
- Top HUD row: mono countdown timer (large, 26–28px) + grace badge (dashed warning-colored pill, only rendered while grace is active) on the left; "Try X / 6" pill on the right.
- 6×5 tile grid, centered, ~44px tiles, 7px gap.
- On-screen QWERTY keyboard below, per-key hint coloring updates live (default/gray secondary bg → green/yellow/gray once a letter's best-known state is determined). Physical keyboard input must work identically.
- **Skipped-try row (open design item, resolved here):** when a try is skipped, its row renders with the hatched/dashed "skipped" tile treatment described in Design Tokens above, not a plain dash — visually distinct from both empty future rows (clean dashed outline, no fill) and played rows (solid color fill). Reference file shows this at row 3 of the grid.
- Row above the active row = most recent play; rows below = empty/future (plain dashed outline tiles).

**P4 — Timed Wordle Results**
- Reveal banner (colored by success/destructive depending on found/not-found): secret word (large, letter-spaced, uppercase) + italic dictionary definition beneath, headline like "Found in 4 tries" / "Not found — time's up".
- 3-up stat row: Time Taken (or "6:00" if not found) / Tries Used ("X / 6") / Tile Score — equal-width cards, mono numerals.
- Rank card: "Your rank" label + large rank number + "of N" pill. If leaderboard isn't finalized, replace the rank number with a "Pending" badge instead — same card layout.

**P5 — Notification Toast** (cross-cutting, not a route)
- Elevated card, top-of-screen, dismissible (× top-right), small colored icon chip on the left (success check for advancement messages, info "i" for generic admin messages).
- Title line (bold) + meta line (muted, smaller: context + relative timestamp).
- Persistence requirement: any toast triggered while the player is disconnected must be stored and re-shown (as a in-app banner/list, not necessarily a floating toast) on their next login — needs a small unread-notifications data model, not just ephemeral toast state.

**P6 — UNWORDLE Waiting/Locked Screen**
- Same lobby shell as P2 but distinct copy/badge: gold "YOU'RE A FINALIST" pill at top, centered lock icon, message "Waiting for the admin to start your Playoffs round", small "UNWORDLE · Round 2" context line.

**P7 — UNWORDLE Game Screen**
- Header: game name left, mono **count-up** stopwatch right ("elapsed" label under it) — never render a deadline or countdown anywhere on this screen.
- 4 independent rows, each 5 tiles pre-colored per that row's fixed pattern (colors are given, not guessed).
- Solved row: shows the accepted word in the tiles + small green checkmark chip beside it, locked (no longer editable).
- Row currently being worked: below its tile pattern, show a scoped guess-input area — text field (mono, letter-spaced) + "Submit" button + a one-line instruction ("Row 2 · enter a 5-letter word matching this pattern"). Any row can be selected/worked in any order; tapping a different unsolved row should move this input area to scope that row instead.
- Inline rejection reasons appear directly under the input in destructive-colored small text, one at a time, worded specifically: not-a-word / green-letter-mismatch / yellow-in-wrong-position / gray-letter-present-in-solution.
- All-4-solved → auto-transition to P8. Admin force-end mid-session → reveal all 4 answers simultaneously and lock all further input (freeze the screen, show a banner similar to P8's "Ended" status).

**P8 — UNWORDLE Results Screen**
- Status badge top-left (Completed/Ended/Exited, standard status-badge colors) + mono total elapsed time top-right.
- Headline metric, large and centered: "3 of 4" / "rows solved" — this must be visually bigger/more prominent than the elapsed time.
- Per-row breakdown table: columns ROW (with ✓/✕), WORD (accepted word, or the revealed answer in destructive color if unsolved), TRIES, INVALID SUBMISSIONS. Unsolved rows get a subtle destructive-tinted row background.
- Leaderboard-rank card at the bottom (same pattern as P4), or "Not ranked" if the player voluntarily exited.

### Admin-facing (desktop-first, ~1200–1280px content width, graceful tablet reflow)

**A1 — Admin Login** (`/admin`, already built)
- Centered card, ~400px: "Shared secret key" (password-masked input) + free-text "Your name (for the audit log)" input + primary "Enter console" button. Small caption clarifying the name is attribution-only, not a real account.

**A2 — Admin Dashboard Home / Event List**
- Page header: "Events" title + primary "+ Create Event" button, right-aligned.
- Table: NAME / STATUS (badge) / CREATED / COHORT SIZE columns. Row click → Event Control Center (A4). Empty state: same table shell with a centered "No events yet — create your first event" message + the same Create Event button.

**A3 — Event Setup / Cohort Upload**
- Two-column layout. Left: event name, timezone (defaults IST), Top-N numeric field (5–50) for prelims cutoff, winner-count numeric field (3–5). Right: CSV dropzone (states copy for accepted columns `mobile_number` + optional `display_name`, max 600, notes duplicate detection) → success summary chip ("587 uploaded · 3 duplicates skipped") → an inline mono list of the specific skipped line numbers/numbers when duplicates are found.
- States: draft (empty dropzone) → validating (spinner in dropzone) → uploaded (summary + line list as shown).

**A4 — Event Control Center**
- Event name heading.
- Horizontal status stepper, 7 segments (Draft → Cohort Uploaded → Prelims Live → Prelims Closed → Playoffs Live → Playoffs Closed → Archived): completed/current segments in primary color, upcoming segments in secondary/muted, joined into one pill-shaped bar (rounded only at the two ends).
- 3-up quick-stat row: cohort size / players online now (success-colored number) / players completed.
- 5-up nav-card grid linking to: Prelims Panel (A5), Playoffs Panel (A8), Cutoff Tool (A7), Winners (A9), Audit Log (A10).

**A5 — Timed Wordle Admin Panel (Prelims control)**
- Puzzle-setup bar: secret word (mono) + definition text + round status pill + "Open/Close Round" toggle button (destructive-styled when it will close).
- Toolbar row: search input, status filter chips (All/Online/In Game/Post-Game), sort dropdown ("Last activity").
- **Session monitor table** (the core shared component, reused conceptually in A8): checkbox column, player name, presence dot+label (Online/Offline), state badge ("In Game — Try X/6" info-blue / "Idle" secondary / "Post-Game" success), last-activity (mono relative time), live elapsed (mono), per-row "End" action (destructive text link). Footer note: "Virtualized · showing N of 587" — **must actually virtualize/paginate**, this table can have up to 600 live-updating rows.
- Bulk-action bar: selected count + "End Selected" + "End All (N)" buttons, each destructive-styled and gated behind a confirm dialog stating the exact affected count.
- Clock-adjust widget: player-picker chip, −/+ stepper for seconds, scope toggle (segmented: "whole session" vs "this try only", primary-highlighted for the active choice).
- Mini live-leaderboard preview table: rank, player, found?, time, tries, score.

**A6 — Messaging Panel**
- Left column: recipient picker (chips; supports search + multi-select or a single "All players (N)" chip), canned-template dropdown, free-text message textarea, primary "Send" button.
- Right column: per-recipient delivery-status list, each row a name + a "Live" (success) or "Queued" (warning) status chip.

**A7 — Prelims → Playoffs Cutoff Tool**
- Top bar: "Advance top [N] of [total] players" (N is the editable numeric field) + a prominent primary button reading "Advance to Playoffs — N players" (count updates live with the field and any manual include/exclude toggles).
- Full ranked table (RANK/PLAYER/FOUND/TIME/TRIES/SCORE) with a **visible dashed cutoff divider line** drawn across the table at the configured rank, labeled "CUTOFF · TOP N".
- Rows just past the cutoff that were manually included show a small annotation (e.g. "(admin-ended, borderline)") and a "+ include" action; this is a manual override list, not automatic.
- Confirm action shows the exact advancing count and triggers notifications (P5 toast) to all advancing players.

**A8 — UNWORDLE Admin Panel (Playoffs control)**
- Puzzle setup: solution word (mono) + 4 row-pattern editors (5 small color tiles each, editable), each with a pre-publish validation indicator — green "✓ satisfiable" or destructive "✕ no valid word" — computed against a real word list before the round can be published.
- Per-player session list: name, status badge (Not Started/In Progress/Completed/Ended/Exited — standard status colors), rows solved "X / 4", live elapsed (mono), attempts, per-row individual Start (success-colored) / End (destructive-colored) action depending on current state.
- Single prominent destructive "End Game for Everyone" bulk action, bottom-right, confirm-gated.
- Mini live leaderboard (same pattern as A5).

**A9 — Winners / Prize Selection**
- Finalized ranked leaderboard table (RANK/PLAYER/ROWS/TIME/PLACE).
- Place-selector per row: a dropdown/segmented control showing 1st/2nd/3rd/…(up to configured winner count) or "—" once past the winner count; gold-tinted chip for 1st place specifically.
- Footer actions: secondary "Export summary" + primary "Save winners".

**A10 — Audit Log Viewer**
- Toolbar: search input + 3 filter dropdowns (Event / Action type / Admin).
- Table: TIMESTAMP (mono) / ADMIN / ACTION / TARGET / REASON (muted, optional — many rows have no reason).

## Cross-Cutting Components To Build Once, Reuse Everywhere

1. **StatusBadge** — pill component, variant-driven: `online | offline | inGame | completed | ended | exited | notStarted | idle | draft | prelimsLive | ...`. Colors per the Status token list above. Used in A2, A4, A5, A8, A9, A10 and P2/P4/P8.
2. **PresenceDot** — 7px filled circle, success (online, subtle pulse animation) or neutral (offline), paired with a text label. Used in every session-monitor table.
3. **ConfirmDialog** — one shared dialog for every irreversible action (end session, bulk-end, advance-to-playoffs, save winners). Must interpolate an exact affected count into its body copy ("This will log out 47 users. Continue?").
4. **SessionMonitorTable** — shared table shell (search + filter chips + sort + checkbox column + action column) parameterized by game type; A5 and A8 are two instances of this with different state-badge vocabularies and columns.
5. **WordleTile** — single tile component with `state: correct | present | absent | empty | skipped | pattern` prop (pattern = pre-colored UNWORDLE tile with no letter). The `skipped` state is the new design resolving the open PRD item — see Design Tokens.
6. **Toast/NotificationCenter** — must support both ephemeral live toasts and a persisted "missed while offline" queue shown on next login.
7. **Row-update flash** — admin tables update via websocket push on discrete state changes; give changed rows a brief highlight-flash transition (background flashes to a light primary/accent tint and fades over ~800ms) rather than any per-second re-render.

## Interactions & Behavior Notes
- All primary buttons: standard shadcn `Button` hover/active/focus-visible states (slight darken + ring), no custom hover treatment needed beyond token colors.
- Grace-period badge (P3) and "GRACE" styling should read as elevated urgency without being alarming — dashed warning border, not a solid destructive fill.
- The skipped-tile pattern (repeating diagonal hatch) should be implemented as a CSS `repeating-linear-gradient` background, not an image asset.
- Responsive: player screens (P1–P8) are mobile-first, single column, tested at 375px min width, should scale up gracefully to tablet (still single-column, more breathing room) — never force a desktop layout on them. Admin screens (A1–A10) are desktop-first with graceful (not primary) tablet reflow: tables may switch to horizontal scroll or column-reduction below ~1024px rather than being redesigned as cards.

## State Management (high-level)
- Player session state machine: `idle → whitelist-check → lobby(waiting|open|completed|missed) → in-game(playing|grace|skipped-try|ended) → results(pending|final)`.
- Admin needs live-updating collections (session list, leaderboard) driven by websocket push, not polling — design a store/selector pattern that patches individual rows rather than re-fetching the whole table on every event.
- Notification/toast state needs both a live in-memory queue and a persisted (server-backed) "unseen" list keyed by player.

## Assets
No image/icon assets used — everything is typography, color, and CSS shapes (tiles, dots, badges). The phone-bezel chrome and browser-window chrome seen around each screen in the reference file are **presentational scaffolding for this review only** — do not build actual device frames into the app.

## Files
- `reference-design.html` — all 18 screens, self-contained, open directly in any browser. Pan/scroll to see every screen; each has a visible id badge (P1–P8, A1–A10) matching this README's Screens section.
