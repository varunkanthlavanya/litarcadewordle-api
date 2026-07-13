import { useEffect, useRef, useState } from "react";
import type { NotificationDto } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { NotificationToast } from "@/components/shared/NotificationToast";

// Replaces the old "notification:push" Socket.IO event — a notification
// being a few seconds late to appear is unnoticeable in practice, so a
// plain interval poll is a reasonable, much simpler replacement here.
const POLL_MS = 10_000;

function metaFor(n: NotificationDto): string {
  return n.type === "ADVANCED" ? "Prelims result" : "From admin";
}

/** Shows unread notifications, polling the persisted list so anything sent
 * while this tab wasn't open still surfaces once it is. */
export function NotificationCenter() {
  const [queue, setQueue] = useState<NotificationDto[]>([]);
  const seenIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    function poll() {
      apiClient
        .get<NotificationDto[]>("/player/notifications")
        .then((all) => {
          const unread = all.filter((n) => !n.readAt && !seenIds.current.has(n.id));
          if (unread.length === 0) return;
          unread.forEach((n) => seenIds.current.add(n.id));
          setQueue((prev) => [...unread, ...prev]);
        })
        .catch(() => {
          // best-effort — a missing/stale token here shouldn't block the page itself
        });
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  function dismiss(id: number) {
    setQueue((prev) => prev.filter((n) => n.id !== id));
    apiClient.post(`/player/notifications/${id}/read`).catch(() => {});
  }

  if (queue.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 p-4">
      {queue.map((n) => (
        <div key={n.id} className="pointer-events-auto w-full max-w-sm">
          <NotificationToast
            type={n.type}
            title={n.title}
            meta={metaFor(n)}
            createdAt={n.createdAt}
            onDismiss={() => dismiss(n.id)}
          />
        </div>
      ))}
    </div>
  );
}
