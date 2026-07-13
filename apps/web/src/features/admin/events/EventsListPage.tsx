import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { EventApiRowWithCohortSize } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeStatus } from "@/components/shared/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const EVENT_STATUS_MAP: Record<string, StatusBadgeStatus> = {
  DRAFT: "draft",
  COHORT_UPLOADED: "cohortUploaded",
  PRELIMS_SCHEDULED: "prelimsScheduled",
  PRELIMS_LIVE: "prelimsLive",
  PRELIMS_CLOSED: "prelimsClosed",
  PLAYOFFS_SCHEDULED: "playoffsScheduled",
  PLAYOFFS_LIVE: "playoffsLive",
  PLAYOFFS_CLOSED: "playoffsClosed",
  ARCHIVED: "archived",
};

export function EventsListPage() {
  const [events, setEvents] = useState<EventApiRowWithCohortSize[] | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiClient.get<EventApiRowWithCohortSize[]>("/admin/events").then(setEvents);
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Events</h1>
        <Button asChild>
          <Link to="/admin/events/new">+ Create Event</Link>
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Cohort</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events && events.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No events yet — create your first event.
                </TableCell>
              </TableRow>
            )}
            {events?.map((event) => (
              <TableRow
                key={event.id}
                className="cursor-pointer"
                onClick={() => navigate(`/admin/events/${event.id}`)}
              >
                <TableCell className="font-medium">{event.name}</TableCell>
                <TableCell>
                  <StatusBadge status={EVENT_STATUS_MAP[event.status] ?? "draft"} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(event.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell>{event.cohort_size}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
