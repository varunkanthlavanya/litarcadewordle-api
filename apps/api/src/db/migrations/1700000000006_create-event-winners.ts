import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("event_winners", {
    id: "id",
    event_id: { type: "bigint", notNull: true, references: "events", onDelete: "CASCADE" },
    event_player_id: { type: "bigint", notNull: true, references: "event_players", onDelete: "CASCADE" },
    place: { type: "integer", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("event_winners", "event_winners_event_player_unique", {
    unique: ["event_id", "event_player_id"],
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("event_winners");
}
