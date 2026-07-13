import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Lock } from "lucide-react";
import type { UnwordleRoundStatusDto } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Badge } from "@/components/ui/badge";

// UNWORDLE has no per-try deadline to schedule against (only an admin-driven
// start/stop), so a plain interval poll is the simplest correct replacement
// for the old "uw:session:started" Socket.IO push.
const POLL_MS = 3000;

export function UnwordleLobby() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<UnwordleRoundStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    function poll() {
      apiClient
        .get<UnwordleRoundStatusDto>(`/player/events/${eventId}/unwordle/status`)
        .then((res) => {
          if (!cancelled) setStatus(res);
        })
        .catch((err: Error) => {
          if (!cancelled) setError(err.message);
        });
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [eventId]);

  useEffect(() => {
    if (!status) return;
    if (status.sessionStatus === "IN_PROGRESS") {
      navigate(`/play/${eventId}/unwordle/game`, { replace: true });
    } else if (status.sessionStatus === "COMPLETED" || status.sessionStatus === "ENDED" || status.sessionStatus === "EXITED") {
      navigate(`/play/${eventId}/unwordle/results`, { replace: true });
    }
  }, [status, eventId, navigate]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!status.isFinalist) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 text-center">
        <p className="text-sm text-muted-foreground">
          There's no Playoffs round available for you on this event yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-5 py-6 text-center">
      <Badge variant="accent">YOU'RE A FINALIST</Badge>
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Lock className="h-7 w-7" />
      </div>
      <p className="max-w-xs text-sm text-muted-foreground">Waiting for the admin to start your Playoffs round</p>
      <p className="text-xs text-muted-foreground">UNWORDLE · Round 2</p>
    </div>
  );
}
