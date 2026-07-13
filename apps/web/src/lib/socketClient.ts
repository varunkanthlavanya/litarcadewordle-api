import { io, type Socket } from "socket.io-client";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const CONNECT_TIMEOUT_MS = 10_000;

let playerSocket: Socket | null = null;

export function getPlayerSocket(): Socket {
  if (!playerSocket) {
    playerSocket = io(`${API_BASE_URL}/player`, {
      withCredentials: true,
      autoConnect: true,
    });
  }
  return playerSocket;
}

let adminSocket: Socket | null = null;

export function getAdminSocket(): Socket {
  if (!adminSocket) {
    adminSocket = io(`${API_BASE_URL}/admin`, {
      withCredentials: true,
      autoConnect: true,
    });
  }
  return adminSocket;
}

export function emitWithAck<TPayload, TResponse = { ok: boolean; error?: string; [key: string]: unknown }>(
  socket: Socket,
  event: string,
  payload: TPayload
): Promise<TResponse> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: TResponse) => resolve(response));
  });
}

/** socket.io buffers emits until connected and never rejects on its own — an auth
 * failure or unreachable server would otherwise hang callers forever. Resolves
 * immediately if already connected; otherwise waits for 'connect', or throws on
 * 'connect_error' / a timeout. Call this before the first emitWithAck on a screen. */
export function waitForConnection(socket: Socket, timeoutMs = CONNECT_TIMEOUT_MS): Promise<void> {
  if (socket.connected) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;

    const onConnect = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(err.message || "Could not connect to the game server"));
    };
    const timer = setTimeout(() => onError(new Error("Connection timed out")), timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    }

    socket.on("connect", onConnect);
    socket.on("connect_error", onError);
  });
}
