import { useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";
import { getPlayerSocket } from "@/lib/socketClient";

/** Returns the shared player-namespace socket and wires up listeners for the
 * lifetime of the calling component. `listeners` should be stable (memoized) —
 * it's re-subscribed whenever the reference changes. */
export function usePlayerSocket(listeners?: Record<string, (payload: any) => void>): Socket {
  const socket = getPlayerSocket();
  const listenersRef = useRef(listeners);
  listenersRef.current = listeners;

  useEffect(() => {
    const current = listenersRef.current;
    if (!current) return;

    for (const [event, handler] of Object.entries(current)) {
      socket.on(event, handler);
    }
    return () => {
      for (const [event, handler] of Object.entries(current)) {
        socket.off(event, handler);
      }
    };
  }, [socket, listeners]);

  return socket;
}
