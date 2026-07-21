-- ============================================================
-- UNWORDLE Playoffs — continuous round mode.
--
-- Replaces "one puzzle, one attempt, done" with a bank of N puzzles
-- (default 25, configurable per event) played in a fixed order until an
-- admin-configured round duration (default 45 min) elapses. See
-- PRD/UNWORDLE_PLAYOFFS_ROUND_PRD.md (Revision 3) for the full spec.
--
-- 1. wl_events gets two config columns (bank size, round duration) and two
--    round-clock columns (started-at, ends-at — the latter is the single
--    authoritative deadline; "End Round Now" just moves it to now()).
-- 2. wl_unwordle_puzzles goes from "exactly one row per event" to "up to N
--    rows per event, ordered by puzzle_number" — the old UNIQUE(event_id)
--    is dropped (found dynamically, not by a guessed constraint name) and
--    replaced with UNIQUE(event_id, puzzle_number).
-- 3. wl_provision_unwordle_sessions (added in the immediately-prior cutoff
--    fix) is dropped outright rather than adapted: its SELECT ... INTO
--    assumed exactly one puzzle per event, which is no longer true, and a
--    stray call would now bind unpredictably to whichever puzzle Postgres
--    processes last. Session creation now happens only at the deliberate
--    "Start Round" action (a TypeScript edge-function handler, matching
--    this codebase's existing session/startAll convention), never
--    automatically at cutoff-confirm or puzzle-creation time anymore —
--    every player's clock has to start together for the round to be fair.
-- 4. wl_confirm_cutoff is redefined with its trailing provisioning call
--    removed; every other line (the un-advance loop, notifications, audit
--    log, event status update) is unchanged from the prior revision.
-- ============================================================

ALTER TABLE public.wl_events
  ADD COLUMN unwordle_bank_size integer NOT NULL DEFAULT 25,
  ADD COLUMN unwordle_round_duration_ms integer NOT NULL DEFAULT 2700000, -- 45 min
  ADD COLUMN unwordle_round_started_at timestamptz,
  ADD COLUMN unwordle_round_ends_at timestamptz;

-- Drop whatever the actual (possibly auto-generated) name of the existing
-- single-column UNIQUE(event_id) constraint is, without hardcoding a
-- guessed name that was never verified against the live database.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.wl_unwordle_puzzles'::regclass
    AND contype = 'u'
    AND conkey = ARRAY[
      (SELECT attnum FROM pg_attribute
       WHERE attrelid = 'public.wl_unwordle_puzzles'::regclass AND attname = 'event_id')
    ];
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.wl_unwordle_puzzles DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.wl_unwordle_puzzles ADD COLUMN puzzle_number integer NOT NULL DEFAULT 1;
ALTER TABLE public.wl_unwordle_puzzles
  ADD CONSTRAINT wl_unwordle_puzzles_event_puzzle_number_key UNIQUE (event_id, puzzle_number);

DROP FUNCTION IF EXISTS public.wl_provision_unwordle_sessions(bigint);

CREATE OR REPLACE FUNCTION public.wl_confirm_cutoff(
  p_event_id bigint,
  p_admin_label text,
  p_advancing jsonb
) RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tw_puzzle_id bigint;
  v_entry jsonb;
  v_event_player_id bigint;
  v_session_id bigint;
  v_rank integer;
  v_advanced_count integer := 0;
  v_target_ids jsonb := '[]'::jsonb;
  v_advancing_ids bigint[];
  v_removed record;
BEGIN
  SELECT id INTO v_tw_puzzle_id FROM public.wl_timed_wordle_puzzles WHERE event_id = p_event_id;
  IF v_tw_puzzle_id IS NULL THEN
    RAISE EXCEPTION 'No Timed Wordle puzzle exists for this event yet';
  END IF;

  SELECT COALESCE(array_agg((e->>'eventPlayerId')::bigint), ARRAY[]::bigint[]) INTO v_advancing_ids
    FROM jsonb_array_elements(p_advancing) AS e;

  -- Un-advance anyone previously advanced who isn't in the current set.
  FOR v_removed IN
    SELECT tws.id AS session_id, tws.event_player_id
    FROM public.wl_timed_wordle_sessions tws
    WHERE tws.puzzle_id = v_tw_puzzle_id
      AND tws.advanced_to_playoffs = true
      AND NOT (tws.event_player_id = ANY(v_advancing_ids))
  LOOP
    UPDATE public.wl_timed_wordle_sessions
      SET advanced_to_playoffs = false, advanced_at = null
      WHERE id = v_removed.session_id;

    DELETE FROM public.wl_unwordle_sessions uws
      USING public.wl_unwordle_puzzles uwp
      WHERE uws.puzzle_id = uwp.id
        AND uwp.event_id = p_event_id
        AND uws.event_player_id = v_removed.event_player_id
        AND uws.status = 'NOT_STARTED'
        AND uws.total_attempts = 0;
  END LOOP;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_advancing)
  LOOP
    v_event_player_id := (v_entry->>'eventPlayerId')::bigint;
    v_session_id := (v_entry->>'sessionId')::bigint;
    v_rank := (v_entry->>'rank')::integer;

    UPDATE public.wl_timed_wordle_sessions
      SET advanced_to_playoffs = true, advanced_at = now()
      WHERE id = v_session_id AND advanced_to_playoffs IS DISTINCT FROM true;

    -- Only notify the first time a player actually flips to advanced —
    -- a re-run that just confirms the same set again shouldn't re-notify.
    IF FOUND THEN
      INSERT INTO public.wl_notifications (event_id, event_player_id, type, title, body, created_by_admin_label)
        VALUES (
          p_event_id,
          v_event_player_id,
          'ADVANCED',
          'You''ve advanced to the Playoffs!',
          format('Ranked #%s in Prelims — head to the Playoffs lobby when you''re ready.', v_rank),
          p_admin_label
        );
    END IF;

    v_advanced_count := v_advanced_count + 1;
    v_target_ids := v_target_ids || to_jsonb(v_event_player_id);
  END LOOP;

  UPDATE public.wl_events SET status = 'PLAYOFFS_SCHEDULED' WHERE id = p_event_id;

  INSERT INTO public.wl_audit_log (admin_label, event_id, action_type, target_type, target_ids, metadata)
    VALUES (
      p_admin_label,
      p_event_id,
      'ADVANCED_TO_PLAYOFFS',
      'event_player',
      v_target_ids,
      jsonb_build_object('advancedCount', v_advanced_count)
    );

  RETURN v_advanced_count;
END;
$$;
