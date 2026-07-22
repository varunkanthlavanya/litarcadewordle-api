-- ============================================================
-- Fixes any event whose unwordle_round_duration_ms was accidentally saved
-- as 0 (or otherwise non-positive) via the Cohort & Settings config form —
-- easy to produce by clearing that number input mid-edit, since
-- Number("") is 0, not NaN, and the config endpoint had no validation
-- rejecting it (fixed alongside this migration).
--
-- A 0ms duration is silently catastrophic under the per-player-clock
-- model (see 20260724120000_wl_unwordle_per_player_timer.sql): the
-- moment any player calls "enter", their personal deadline is stamped as
-- now + 0 = now, which reads as already-expired by the time the response
-- is computed — so every player sees the round as "ended" the instant
-- they open the game, before they ever get to play.
--
-- Only rows sitting at exactly the broken value are corrected, back to
-- the same 45-minute default this column has always shipped with.
-- ============================================================

UPDATE public.wl_events
SET unwordle_round_duration_ms = 2700000
WHERE unwordle_round_duration_ms <= 0;
