-- ============================================================
-- Schedules the wl-sweep edge function (see supabase/functions/wl-sweep)
-- every minute as a safety net for Timed Wordle sessions nobody is actively
-- polling — matches this project's own existing pattern for cron-invoked
-- edge functions (see e.g. the generate-daily-puzzles migration).
--
-- BEFORE RUNNING THIS MIGRATION:
--   1. Replace YOUR_PROJECT_REF below with this project's actual ref (the
--      same one used everywhere else, e.g. in src/integrations/supabase/client.ts).
--   2. Generate your own random secret and set it in TWO places so they match:
--        a. Supabase Edge Function secret: CRON_SECRET=<your-secret>
--        b. The v_secret literal below
--      This is a separate, narrowly-scoped secret — deliberately NOT the
--      service-role key, so nothing catastrophic leaks if this migration
--      file (which gets committed to git) is ever exposed.
-- ============================================================
DO $$
DECLARE
  v_secret text := 'REPLACE_WITH_YOUR_OWN_RANDOM_CRON_SECRET';
  v_base text := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/';
  v_headers text;
BEGIN
  v_headers := format('{"Content-Type":"application/json","x-cron-secret":"%s"}', v_secret);

  PERFORM cron.unschedule('wl-sweep') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wl-sweep');
  PERFORM cron.schedule(
    'wl-sweep',
    '* * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=%L::jsonb, body:='{}'::jsonb);$f$, v_base || 'wl-sweep', v_headers)
  );
END $$;
