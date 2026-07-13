import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { EventApiRow, EventStats } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { StatusStepper } from "@/components/shared/StatusStepper";
import { BackLink } from "@/components/shared/BackLink";
import { Card, CardContent } from "@/components/ui/card";

const NAV_CARDS = [
  { label: "Prelims Panel", path: "prelims", desc: "Timed Wordle session monitor & controls" },
  { label: "Playoffs Panel", path: "playoffs", desc: "UNWORDLE session monitor & controls" },
  { label: "Cutoff Tool", path: "cutoff", desc: "Advance Top N to Playoffs" },
  { label: "Winners", path: "winners", desc: "Pick final prize placements" },
  { label: "Audit Log", path: "audit", desc: "Every admin action, logged" },
  { label: "Messaging", path: "messages", desc: "Send in-app notifications to players" },
];

export function EventControlCenter() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventApiRow | null>(null);
  const [stats, setStats] = useState<EventStats | null>(null);

  useEffect(() => {
    apiClient.get<EventApiRow>(`/admin/events/${eventId}`).then(setEvent);
    apiClient.get<EventStats>(`/admin/events/${eventId}/stats`).then(setStats);
  }, [eventId]);

  if (!event) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div>
      <BackLink to="/admin/events" label="Back to Events" />
      <h1 className="mb-4 text-2xl font-bold">{event.name}</h1>
      <StatusStepper status={event.status} />

      <div className="mt-6 grid grid-cols-3 gap-4">
        <StatCard label="cohort size" value={stats?.cohortSize ?? "—"} />
        <StatCard label="online now" value={stats?.onlineNow ?? "—"} accent="success" />
        <StatCard label="completed" value={stats?.completedCount ?? "—"} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {NAV_CARDS.map((card) => (
          <Link key={card.path} to={`/admin/events/${eventId}/${card.path}`}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardContent className="p-4">
                <p className="font-semibold">{card.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{card.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: "success" }) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <p className={accent === "success" ? "text-3xl font-extrabold text-success" : "text-3xl font-extrabold"}>
          {value}
        </p>
        <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
