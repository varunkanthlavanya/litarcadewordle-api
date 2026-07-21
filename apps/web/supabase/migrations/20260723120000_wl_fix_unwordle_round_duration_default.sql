-- ============================================================
-- Fixes a default-value drift introduced by a separate, defensive
-- migration (20260721095618_..., applied directly against the live DB to
-- recover from a "column doesn't exist" deploy error): it re-added
-- wl_events.unwordle_round_duration_ms with DEFAULT 1800000 (30 min)
-- instead of the 2700000 (45 min) this column was originally specified
-- with in 20260721120000_wl_unwordle_playoffs_round.sql. Any event
-- created since without an explicit round-length save has been silently
-- defaulting to 30 minutes instead of 45.
--
-- 1. Corrects the column default going forward.
-- 2. One-time backfill, narrowly targeted: only rows sitting at exactly
--    the wrong default (1800000) are bumped to 2700000 — an event where
--    an admin explicitly chose some other duration via the Cohort &
--    Settings UI is left untouched.
-- ============================================================

ALTER TABLE public.wl_events ALTER COLUMN unwordle_round_duration_ms SET DEFAULT 2700000;

UPDATE public.wl_events
SET unwordle_round_duration_ms = 2700000
WHERE unwordle_round_duration_ms = 1800000;
