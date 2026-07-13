import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export function Home() {
  const [eventId, setEventId] = useState("");
  const navigate = useNavigate();

  function handlePlayerEnter(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = eventId.trim();
    if (trimmed) navigate(`/play/${trimmed}`);
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-5 py-12">
      <div className="flex flex-col items-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-extrabold text-primary-foreground shadow-sm">
          L
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">LitArcadeWordle</h1>
        <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">
          A two-stage Wordle tournament — Prelims speed round, then Playoffs reverse-Wordle showdown.
        </p>
      </div>

      <div className="mt-10 grid w-full max-w-3xl gap-6 sm:grid-cols-2">
        <Card className="flex flex-col">
          <CardContent className="flex flex-1 flex-col p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/20 text-accent-foreground">
              <Users className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-lg font-bold">I'm a player</h2>
            <p className="mt-1 text-sm text-muted-foreground">Enter your event ID to join the tournament.</p>
            <form onSubmit={handlePlayerEnter} className="mt-4 flex flex-1 flex-col justify-end gap-3">
              <div className="space-y-2">
                <Label htmlFor="eventId">Event ID</Label>
                <Input
                  id="eventId"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  placeholder="e.g. 1"
                  required
                />
              </div>
              <Button type="submit" className="w-full">
                Enter
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardContent className="flex flex-1 flex-col p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-lg font-bold">I'm an admin</h2>
            <p className="mt-1 text-sm text-muted-foreground">Manage events, run rounds, and control the tournament.</p>
            <div className="mt-4 flex flex-1 flex-col justify-end">
              <Button asChild variant="outline" className="w-full">
                <Link to="/admin">
                  Enter admin console
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <p className="mt-10 text-center text-xs text-muted-foreground">Having trouble? Ask your event coordinator.</p>
    </div>
  );
}
