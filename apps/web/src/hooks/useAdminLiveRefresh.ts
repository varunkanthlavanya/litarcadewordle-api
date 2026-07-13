import { useEffect, useRef } from "react";

const POLL_MS = 5000;

/** Replaces the old Socket.IO "admin:session:update" ping with a plain
 * interval poll — the admin dashboard already fully refetches on every
 * update rather than diff-patching, so this is the same perceived liveness.
 * `recentlyUpdated` is kept in the return shape for compatibility but is now
 * always empty: the brief per-row highlight flash was driven by discrete
 * change events, which polling doesn't have a cheap equivalent for. Every
 * screen still refreshes every 5s either way. */
export function useAdminLiveRefresh(eventId: number | undefined, onUpdate: () => void): {
  recentlyUpdated: Set<number>;
} {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!eventId) return;
    const interval = setInterval(() => onUpdateRef.current(), POLL_MS);
    return () => clearInterval(interval);
  }, [eventId]);

  return { recentlyUpdated: new Set() };
}
