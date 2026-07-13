import { useEffect, useRef, useState } from "react";
import { getAdminSocket, waitForConnection } from "@/lib/socketClient";

/** Joins the admin room for an event and triggers `onUpdate` (debounced) whenever the
 * scheduler pushes a discrete session-state change — simpler and just as correct as
 * patch-merging individual rows, since updates are state-change-driven, not per-second. */
export function useAdminLiveRefresh(eventId: number | undefined, onUpdate: () => void): {
  recentlyUpdated: Set<number>;
} {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const [recentlyUpdated, setRecentlyUpdated] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!eventId) return;
    const socket = getAdminSocket();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    waitForConnection(socket)
      .then(() => socket.emit("admin:join", { eventId }))
      .catch(() => {});

    function onSessionUpdate(payload: { sessionId: number }) {
      setRecentlyUpdated((prev) => new Set(prev).add(payload.sessionId));
      setTimeout(() => {
        setRecentlyUpdated((prev) => {
          const next = new Set(prev);
          next.delete(payload.sessionId);
          return next;
        });
      }, 800);

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => onUpdateRef.current(), 200);
    }

    socket.on("admin:session:update", onSessionUpdate);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      socket.off("admin:session:update", onSessionUpdate);
    };
  }, [eventId]);

  return { recentlyUpdated };
}
