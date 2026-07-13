import type { Namespace, Server, Socket } from "socket.io";
import { parse as parseCookie } from "cookie";
import { resolveAdminToken, type AdminIdentity } from "../../modules/auth-admin/authAdmin.service.js";

declare module "socket.io" {
  interface SocketData {
    admin?: AdminIdentity;
  }
}

export function registerAdminNamespace(io: Server): Namespace {
  const nsp = io.of("/admin");

  nsp.use((socket, next) => {
    void (async () => {
      const cookieHeader = socket.handshake.headers.cookie;
      const token = cookieHeader ? parseCookie(cookieHeader).admin_token : undefined;

      if (!token) {
        next(new Error("Admin authentication required"));
        return;
      }

      const identity = await resolveAdminToken(token);
      if (!identity) {
        next(new Error("Admin session invalid or expired"));
        return;
      }

      socket.data.admin = identity;
      next();
    })().catch((err) => next(err instanceof Error ? err : new Error("Admin authentication failed")));
  });

  nsp.on("connection", (socket: Socket) => {
    socket.on("admin:join", ({ eventId }: { eventId: number }) => {
      socket.join(`admin:${eventId}`);
    });

    socket.on("disconnect", () => {
      // presence bookkeeping hooked up alongside session monitoring (see common admin framework task)
    });
  });

  return nsp;
}
