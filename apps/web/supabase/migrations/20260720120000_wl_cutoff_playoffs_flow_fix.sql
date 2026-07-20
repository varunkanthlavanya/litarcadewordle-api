-- ============================================================
-- Fixes two real bugs in the Prelims -> Playoffs cutoff flow:
--
-- 1. Excluding a player (or shrinking Top N) on a re-run never actually
--    took effect once wl_confirm_cutoff had advanced them once — nothing
--    in the system ever set advanced_to_playoffs back to false. This
--    function now treats p_advancing as the FULL desired set: anyone
--    previously advanced but missing from it gets un-advanced, and their
--    UNWORDLE session is removed too (only if they haven't actually
--    played yet — never destroy real gameplay data).
--
-- 2. wl_confirm_cutoff used to hard-require the UNWORDLE puzzle to already
--    exist, forcing admins into create-puzzle -> re-run-cutoff-on-everyone
--    round trips. Cutoff can now be confirmed at any time regardless of
--    puzzle state; session creation is pulled out into
--    wl_provision_unwordle_sessions(), which is a no-op if the puzzle
--    isn't ready yet and gets (re-)called both here and from the
--    wl-unwordle edge function (puzzle create/publish, and every time the
--    Playoffs admin panel loads sessions) so advanced players' sessions
--    always appear as soon as both a cutoff and a puzzle exist, in
--    whichever order the admin did them.
-- ============================================================

CREATE OR REPLACE FUNCTION public.wl_provision_unwordle_sessions(p_event_id bigint)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uw_puzzle_id bigint;
  v_uw_solution text;
  v_uw_row_patterns jsonb;
  v_uw_all_green boolean[];
  v_uw_freebie_count integer;
  v_row record;
  v_uw_session_id bigint;
  v_count integer := 0;
BEGIN
  SELECT id, solution_word, row_patterns INTO v_uw_puzzle_id, v_uw_solution, v_uw_row_patterns
    FROM public.wl_unwordle_puzzles WHERE event_id = p_event_id;
  IF v_uw_puzzle_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT array_agg(
    (SELECT bool_and(c = 'GREEN') FROM jsonb_array_elements_text(pat) AS c)
    ORDER BY ord
  ) INTO v_uw_all_green
  FROM jsonb_array_elements(v_uw_row_patterns) WITH ORDINALITY AS t(pat, ord);
  v_uw_freebie_count := (SELECT count(*) FROM unnest(v_uw_all_green) AS g WHERE g);

  FOR v_row IN
    SELECT tws.event_player_id
    FROM public.wl_timed_wordle_sessions tws
    JOIN public.wl_timed_wordle_puzzles twp ON twp.id = tws.puzzle_id
    WHERE twp.event_id = p_event_id AND tws.advanced_to_playoffs = true
  LOOP
    SELECT id INTO v_uw_session_id
      FROM public.wl_unwordle_sessions
      WHERE puzzle_id = v_uw_puzzle_id AND event_player_id = v_row.event_player_id;

    IF v_uw_session_id IS NULL THEN
      INSERT INTO public.wl_unwordle_sessions (puzzle_id, event_player_id, rows_solved_count)
        VALUES (v_uw_puzzle_id, v_row.event_player_id, v_uw_freebie_count)
        RETURNING id INTO v_uw_session_id;

      INSERT INTO public.wl_unwordle_rows (session_id, row_index, solved, solved_word)
        SELECT
          v_uw_session_id,
          r,
          COALESCE(v_uw_all_green[r + 1], false),
          CASE WHEN COALESCE(v_uw_all_green[r + 1], false) THEN v_uw_solution ELSE NULL END
        FROM generate_series(0, 3) AS r;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

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

  -- No-op until the UNWORDLE puzzle exists; catches up immediately if it
  -- already does (preserves today's behavior when puzzle-then-cutoff).
  PERFORM public.wl_provision_unwordle_sessions(p_event_id);

  RETURN v_advanced_count;
END;
$$;
