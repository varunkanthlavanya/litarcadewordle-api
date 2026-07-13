import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ClockAdjustControlProps {
  playerLabel: string;
  onAdjust: (deltaSeconds: number, scope: "GLOBAL" | "CURRENT_TRY") => Promise<void> | void;
  onCancel: () => void;
}

const STEP_SECONDS = 30;

export function ClockAdjustControl({ playerLabel, onAdjust, onCancel }: ClockAdjustControlProps) {
  const [deltaSeconds, setDeltaSeconds] = useState(STEP_SECONDS);
  const [scope, setScope] = useState<"GLOBAL" | "CURRENT_TRY">("GLOBAL");
  const [submitting, setSubmitting] = useState(false);

  async function apply(sign: 1 | -1) {
    setSubmitting(true);
    try {
      await onAdjust(sign * Math.abs(deltaSeconds), scope);
      onCancel();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
      <span className="text-sm font-medium">Clock adjust · {playerLabel}</span>

      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" onClick={() => setDeltaSeconds((d) => Math.max(0, d - STEP_SECONDS))}>
          −
        </Button>
        <span className="w-16 text-center font-mono text-sm">{deltaSeconds}s</span>
        <Button variant="outline" size="icon" onClick={() => setDeltaSeconds((d) => d + STEP_SECONDS)}>
          +
        </Button>
      </div>

      <div className="flex overflow-hidden rounded-md border text-xs">
        {(["GLOBAL", "CURRENT_TRY"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className={cn(
              "px-2.5 py-1.5 font-medium",
              scope === s ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
            )}
          >
            {s === "GLOBAL" ? "whole session" : "this try only"}
          </button>
        ))}
      </div>

      <div className="ml-auto flex gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button size="sm" disabled={submitting || deltaSeconds === 0} onClick={() => apply(-1)}>
          −{deltaSeconds}s
        </Button>
        <Button size="sm" disabled={submitting || deltaSeconds === 0} onClick={() => apply(1)}>
          +{deltaSeconds}s
        </Button>
      </div>
    </div>
  );
}
