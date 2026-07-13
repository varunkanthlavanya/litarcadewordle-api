import { formatMmSs, useCountdown } from "@/hooks/useCountdown";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TimerHudProps {
  globalDeadlineAt: number;
  currentTryNumber: number;
  graceActive: boolean;
}

const MAX_TRIES = 6;

export function TimerHud({ globalDeadlineAt, currentTryNumber, graceActive }: TimerHudProps) {
  const remainingMs = useCountdown(globalDeadlineAt);
  const isLow = remainingMs < 30_000;

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={cn("font-mono text-[27px] font-bold tabular-nums leading-none", isLow && "text-destructive")}>
          {formatMmSs(remainingMs)}
        </span>
        {graceActive && (
          <Badge variant="warning" className="border border-dashed border-warning bg-transparent">
            GRACE
          </Badge>
        )}
      </div>
      <Badge variant="secondary" className="font-mono">
        Try {currentTryNumber} / {MAX_TRIES}
      </Badge>
    </div>
  );
}
