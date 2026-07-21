-- ============================================================
-- Decouples "admin opens the Playoffs round" from "this player's own
-- 45-minute clock starts". Previously Start Round bulk-created every
-- advanced player's first session and stamped a single event-wide
-- unwordle_round_ends_at deadline the instant the admin clicked the
-- button — so a player who hadn't even opened the game yet was already
-- burning their allotted time. Now Start Round only opens the gate
-- (wl_events.unwordle_round_started_at), and each player's own deadline
-- is stamped here, lazily, the first time THEY actually enter the game.
--
-- wl_events.unwordle_round_ends_at keeps its existing meaning unchanged:
-- it stays null unless an admin explicitly clicks "End Round Now", at
-- which point it force-ends every player regardless of their own
-- personal deadline (see reconcileRoundForPlayer in roundRepo.ts, which
-- now takes the earlier of the two).
-- ============================================================

ALTER TABLE public.wl_event_players ADD COLUMN unwordle_deadline_at timestamptz;
