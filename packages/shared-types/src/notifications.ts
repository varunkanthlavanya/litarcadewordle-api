export type NotificationType = "ADVANCED" | "ADMIN_MESSAGE";

export interface NotificationDto {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}
