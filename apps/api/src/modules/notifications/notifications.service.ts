import { isPlayerOnline } from "../../websocket/presence.js";
import { listEventPlayers } from "../events/eventPlayers.repo.js";
import {
  insertNotification,
  listNotificationsForPlayer,
  markNotificationDelivered,
  markNotificationRead,
  type NotificationRow,
} from "./notifications.repo.js";

export interface NotificationsIo {
  emitToPlayer: (eventPlayerId: number, event: string, payload: unknown) => void;
}

export interface NotificationDeliveryResult {
  eventPlayerId: number;
  status: "live" | "queued";
  notificationId: number;
}

function toDto(row: NotificationRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export function createNotificationsService(io: NotificationsIo) {
  async function sendToOne(params: {
    eventId: number;
    eventPlayerId: number;
    type: "ADVANCED" | "ADMIN_MESSAGE";
    title: string;
    body: string;
    adminLabel: string;
  }): Promise<NotificationDeliveryResult> {
    const row = await insertNotification({
      eventId: params.eventId,
      eventPlayerId: params.eventPlayerId,
      type: params.type,
      title: params.title,
      body: params.body,
      createdByAdminLabel: params.adminLabel,
    });

    const online = isPlayerOnline(params.eventPlayerId);
    if (online) {
      io.emitToPlayer(params.eventPlayerId, "notification:push", toDto(row));
      await markNotificationDelivered(row.id);
    }

    return { eventPlayerId: params.eventPlayerId, status: online ? "live" : "queued", notificationId: row.id };
  }

  async function sendToMany(params: {
    eventId: number;
    eventPlayerIds: number[];
    type: "ADVANCED" | "ADMIN_MESSAGE";
    title: string;
    body: string;
    adminLabel: string;
  }): Promise<NotificationDeliveryResult[]> {
    const results: NotificationDeliveryResult[] = [];
    for (const eventPlayerId of params.eventPlayerIds) {
      results.push(await sendToOne({ ...params, eventPlayerId }));
    }
    return results;
  }

  async function sendToAllInEvent(params: {
    eventId: number;
    type: "ADVANCED" | "ADMIN_MESSAGE";
    title: string;
    body: string;
    adminLabel: string;
  }): Promise<NotificationDeliveryResult[]> {
    const cohort = await listEventPlayers(params.eventId);
    return sendToMany({ ...params, eventPlayerIds: cohort.map((p) => p.id) });
  }

  async function listForPlayer(eventPlayerId: number) {
    const rows = await listNotificationsForPlayer(eventPlayerId);
    return rows.map(toDto);
  }

  async function markRead(notificationId: number, eventPlayerId: number): Promise<void> {
    await markNotificationRead(notificationId, eventPlayerId);
  }

  return { sendToOne, sendToMany, sendToAllInEvent, listForPlayer, markRead };
}

export type NotificationsService = ReturnType<typeof createNotificationsService>;
