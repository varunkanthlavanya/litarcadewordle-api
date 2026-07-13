import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createType("notification_type", ["ADVANCED", "ADMIN_MESSAGE"]);

  pgm.createTable("notifications", {
    id: "id",
    event_id: { type: "bigint", notNull: true, references: "events", onDelete: "CASCADE" },
    event_player_id: { type: "bigint", notNull: true, references: "event_players", onDelete: "CASCADE" },
    type: { type: "notification_type", notNull: true },
    title: { type: "text", notNull: true },
    body: { type: "text", notNull: true },
    created_by_admin_label: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    delivered_at: { type: "timestamptz" },
    read_at: { type: "timestamptz" },
  });

  pgm.createIndex("notifications", "event_player_id");
  pgm.createIndex("notifications", "created_at");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("notifications");
  pgm.dropType("notification_type");
}
