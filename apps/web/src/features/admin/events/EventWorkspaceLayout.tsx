import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Trash2 } from "lucide-react";
import type { EventApiRow } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeStatus } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { cn } from "@/lib/utils";

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

const TABS = [
  { label: "Overview", path: "" },
  { label: "Cohort & Settings", path: "edit" },
  { label: "Prelims", path: "prelims" },
  { label: "Cutoff", path: "cutoff" },
  { label: "Playoffs", path: "playoffs" },
  { label: "Winners", path: "winners" },
  { label: "Messages", path: "messages" },
  { label: "Audit", path: "audit" },
];

export interface EventWorkspaceContext {
  event: EventApiRow;
  reload: () => void;
}

/** Persistent shell for every /admin/events/:eventId/* page — replaces the old
 * pattern where every leaf page (Prelims, Cutoff, Playoffs, Winners, Audit,
 * Messages, Edit) was a dead-end that only linked back to the Control Center,
 * forcing a hub round-trip between every pair of sibling pages. The tab bar
 * here lets an admin jump directly between any two of an event's sub-pages in
 * one click, and the header (name/status/Edit/Delete) is shown once instead
 * of being re-fetched and re-rendered by each leaf page. */
export function EventWorkspaceLayout() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventApiRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const reload = useCallback(() => {
    if (!eventId || !/^\d+$/.test(eventId)) return;
    apiClient
      .get<EventApiRow>(`/admin/events/${eventId}`)
      .then(setEvent)
      .catch(() => setNotFound(true));
  }, [eventId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleDelete() {
    await apiClient.del(`/admin/events/${eventId}`);
    navigate("/admin/events");
  }

  if (notFound) {
    return (
      <div>
        <Link to="/admin/events" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to Events
        </Link>
        <p className="text-sm text-destructive">Event not found.</p>
      </div>
    );
  }

  if (!event) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div>
      <Link to="/admin/events" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        All Events
      </Link>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{event.name}</h1>
          <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs text-secondary-foreground">
            Event ID: {event.id}
          </span>
          <StatusBadge status={EVENT_STATUS_MAP[event.status] ?? "draft"} />
        </div>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="mr-1.5 h-4 w-4" />
          Delete Event
        </Button>
      </div>

      <nav className="mb-6 flex flex-wrap gap-1 border-b">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path ? `/admin/events/${eventId}/${tab.path}` : `/admin/events/${eventId}`}
            end
            className={({ isActive }) =>
              cn(
                "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ event, reload } satisfies EventWorkspaceContext} />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete "${event.name}"?`}
        description="This permanently deletes the event and everything under it — cohort, sessions, game results, and winners. This cannot be undone."
        confirmLabel="Delete Event"
        onConfirm={handleDelete}
      />
    </div>
  );
}
