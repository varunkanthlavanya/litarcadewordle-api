import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { config } from "../config/index.js";
import { createTimedWordleScheduler } from "../modules/timed-wordle/tw.service.js";
import { registerTimedWordleSockets } from "../modules/timed-wordle/tw.sockets.js";
import type { TimedWordleScheduler } from "../modules/timed-wordle/engine/timerScheduler.js";
import { registerUnwordleSockets } from "../modules/unwordle/uw.sockets.js";
import { createNotificationsService, type NotificationsService } from "../modules/notifications/notifications.service.js";
import { registerAdminNamespace } from "./namespaces/admin.ns.js";
import { registerPlayerNamespace } from "./namespaces/player.ns.js";

export function createSocketServer(httpServer: HttpServer): {
  io: Server;
  timedWordleScheduler: TimedWordleScheduler;
  notificationsService: NotificationsService;
} {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigins, credentials: true },
  });

  const playerNsp = registerPlayerNamespace(io);
  const adminNsp = registerAdminNamespace(io);

  const timedWordleScheduler = createTimedWordleScheduler({
    emitToPlayerSession: (sessionId, event, payload) => {
      playerNsp.to(`session:${sessionId}`).emit(event, payload);
    },
    emitToAdminEvent: (eventId, event, payload) => {
      adminNsp.to(`admin:${eventId}`).emit(event, payload);
    },
  });

  const notificationsService = createNotificationsService({
    emitToPlayer: (eventPlayerId, event, payload) => {
      playerNsp.to(`player:${eventPlayerId}`).emit(event, payload);
    },
  });

  registerTimedWordleSockets(playerNsp, adminNsp, timedWordleScheduler);

  registerUnwordleSockets(playerNsp, adminNsp, {
    emitToPlayerSession: (sessionId, event, payload) => {
      playerNsp.to(`session:${sessionId}`).emit(event, payload);
    },
    emitToAdminEvent: (eventId, event, payload) => {
      adminNsp.to(`admin:${eventId}`).emit(event, payload);
    },
  });

  return { io, timedWordleScheduler, notificationsService };
}
