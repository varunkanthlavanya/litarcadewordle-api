// Port of apps/api/src/modules/audit/{audit.service,audit.repo}.ts
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export async function writeAuditEntry(
  db: SupabaseClient,
  params: {
    adminLabel: string;
    eventId?: number | null;
    actionType: string;
    targetType?: string;
    targetIds?: unknown;
    reason?: string;
    metadata?: unknown;
  }
): Promise<void> {
  const { error } = await db.from("wl_audit_log").insert({
    admin_label: params.adminLabel,
    event_id: params.eventId ?? null,
    action_type: params.actionType,
    target_type: params.targetType ?? null,
    target_ids: params.targetIds ?? null,
    reason: params.reason ?? null,
    metadata: params.metadata ?? null,
  });
  if (error) throw error;
}
