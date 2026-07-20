import { useParams } from "react-router-dom";
import { BackLink } from "@/components/shared/BackLink";
import { PlayerLoginForm } from "./PlayerLoginForm";

export function PlayerLogin() {
  const { eventId } = useParams<{ eventId: string }>();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-5 py-10">
      <div className="flex w-full max-w-sm flex-col items-center">
        <div className="mb-3 self-start">
          <BackLink to="/" label="Back to home" />
        </div>
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-extrabold text-primary-foreground">
          L
        </div>
        <h1 className="text-xl font-bold">LitArcadeWordle</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">Enter your event ID and mobile number to join</p>

        <PlayerLoginForm initialEventId={eventId} />

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Having trouble? Ask your event coordinator.
        </p>
      </div>
    </div>
  );
}
