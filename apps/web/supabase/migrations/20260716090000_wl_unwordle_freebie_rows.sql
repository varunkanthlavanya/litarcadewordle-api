-- ============================================================
-- A row whose given pattern is entirely GREEN has no ambiguity to guess —
-- Green always means "this exact letter, this exact position", so an
-- all-green pattern already fully specifies the solution word. These rows
-- are meant to be a free reveal, not something the player types in. This
-- was never handled at row-creation time, so wl_confirm_cutoff is redefined
-- here to auto-solve them going forward, and any already-created rows/
-- sessions with this problem are backfilled below.
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
  v_uw_puzzle_id bigint;
  v_uw_solution text;
  v_uw_row_patterns jsonb;
  v_uw_all_green boolean[];
  v_uw_freebie_count integer;
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

  SELECT id, solution_word, row_patterns INTO v_uw_puzzle_id, v_uw_solution, v_uw_row_patterns
    FROM public.wl_unwordle_puzzles WHERE event_id = p_event_id;
  IF v_uw_puzzle_id IS NULL THEN
    RAISE EXCEPTION 'Create the UNWORDLE puzzle before advancing players to Playoffs';
  END IF;

  SELECT array_agg(
    (SELECT bool_and(c = 'GREEN') FROM jsonb_array_elements_text(pat) AS c)
    ORDER BY ord
  ) INTO v_uw_all_green
  FROM jsonb_array_elements(v_uw_row_patterns) WITH ORDINALITY AS t(pat, ord);
  v_uw_freebie_count := (SELECT count(*) FROM unnest(v_uw_all_green) AS g WHERE g);

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
      INSERT INTO public.wl_unwordle_sessions (puzzle_id, event_player_id, rows_solved_count)
        VALUES (v_uw_puzzle_id, v_event_player_id, v_uw_freebie_count)
        RETURNING id INTO v_uw_session_id;

      INSERT INTO public.wl_unwordle_rows (session_id, row_index, solved, solved_word)
        SELECT
          v_uw_session_id,
          r,
          COALESCE(v_uw_all_green[r + 1], false),
          CASE WHEN COALESCE(v_uw_all_green[r + 1], false) THEN v_uw_solution ELSE NULL END
        FROM generate_series(0, 3) AS r;
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

-- Backfill: fix any UNWORDLE row already created (via the old version of
-- wl_confirm_cutoff, or the admin's manual session-creation path) whose
-- given pattern is entirely GREEN but wasn't marked solved.
UPDATE public.wl_unwordle_rows r
SET solved = true,
    solved_word = p.solution_word
FROM public.wl_unwordle_sessions s
JOIN public.wl_unwordle_puzzles p ON p.id = s.puzzle_id
WHERE r.session_id = s.id
  AND r.solved = false
  AND (
    SELECT bool_and(c = 'GREEN')
    FROM jsonb_array_elements_text(p.row_patterns -> r.row_index) AS c
  );

-- Recompute rows_solved_count for every session touched by the backfill
-- above (harmless no-op for sessions that already had the right count).
UPDATE public.wl_unwordle_sessions s
SET rows_solved_count = (
  SELECT count(*) FROM public.wl_unwordle_rows r WHERE r.session_id = s.id AND r.solved
)
WHERE s.rows_solved_count <> (
  SELECT count(*) FROM public.wl_unwordle_rows r WHERE r.session_id = s.id AND r.solved
);
