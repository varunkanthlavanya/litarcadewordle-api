import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { EventApiRow, EventRosterEntry, EventStats } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { StatusStepper } from "@/components/shared/StatusStepper";
import { BackLink } from "@/components/shared/BackLink";
import { StatusBadge, type StatusBadgeStatus } from "@/components/shared/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const NAV_CARDS = [
  { label: "Prelims Panel", path: "prelims", desc: "Timed Wordle session monitor & controls" },
  { label: "Playoffs Panel", path: "playoffs", desc: "UNWORDLE session monitor & controls" },
  { label: "Cutoff Tool", path: "cutoff", desc: "Advance Top N to Playoffs" },
  { label: "Winners", path: "winners", desc: "Pick final prize placements" },
  { label: "Audit Log", path: "audit", desc: "Every admin action, logged" },
  { label: "Messaging", path: "messages", desc: "Send in-app notifications to players" },
];

const PRELIMS_STATUS_BADGE: Record<EventRosterEntry["prelimsStatus"], StatusBadgeStatus> = {
  NOT_STARTED: "notStarted",
  IN_PROGRESS: "inProgress",
  FOUND: "found",
  NOT_FOUND_TRIES: "notFound",
  NOT_FOUND_TIME: "notFound",
  ADMIN_ENDED: "adminEnded",
};

const PLAYOFFS_STATUS_BADGE: Record<NonNullable<EventRosterEntry["playoffsStatus"]>, StatusBadgeStatus> = {
  NOT_STARTED: "notStarted",
  IN_PROGRESS: "inProgress",
  COMPLETED: "completed",
  ENDED: "ended",
  EXITED: "exited",
};

export function EventControlCenter() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventApiRow | null>(null);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [roster, setRoster] = useState<EventRosterEntry[] | null>(null);

  useEffect(() => {
    apiClient.get<EventApiRow>(`/admin/events/${eventId}`).then(setEvent);
    apiClient.get<EventStats>(`/admin/events/${eventId}/stats`).then(setStats);
    apiClient.get<EventRosterEntry[]>(`/admin/events/${eventId}/roster`).then(setRoster);
  }, [eventId]);

  if (!event) return <p className="text-sm text-muted-foreground">Loading...</p>;

  const isLive = event.status !== "DRAFT";

  return (
    <div>
      <BackLink to="/admin/events" label="Back to Events" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{event.name}</h1>
        <Button asChild variant="outline" size="sm">
          <Link to={`/admin/events/${eventId}/edit`}>Edit Event</Link>
        </Button>
      </div>
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

      {isLive && roster && roster.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Cohort — every player's status</h2>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Prelims</TableHead>
                  <TableHead>Playoffs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map((r) => (
                  <TableRow key={r.eventPlayerId}>
                    <TableCell className="font-medium">{r.displayName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.mobileNumber}</TableCell>
                    <TableCell>
                      <StatusBadge status={PRELIMS_STATUS_BADGE[r.prelimsStatus]} />
                    </TableCell>
                    <TableCell>
                      {r.playoffsStatus ? (
                        <StatusBadge status={PLAYOFFS_STATUS_BADGE[r.playoffsStatus]} />
                      ) : r.advancedToPlayoffs ? (
                        <StatusBadge status="notStarted" />
                      ) : (
                        <span className="text-xs text-muted-foreground">Not advanced</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
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
