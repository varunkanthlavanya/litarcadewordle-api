/** In-memory presence registry (single Node instance — see plan's "no Redis for v1").
 * Tracks which players currently have at least one live socket connection (ref-counted
 * so multiple tabs/devices for the same player don't flip them offline prematurely).
 * Used by both the admin session-monitor (Online/Offline) and notification delivery
 * status (Live/Queued). */

const connectionCounts = new Map<number, number>();
type PresenceListener = (eventPlayerId: number, online: boolean) => void;
const listeners = new Set<PresenceListener>();

export function markPlayerOnline(eventPlayerId: number): void {
  const count = connectionCounts.get(eventPlayerId) ?? 0;
  connectionCounts.set(eventPlayerId, count + 1);
  if (count === 0) notifyListeners(eventPlayerId, true);
}

export function markPlayerOffline(eventPlayerId: number): void {
  const count = connectionCounts.get(eventPlayerId) ?? 0;
  if (count <= 1) {
    connectionCounts.delete(eventPlayerId);
    if (count === 1) notifyListeners(eventPlayerId, false);
    return;
  }
  connectionCounts.set(eventPlayerId, count - 1);
}

export function isPlayerOnline(eventPlayerId: number): boolean {
  return (connectionCounts.get(eventPlayerId) ?? 0) > 0;
}

export function listOnlinePlayerIds(): number[] {
  return [...connectionCounts.keys()];
}

export function onPresenceChange(listener: PresenceListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners(eventPlayerId: number, online: boolean): void {
  for (const listener of listeners) listener(eventPlayerId, online);
}
