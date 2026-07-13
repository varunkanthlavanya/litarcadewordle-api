import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createType("timed_wordle_puzzle_status", ["SCHEDULED", "OPEN", "CLOSED"]);
  pgm.createType("timed_wordle_session_status", [
    "NOT_STARTED",
    "IN_PROGRESS",
    "FOUND",
    "NOT_FOUND_TRIES",
    "NOT_FOUND_TIME",
    "ADMIN_ENDED",
  ]);
  pgm.createType("timed_wordle_try_status", ["SUBMITTED", "SKIPPED"]);

  pgm.createTable("timed_wordle_puzzles", {
    id: "id",
    event_id: { type: "bigint", notNull: true, unique: true, references: "events", onDelete: "CASCADE" },
    secret_word: { type: "text", notNull: true },
    definition: { type: "text" },
    status: { type: "timed_wordle_puzzle_status", notNull: true, default: "SCHEDULED" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("timed_wordle_sessions", {
    id: "id",
    puzzle_id: { type: "bigint", notNull: true, references: "timed_wordle_puzzles", onDelete: "CASCADE" },
    event_player_id: { type: "bigint", notNull: true, references: "event_players", onDelete: "CASCADE" },
    status: { type: "timed_wordle_session_status", notNull: true, default: "NOT_STARTED" },
    session_started_at: { type: "timestamptz" },
    global_deadline_at: { type: "timestamptz" },
    current_try_number: { type: "integer", notNull: true, default: 1 },
    current_try_started_at: { type: "timestamptz" },
    current_try_budget_ms: { type: "integer" },
    current_try_deadline_at: { type: "timestamptz" },
    grace_active: { type: "boolean", notNull: true, default: false },
    grace_deadline_at: { type: "timestamptz" },
    banked_surplus_ms: { type: "integer", notNull: true, default: 0 },
    found: { type: "boolean", notNull: true, default: false },
    cumulative_time_ms: { type: "integer" },
    tries_used: { type: "integer" },
    tile_score: { type: "integer" },
    game_ended_at: { type: "timestamptz" },
    advanced_to_playoffs: { type: "boolean", notNull: true, default: false },
    advanced_at: { type: "timestamptz" },
    had_admin_clock_adjustment: { type: "boolean", notNull: true, default: false },
    total_adjustment_ms: { type: "integer", notNull: true, default: 0 },
    last_activity_at: { type: "timestamptz" },
  });

  pgm.addConstraint("timed_wordle_sessions", "timed_wordle_sessions_puzzle_player_unique", {
    unique: ["puzzle_id", "event_player_id"],
  });
  pgm.createIndex("timed_wordle_sessions", "puzzle_id");
  pgm.createIndex("timed_wordle_sessions", "status");

  pgm.createTable("timed_wordle_tries", {
    id: "id",
    session_id: { type: "bigint", notNull: true, references: "timed_wordle_sessions", onDelete: "CASCADE" },
    try_number: { type: "integer", notNull: true },
    status: { type: "timed_wordle_try_status", notNull: true },
    guess: { type: "text" },
    feedback: { type: "jsonb" },
    budget_ms: { type: "integer", notNull: true },
    time_used_ms: { type: "integer", notNull: true },
    used_grace: { type: "boolean", notNull: true, default: false },
    resolved_at: { type: "timestamptz", notNull: true },
  });

  pgm.addConstraint("timed_wordle_tries", "timed_wordle_tries_session_try_unique", {
    unique: ["session_id", "try_number"],
  });

  pgm.createTable("timer_adjustments", {
    id: "id",
    session_id: { type: "bigint", notNull: true, references: "timed_wordle_sessions", onDelete: "CASCADE" },
    admin_label: { type: "text", notNull: true },
    scope: { type: "text", notNull: true },
    delta_ms: { type: "integer", notNull: true },
    reason: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("timer_adjustments");
  pgm.dropTable("timed_wordle_tries");
  pgm.dropTable("timed_wordle_sessions");
  pgm.dropTable("timed_wordle_puzzles");
  pgm.dropType("timed_wordle_try_status");
  pgm.dropType("timed_wordle_session_status");
  pgm.dropType("timed_wordle_puzzle_status");
}
