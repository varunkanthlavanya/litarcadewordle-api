import { useEffect, useState } from "react";

/** Renders a countdown purely from a server-issued absolute deadline (epoch ms) —
 * never trusts a locally-accumulated timer, so client clock drift can't skew scoring. */
export function useCountdown(deadlineAt: number | null): number {
  const [remainingMs, setRemainingMs] = useState(() => (deadlineAt ? deadlineAt - Date.now() : 0));

  useEffect(() => {
    if (deadlineAt === null) {
      setRemainingMs(0);
      return;
    }

    setRemainingMs(deadlineAt - Date.now());
    const interval = setInterval(() => {
      setRemainingMs(deadlineAt - Date.now());
    }, 200);

    return () => clearInterval(interval);
  }, [deadlineAt]);

  return Math.max(0, remainingMs);
}

export function formatMmSs(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatHhMmSs(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}
