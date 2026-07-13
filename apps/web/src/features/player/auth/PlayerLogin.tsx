import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PlayerLogin() {
  const { eventId } = useParams<{ eventId: string }>();
  const [mobileNumber, setMobileNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post("/player/auth/login", { eventId: Number(eventId), mobileNumber });
      navigate(`/play/${eventId}/lobby`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-5 py-10">
      <div className="flex w-full max-w-sm flex-col items-center">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-extrabold text-primary-foreground">
          L
        </div>
        <h1 className="text-xl font-bold">LitArcadeWordle</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">Enter your mobile number to join</p>

        <form onSubmit={handleSubmit} className="mt-8 w-full space-y-4">
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
                autoFocus
                className="rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <Button type="submit" className="w-full" size="lg" disabled={submitting}>
            {submitting ? "Checking..." : "Continue"}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Having trouble? Ask your event coordinator.
        </p>
      </div>
    </div>
  );
}
