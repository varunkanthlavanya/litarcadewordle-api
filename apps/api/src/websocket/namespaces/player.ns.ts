import type { Namespace, Server, Socket } from "socket.io";
import { parse as parseCookie } from "cookie";
import { resolvePlayerToken, type PlayerIdentity } from "../../modules/auth-player/authPlayer.service.js";
import { markPlayerOffline, markPlayerOnline } from "../presence.js";

declare module "socket.io" {
  interface SocketData {
    player?: PlayerIdentity;
  }
}

export function registerPlayerNamespace(io: Server): Namespace {
  const nsp = io.of("/player");

  nsp.use((socket, next) => {
    void (async () => {
      const cookieHeader = socket.handshake.headers.cookie;
      const token = cookieHeader ? parseCookie(cookieHeader).player_token : undefined;

      if (!token) {
        next(new Error("Player authentication required"));
        return;
      }

      const identity = await resolvePlayerToken(token);
      if (!identity) {
        next(new Error("Player session invalid or expired"));
        return;
      }

      socket.data.player = identity;
      next();
    })().catch((err) => next(err instanceof Error ? err : new Error("Player authentication failed")));
  });

  nsp.on("connection", (socket: Socket) => {
    const player = socket.data.player;
    if (player) {
      socket.join(`player:${player.eventPlayerId}`);
      markPlayerOnline(player.eventPlayerId);
    }

    socket.on("game:join", ({ eventId }: { eventId: number }) => {
      socket.join(`event:${eventId}`);
    });

    socket.on("heartbeat:ping", () => {
      socket.emit("heartbeat:pong");
    });

    socket.on("disconnect", () => {
      if (player) markPlayerOffline(player.eventPlayerId);
    });
  });

  return nsp;
}
