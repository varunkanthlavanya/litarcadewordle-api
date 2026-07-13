import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("admin_sessions", {
    id: "id",
    token_hash: { type: "text", notNull: true, unique: true },
    name_label: { type: "text", notNull: true },
    issued_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    expires_at: { type: "timestamptz", notNull: true },
    revoked_at: { type: "timestamptz" },
    ip_address: { type: "text" },
  });

  pgm.createIndex("admin_sessions", "token_hash");

  pgm.createTable("audit_log", {
    id: "id",
    admin_label: { type: "text", notNull: true },
    event_id: { type: "bigint" },
    action_type: { type: "text", notNull: true },
    target_type: { type: "text" },
    target_ids: { type: "jsonb" },
    reason: { type: "text" },
    metadata: { type: "jsonb" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("audit_log", "event_id");
  pgm.createIndex("audit_log", "created_at");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("audit_log");
  pgm.dropTable("admin_sessions");
}
