import { useEffect, useState } from "react";

/** Count-up elapsed time from a start timestamp — the only clock UNWORDLE shows the
 * player (PRD §2.4): no deadline, no target, just how much time has passed. */
export function useStopwatch(startTimeMs: number | null): number {
  const [elapsedMs, setElapsedMs] = useState(() => (startTimeMs ? Date.now() - startTimeMs : 0));

  useEffect(() => {
    if (startTimeMs === null) {
      setElapsedMs(0);
      return;
    }

    setElapsedMs(Date.now() - startTimeMs);
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTimeMs);
    }, 500);

    return () => clearInterval(interval);
  }, [startTimeMs]);

  return Math.max(0, elapsedMs);
}

export function formatHhMmSsFromElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
