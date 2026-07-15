-- Backfill: normalize wl_event_players.mobile_number to a bare 10-digit form
-- (strip everything but digits, keep the last 10) so already-stored rows
-- match the same normalization now applied on cohort upload and login.
-- Skips any row whose normalized form would collide with another row already
-- in the same event, leaving it untouched rather than violating the
-- (event_id, mobile_number) uniqueness the app relies on.
UPDATE public.wl_event_players p
SET mobile_number = right(regexp_replace(p.mobile_number, '[^0-9]', '', 'g'), 10)
WHERE p.mobile_number <> right(regexp_replace(p.mobile_number, '[^0-9]', '', 'g'), 10)
  AND NOT EXISTS (
    SELECT 1 FROM public.wl_event_players p2
    WHERE p2.event_id = p.event_id
      AND p2.id <> p.id
      AND p2.mobile_number = right(regexp_replace(p.mobile_number, '[^0-9]', '', 'g'), 10)
  );
