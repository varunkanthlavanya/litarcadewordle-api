import { Check, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NotificationType } from "@litarcadewordle/shared-types";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHour = Math.round(diffMin / 60);
  return `${diffHour}h ago`;
}

interface NotificationToastProps {
  type: NotificationType;
  title: string;
  meta: string;
  createdAt: string;
  onDismiss: () => void;
}

export function NotificationToast({ type, title, meta, createdAt, onDismiss }: NotificationToastProps) {
  const isAdvancement = type === "ADVANCED";

  return (
    <div className="flex w-full max-w-sm items-start gap-3 rounded-xl border bg-card p-3 shadow-[0_12px_28px_rgba(0,0,0,0.10)]">
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          isAdvancement ? "bg-success-subtle text-success" : "bg-info-subtle text-info"
        )}
      >
        {isAdvancement ? <Check className="h-4 w-4" /> : <Info className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-snug">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {meta} · {relativeTime(createdAt)}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
