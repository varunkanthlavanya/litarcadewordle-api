import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusBadgeStatus =
  // presence
  | "online"
  | "offline"
  // Timed Wordle player state
  | "idle"
  | "inGame"
  | "postGame"
  // generic session lifecycle (Timed Wordle final states + UNWORDLE)
  | "notStarted"
  | "inProgress"
  | "found"
  | "completed"
  | "ended"
  | "exited"
  | "notFound"
  | "adminEnded"
  // event lifecycle
  | "draft"
  | "cohortUploaded"
  | "prelimsScheduled"
  | "prelimsLive"
  | "prelimsClosed"
  | "playoffsScheduled"
  | "playoffsLive"
  | "playoffsClosed"
  | "archived";

const STATUS_CONFIG: Record<StatusBadgeStatus, { variant: BadgeProps["variant"]; label: string }> = {
  online: { variant: "success", label: "Online" },
  offline: { variant: "offline", label: "Offline" },
  idle: { variant: "secondary", label: "Idle" },
  inGame: { variant: "info", label: "In Game" },
  postGame: { variant: "success", label: "Post-Game" },
  notStarted: { variant: "secondary", label: "Not Started" },
  inProgress: { variant: "info", label: "In Progress" },
  found: { variant: "success", label: "Found" },
  completed: { variant: "success", label: "Completed" },
  ended: { variant: "warning", label: "Ended" },
  exited: { variant: "destructive", label: "Exited" },
  notFound: { variant: "destructive", label: "Not Found" },
  adminEnded: { variant: "warning", label: "Ended" },
  draft: { variant: "secondary", label: "Draft" },
  cohortUploaded: { variant: "secondary", label: "Cohort Uploaded" },
  prelimsScheduled: { variant: "secondary", label: "Prelims Scheduled" },
  prelimsLive: { variant: "info", label: "Prelims Live" },
  prelimsClosed: { variant: "secondary", label: "Prelims Closed" },
  playoffsScheduled: { variant: "secondary", label: "Playoffs Scheduled" },
  playoffsLive: { variant: "info", label: "Playoffs Live" },
  playoffsClosed: { variant: "secondary", label: "Playoffs Closed" },
  archived: { variant: "offline", label: "Archived" },
};

interface StatusBadgeProps {
  status: StatusBadgeStatus;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <Badge variant={config.variant} className={cn(className)}>
      {label ?? config.label}
    </Badge>
  );
}
