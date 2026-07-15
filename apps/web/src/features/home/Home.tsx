import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Home() {
  const [eventId, setEventId] = useState("");
  const navigate = useNavigate();

  function handlePlayerEnter(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = eventId.trim();
    if (trimmed) navigate(`/play/${trimmed}`);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-5 py-12">
      <div className="flex w-full max-w-sm flex-col items-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-extrabold text-primary-foreground shadow-sm">
          L
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">LitArcadeWordle</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          A two-stage Wordle tournament — Prelims speed round, then Playoffs reverse-Wordle showdown.
        </p>

        <form onSubmit={handlePlayerEnter} className="mt-8 w-full space-y-4">
          <div className="space-y-2">
            <Label htmlFor="eventId">Event ID</Label>
            <Input
              id="eventId"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              placeholder="e.g. 1"
              required
              autoFocus
            />
          </div>
          <Button type="submit" size="lg" className="w-full">
            Enter
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </form>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Are you an event admin?{" "}
          <Link to="/admin" className="font-medium text-foreground underline underline-offset-2 hover:text-primary">
            Enter admin console
          </Link>
        </p>

        <p className="mt-4 text-center text-xs text-muted-foreground">Having trouble? Ask your event coordinator.</p>
      </div>
    </div>
  );
}
