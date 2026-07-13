import { insertAuditEntry, listAuditEntries } from "./audit.repo.js";

export async function writeAuditEntry(params: {
  adminLabel: string;
  eventId?: number | null;
  actionType: string;
  targetType?: string;
  targetIds?: unknown;
  reason?: string;
  metadata?: unknown;
}): Promise<void> {
  await insertAuditEntry({ eventId: null, ...params });
}

export async function getAuditLog(eventId?: number) {
  return listAuditEntries(eventId);
}
