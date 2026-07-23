-- ============================================================
-- Player-facing content pass: standardizes on "Finals"/"Finalists"
-- everywhere a player sees the word "Playoffs" — the notification a
-- player receives the moment they're advanced past Prelims is the one
-- piece of this wording that lives in the database (wl_confirm_cutoff),
-- not in frontend copy. Redefines the function identically to its
-- current body (see 20260721120000_wl_unwordle_playoffs_round.sql) with
-- only the notification title/body text changed — never edit an
-- already-applied migration in place, so this is a fresh CREATE OR
-- REPLACE rather than a change to that file.
-- ============================================================

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
          'You''ve advanced to the Finals!',
          format('Ranked #%s in Prelims — head to the Finals lobby when you''re ready.', v_rank),
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
