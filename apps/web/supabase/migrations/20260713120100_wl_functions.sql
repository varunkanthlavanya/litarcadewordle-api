-- ============================================================
-- Postgres functions for wl_* tables.
--
-- Design principle: game/business logic (timer transitions, tile
-- scoring, leaderboard ranking/tie-breaks) stays in TypeScript inside
-- the edge functions, ported verbatim from apps/api's engine files —
-- these SQL functions only do genuinely relational, logic-free
-- bookkeeping that benefits from being one atomic transaction.
-- ============================================================

-- Confirms the Prelims -> Playoffs cutoff in one transaction: creates each
-- advancing player's UNWORDLE session (+4 rows) if missing, marks their
-- Timed Wordle session advanced, writes their "advanced" notification,
-- moves the event to PLAYOFFS_SCHEDULED, and writes the audit log entry.
-- p_advancing is pre-computed by the edge function (it already knows each
-- player's rank from the same TS leaderboard comparator used everywhere
-- else) as: [{"sessionId": 1, "eventPlayerId": 2, "rank": 3}, ...]
CREATE OR REPLACE FUNCTION public.wl_confirm_cutoff(
  p_event_id bigint,
  p_admin_label text,
  p_advancing jsonb
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_tw_puzzle_id bigint;
  v_uw_puzzle_id bigint;
  v_entry jsonb;
  v_event_player_id bigint;
  v_session_id bigint;
  v_rank integer;
  v_uw_session_id bigint;
  v_advanced_count integer := 0;
  v_target_ids jsonb := '[]'::jsonb;
BEGIN
  SELECT id INTO v_tw_puzzle_id FROM public.wl_timed_wordle_puzzles WHERE event_id = p_event_id;
  IF v_tw_puzzle_id IS NULL THEN
    RAISE EXCEPTION 'No Timed Wordle puzzle exists for this event yet';
  END IF;

  SELECT id INTO v_uw_puzzle_id FROM public.wl_unwordle_puzzles WHERE event_id = p_event_id;
  IF v_uw_puzzle_id IS NULL THEN
    RAISE EXCEPTION 'Create the UNWORDLE puzzle before advancing players to Playoffs';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_advancing)
  LOOP
    v_event_player_id := (v_entry->>'eventPlayerId')::bigint;
    v_session_id := (v_entry->>'sessionId')::bigint;
    v_rank := (v_entry->>'rank')::integer;

    -- Find or create the UNWORDLE session (+ 4 rows) for this player.
    SELECT id INTO v_uw_session_id
      FROM public.wl_unwordle_sessions
      WHERE puzzle_id = v_uw_puzzle_id AND event_player_id = v_event_player_id;

    IF v_uw_session_id IS NULL THEN
      INSERT INTO public.wl_unwordle_sessions (puzzle_id, event_player_id)
        VALUES (v_uw_puzzle_id, v_event_player_id)
        RETURNING id INTO v_uw_session_id;

      INSERT INTO public.wl_unwordle_rows (session_id, row_index)
        SELECT v_uw_session_id, r FROM generate_series(0, 3) AS r;
    END IF;

    UPDATE public.wl_timed_wordle_sessions
      SET advanced_to_playoffs = true, advanced_at = now()
      WHERE id = v_session_id;

    INSERT INTO public.wl_notifications (event_id, event_player_id, type, title, body, created_by_admin_label)
      VALUES (
        p_event_id,
        v_event_player_id,
        'ADVANCED',
        'You''ve advanced to the Playoffs!',
        format('Ranked #%s in Prelims — head to the Playoffs lobby when you''re ready.', v_rank),
        p_admin_label
      );

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
