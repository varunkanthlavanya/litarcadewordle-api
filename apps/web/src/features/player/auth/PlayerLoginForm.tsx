import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import { apiClient, ApiError } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function FieldError({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      {message}
    </p>
  );
}

/** Event ID and mobile number live together on one form now — both are
 * validated independently and each gets its own, specific error (wrong
 * event ID vs. a number that isn't on that event's whitelist), rather than
 * one generic failure that could mean either. Shared by Home (blank event
 * ID) and PlayerLogin (event ID pre-filled from the URL, e.g. after a
 * session expires mid-event). */
export function PlayerLoginForm({ initialEventId = "" }: { initialEventId?: string }) {
  const navigate = useNavigate();
  const [eventId, setEventId] = useState(initialEventId);
  const [mobileNumber, setMobileNumber] = useState("");
  const [eventIdError, setEventIdError] = useState<string | null>(null);
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEventIdError(null);
    setMobileError(null);

    const trimmedEventId = eventId.trim();
    const eventIdNum = Number(trimmedEventId);
    if (!trimmedEventId || !Number.isInteger(eventIdNum) || eventIdNum <= 0) {
      setEventIdError("Enter a valid event ID");
      return;
    }

    // Same normalization as the backend: strip everything but digits, keep
    // the last 10 — handles a pasted "+91 8220 850 225" even though the
    // field itself only expects the local number after the fixed +91 prefix.
    const digits = mobileNumber.replace(/\D/g, "");
    const normalizedMobile = digits.length > 10 ? digits.slice(-10) : digits;
    if (normalizedMobile.length !== 10) {
      setMobileError("Enter a valid 10-digit mobile number");
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.post("/player/auth/login", { eventId: eventIdNum, mobileNumber: normalizedMobile });
      navigate(`/play/${eventIdNum}/dashboard`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      const field = err instanceof ApiError ? err.field : undefined;
      if (field === "eventId") setEventIdError(message);
      else if (field === "mobileNumber") setMobileError(message);
      else setMobileError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 w-full space-y-4">
      <div className="space-y-2">
        <Label htmlFor="eventId">Event ID</Label>
        <Input
          id="eventId"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          placeholder="e.g. 1"
          required
          autoFocus={!initialEventId}
        />
        {eventIdError && <FieldError message={eventIdError} />}
      </div>

      <div className="space-y-2">
        <Label htmlFor="mobileNumber">Mobile number</Label>
        <div className="flex overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
          <span className="flex items-center border-r bg-muted px-3 text-sm font-medium text-muted-foreground">
            +91
          </span>
          <Input
            id="mobileNumber"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={mobileNumber}
            onChange={(e) => setMobileNumber(e.target.value)}
            placeholder="98765 43210"
            required
            autoFocus={!!initialEventId}
            className="rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        {mobileError && <FieldError message={mobileError} />}
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? "Checking..." : "Enter"}
      </Button>
    </form>
  );
}
