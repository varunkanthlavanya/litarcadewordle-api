import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createType("event_status", [
    "DRAFT",
    "COHORT_UPLOADED",
    "PRELIMS_SCHEDULED",
    "PRELIMS_LIVE",
    "PRELIMS_CLOSED",
    "PLAYOFFS_SCHEDULED",
    "PLAYOFFS_LIVE",
    "PLAYOFFS_CLOSED",
    "ARCHIVED",
  ]);

  pgm.createTable("events", {
    id: "id",
    name: { type: "text", notNull: true },
    status: { type: "event_status", notNull: true, default: "DRAFT" },
    timezone: { type: "text", notNull: true, default: "Asia/Kolkata" },
    round_opens_at: { type: "timestamptz" },
    round_closes_at: { type: "timestamptz" },
    prelims_top_n: { type: "integer" },
    playoffs_winner_count: { type: "integer" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("event_players", {
    id: "id",
    event_id: { type: "bigint", notNull: true, references: "events", onDelete: "CASCADE" },
    mobile_number: { type: "text", notNull: true },
    display_name: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("event_players", "event_players_event_mobile_unique", {
    unique: ["event_id", "mobile_number"],
  });

  pgm.createTable("player_login_sessions", {
    id: "id",
    event_player_id: { type: "bigint", notNull: true, references: "event_players", onDelete: "CASCADE" },
    token_hash: { type: "text", notNull: true, unique: true },
    issued_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    expires_at: { type: "timestamptz", notNull: true },
    last_seen_at: { type: "timestamptz" },
    revoked_at: { type: "timestamptz" },
  });

  pgm.createIndex("player_login_sessions", "token_hash");
  pgm.createIndex("event_players", "event_id");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("player_login_sessions");
  pgm.dropTable("event_players");
  pgm.dropTable("events");
  pgm.dropType("event_status");
}
