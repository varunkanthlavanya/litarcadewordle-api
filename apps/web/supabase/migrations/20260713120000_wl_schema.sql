-- ============================================================
-- LitArcadeWordle ("Wordle League") tournament module schema
-- Every table/type is prefixed wl_ to guarantee no collision with
-- this project's existing (unrelated) tables. Faithful port of the
-- original node-pg-migrate migrations (apps/api/src/db/migrations).
-- RLS is enabled with NO policies on every table: all access goes
-- through Supabase Edge Functions using the service-role key, which
-- bypasses RLS entirely and independently validates bearer tokens —
-- so enabling RLS with zero policies denies anon/authenticated
-- clients by default while leaving edge-function access unaffected.
-- ============================================================

-- 1) Admin sessions + audit log
-- ------------------------------------------------------------
CREATE TABLE public.wl_admin_sessions (
  id bigserial PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  name_label text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_address text
);
CREATE INDEX idx_wl_admin_sessions_token_hash ON public.wl_admin_sessions(token_hash);
ALTER TABLE public.wl_admin_sessions ENABLE ROW LEVEL SECURITY;

-- Edge functions are stateless across invocations, unlike the original
-- Express process's in-memory rate limiter — this table replaces it so
-- the admin-login rate limit (5 attempts / 15 min / IP) actually holds.
CREATE TABLE public.wl_login_attempts (
  id bigserial PRIMARY KEY,
  ip_address text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wl_login_attempts_ip_time ON public.wl_login_attempts(ip_address, attempted_at);
ALTER TABLE public.wl_login_attempts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.wl_audit_log (
  id bigserial PRIMARY KEY,
  admin_label text NOT NULL,
  event_id bigint,
  action_type text NOT NULL,
  target_type text,
  target_ids jsonb,
  reason text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wl_audit_log_event_id ON public.wl_audit_log(event_id);
CREATE INDEX idx_wl_audit_log_created_at ON public.wl_audit_log(created_at);
ALTER TABLE public.wl_audit_log ENABLE ROW LEVEL SECURITY;

-- 2) Events + players
-- ------------------------------------------------------------
CREATE TYPE public.wl_event_status AS ENUM (
  'DRAFT', 'COHORT_UPLOADED', 'PRELIMS_SCHEDULED', 'PRELIMS_LIVE', 'PRELIMS_CLOSED',
  'PLAYOFFS_SCHEDULED', 'PLAYOFFS_LIVE', 'PLAYOFFS_CLOSED', 'ARCHIVED'
);

CREATE TABLE public.wl_events (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  status public.wl_event_status NOT NULL DEFAULT 'DRAFT',
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  round_opens_at timestamptz,
  round_closes_at timestamptz,
  prelims_top_n integer,
  playoffs_winner_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wl_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.wl_event_players (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES public.wl_events(id) ON DELETE CASCADE,
  mobile_number text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, mobile_number)
);
CREATE INDEX idx_wl_event_players_event_id ON public.wl_event_players(event_id);
ALTER TABLE public.wl_event_players ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.wl_player_login_sessions (
  id bigserial PRIMARY KEY,
  event_player_id bigint NOT NULL REFERENCES public.wl_event_players(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX idx_wl_player_login_sessions_token_hash ON public.wl_player_login_sessions(token_hash);
ALTER TABLE public.wl_player_login_sessions ENABLE ROW LEVEL SECURITY;

-- 3) Timed Wordle (Prelims)
-- ------------------------------------------------------------
CREATE TYPE public.wl_timed_wordle_puzzle_status AS ENUM ('SCHEDULED', 'OPEN', 'CLOSED');
CREATE TYPE public.wl_timed_wordle_session_status AS ENUM (
  'NOT_STARTED', 'IN_PROGRESS', 'FOUND', 'NOT_FOUND_TRIES', 'NOT_FOUND_TIME', 'ADMIN_ENDED'
);
CREATE TYPE public.wl_timed_wordle_try_status AS ENUM ('SUBMITTED', 'SKIPPED');

CREATE TABLE public.wl_timed_wordle_puzzles (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL UNIQUE REFERENCES public.wl_events(id) ON DELETE CASCADE,
  secret_word text NOT NULL,
  definition text,
  status public.wl_timed_wordle_puzzle_status NOT NULL DEFAULT 'SCHEDULED',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wl_timed_wordle_puzzles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.wl_timed_wordle_sessions (
  id bigserial PRIMARY KEY,
  puzzle_id bigint NOT NULL REFERENCES public.wl_timed_wordle_puzzles(id) ON DELETE CASCADE,
  event_player_id bigint NOT NULL REFERENCES public.wl_event_players(id) ON DELETE CASCADE,
  status public.wl_timed_wordle_session_status NOT NULL DEFAULT 'NOT_STARTED',
  session_started_at timestamptz,
  global_deadline_at timestamptz,
  current_try_number integer NOT NULL DEFAULT 1,
  current_try_started_at timestamptz,
  current_try_budget_ms integer,
  current_try_deadline_at timestamptz,
  grace_active boolean NOT NULL DEFAULT false,
  grace_deadline_at timestamptz,
  banked_surplus_ms integer NOT NULL DEFAULT 0,
  found boolean NOT NULL DEFAULT false,
  cumulative_time_ms integer,
  tries_used integer,
  tile_score integer,
  game_ended_at timestamptz,
  advanced_to_playoffs boolean NOT NULL DEFAULT false,
  advanced_at timestamptz,
  had_admin_clock_adjustment boolean NOT NULL DEFAULT false,
  total_adjustment_ms integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz,
  row_version integer NOT NULL DEFAULT 0,
  UNIQUE (puzzle_id, event_player_id)
);
CREATE INDEX idx_wl_tw_sessions_puzzle_id ON public.wl_timed_wordle_sessions(puzzle_id);
CREATE INDEX idx_wl_tw_sessions_status ON public.wl_timed_wordle_sessions(status);
ALTER TABLE public.wl_timed_wordle_sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.wl_timed_wordle_tries (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES public.wl_timed_wordle_sessions(id) ON DELETE CASCADE,
  try_number integer NOT NULL,
  status public.wl_timed_wordle_try_status NOT NULL,
  guess text,
  feedback jsonb,
  budget_ms integer NOT NULL,
  time_used_ms integer NOT NULL,
  used_grace boolean NOT NULL DEFAULT false,
  resolved_at timestamptz NOT NULL,
  UNIQUE (session_id, try_number)
);
ALTER TABLE public.wl_timed_wordle_tries ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.wl_timer_adjustments (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES public.wl_timed_wordle_sessions(id) ON DELETE CASCADE,
  admin_label text NOT NULL,
  scope text NOT NULL,
  delta_ms integer NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wl_timer_adjustments ENABLE ROW LEVEL SECURITY;

-- 4) Notifications
-- ------------------------------------------------------------
CREATE TYPE public.wl_notification_type AS ENUM ('ADVANCED', 'ADMIN_MESSAGE');

CREATE TABLE public.wl_notifications (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES public.wl_events(id) ON DELETE CASCADE,
  event_player_id bigint NOT NULL REFERENCES public.wl_event_players(id) ON DELETE CASCADE,
  type public.wl_notification_type NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_by_admin_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  read_at timestamptz
);
CREATE INDEX idx_wl_notifications_event_player_id ON public.wl_notifications(event_player_id);
CREATE INDEX idx_wl_notifications_created_at ON public.wl_notifications(created_at);
ALTER TABLE public.wl_notifications ENABLE ROW LEVEL SECURITY;

-- 5) UNWORDLE (Playoffs)
-- ------------------------------------------------------------
CREATE TYPE public.wl_unwordle_puzzle_status AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE public.wl_unwordle_session_status AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ENDED', 'EXITED');

CREATE TABLE public.wl_unwordle_puzzles (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL UNIQUE REFERENCES public.wl_events(id) ON DELETE CASCADE,
  solution_word text NOT NULL,
  row_patterns jsonb NOT NULL,
  status public.wl_unwordle_puzzle_status NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wl_unwordle_puzzles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.wl_unwordle_sessions (
  id bigserial PRIMARY KEY,
  puzzle_id bigint NOT NULL REFERENCES public.wl_unwordle_puzzles(id) ON DELETE CASCADE,
  event_player_id bigint NOT NULL REFERENCES public.wl_event_players(id) ON DELETE CASCADE,
  status public.wl_unwordle_session_status NOT NULL DEFAULT 'NOT_STARTED',
  start_time timestamptz,
  stop_time timestamptz,
  rows_solved_count integer NOT NULL DEFAULT 0,
  total_time_ms integer NOT NULL DEFAULT 0,
  total_attempts integer NOT NULL DEFAULT 0,
  total_invalid_submissions integer NOT NULL DEFAULT 0,
  excluded_from_leaderboard boolean NOT NULL DEFAULT false,
  last_activity_at timestamptz,
  row_version integer NOT NULL DEFAULT 0,
  UNIQUE (puzzle_id, event_player_id)
);
CREATE INDEX idx_wl_uw_sessions_puzzle_id ON public.wl_unwordle_sessions(puzzle_id);
CREATE INDEX idx_wl_uw_sessions_status ON public.wl_unwordle_sessions(status);
ALTER TABLE public.wl_unwordle_sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.wl_unwordle_rows (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES public.wl_unwordle_sessions(id) ON DELETE CASCADE,
  row_index integer NOT NULL,
  solved boolean NOT NULL DEFAULT false,
  solved_word text,
  solved_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  invalid_submissions integer NOT NULL DEFAULT 0,
  UNIQUE (session_id, row_index)
);
ALTER TABLE public.wl_unwordle_rows ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.wl_unwordle_row_attempts (
  id bigserial PRIMARY KEY,
  row_id bigint NOT NULL REFERENCES public.wl_unwordle_rows(id) ON DELETE CASCADE,
  guess_word text NOT NULL,
  is_valid_word boolean NOT NULL,
  satisfies_tiles boolean NOT NULL,
  failed_tile_reasons jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wl_uw_row_attempts_row_id ON public.wl_unwordle_row_attempts(row_id);
ALTER TABLE public.wl_unwordle_row_attempts ENABLE ROW LEVEL SECURITY;

-- 6) Winners
-- ------------------------------------------------------------
CREATE TABLE public.wl_event_winners (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES public.wl_events(id) ON DELETE CASCADE,
  event_player_id bigint NOT NULL REFERENCES public.wl_event_players(id) ON DELETE CASCADE,
  place integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, event_player_id)
);
ALTER TABLE public.wl_event_winners ENABLE ROW LEVEL SECURITY;
