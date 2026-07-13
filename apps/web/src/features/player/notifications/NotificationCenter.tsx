import { useEffect, useState } from "react";
import type { NotificationDto } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { getPlayerSocket } from "@/lib/socketClient";
import { NotificationToast } from "@/components/shared/NotificationToast";

function metaFor(n: NotificationDto): string {
  return n.type === "ADVANCED" ? "Prelims result" : "From admin";
}

/** Shows live pushes while connected, and re-surfaces anything the player missed
 * while disconnected — fetched once on mount from the persisted notifications list. */
export function NotificationCenter() {
  const [queue, setQueue] = useState<NotificationDto[]>([]);

  useEffect(() => {
    apiClient
      .get<NotificationDto[]>("/player/notifications")
      .then((all) => setQueue(all.filter((n) => !n.readAt)))
      .catch(() => {
        // best-effort — a missing/stale token here shouldn't block the page itself
      });

    const socket = getPlayerSocket();
    function onPush(payload: NotificationDto) {
      setQueue((prev) => [payload, ...prev]);
    }
    socket.on("notification:push", onPush);
    return () => {
      socket.off("notification:push", onPush);
    };
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
