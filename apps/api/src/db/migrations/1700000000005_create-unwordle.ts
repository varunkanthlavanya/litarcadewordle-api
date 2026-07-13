import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createType("unwordle_puzzle_status", ["DRAFT", "PUBLISHED"]);
  pgm.createType("unwordle_session_status", ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "ENDED", "EXITED"]);

  pgm.createTable("unwordle_puzzles", {
    id: "id",
    event_id: { type: "bigint", notNull: true, unique: true, references: "events", onDelete: "CASCADE" },
    solution_word: { type: "text", notNull: true },
    row_patterns: { type: "jsonb", notNull: true }, // 4 x 5-array of GREEN/YELLOW/GRAY
    status: { type: "unwordle_puzzle_status", notNull: true, default: "DRAFT" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("unwordle_sessions", {
    id: "id",
    puzzle_id: { type: "bigint", notNull: true, references: "unwordle_puzzles", onDelete: "CASCADE" },
    event_player_id: { type: "bigint", notNull: true, references: "event_players", onDelete: "CASCADE" },
    status: { type: "unwordle_session_status", notNull: true, default: "NOT_STARTED" },
    start_time: { type: "timestamptz" },
    stop_time: { type: "timestamptz" },
    rows_solved_count: { type: "integer", notNull: true, default: 0 },
    total_time_ms: { type: "integer", notNull: true, default: 0 },
    total_attempts: { type: "integer", notNull: true, default: 0 },
    total_invalid_submissions: { type: "integer", notNull: true, default: 0 },
    excluded_from_leaderboard: { type: "boolean", notNull: true, default: false },
    last_activity_at: { type: "timestamptz" },
  });

  pgm.addConstraint("unwordle_sessions", "unwordle_sessions_puzzle_player_unique", {
    unique: ["puzzle_id", "event_player_id"],
  });
  pgm.createIndex("unwordle_sessions", "puzzle_id");
  pgm.createIndex("unwordle_sessions", "status");

  pgm.createTable("unwordle_rows", {
    id: "id",
    session_id: { type: "bigint", notNull: true, references: "unwordle_sessions", onDelete: "CASCADE" },
    row_index: { type: "integer", notNull: true },
    solved: { type: "boolean", notNull: true, default: false },
    solved_word: { type: "text" },
    solved_at: { type: "timestamptz" },
    attempts: { type: "integer", notNull: true, default: 0 },
    invalid_submissions: { type: "integer", notNull: true, default: 0 },
  });

  pgm.addConstraint("unwordle_rows", "unwordle_rows_session_row_unique", {
    unique: ["session_id", "row_index"],
  });

  pgm.createTable("unwordle_row_attempts", {
    id: "id",
    row_id: { type: "bigint", notNull: true, references: "unwordle_rows", onDelete: "CASCADE" },
    guess_word: { type: "text", notNull: true },
    is_valid_word: { type: "boolean", notNull: true },
    satisfies_tiles: { type: "boolean", notNull: true },
    failed_tile_reasons: { type: "jsonb" },
    submitted_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("unwordle_row_attempts", "row_id");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("unwordle_row_attempts");
  pgm.dropTable("unwordle_rows");
  pgm.dropTable("unwordle_sessions");
  pgm.dropTable("unwordle_puzzles");
  pgm.dropType("unwordle_session_status");
  pgm.dropType("unwordle_puzzle_status");
}
