import { cn } from "@/lib/utils";

const SEGMENTS = ["Draft", "Cohort Uploaded", "Prelims Live", "Prelims Closed", "Playoffs Live", "Playoffs Closed", "Archived"];

const STAGE_TO_SEGMENT: Record<string, number> = {
  DRAFT: 0,
  COHORT_UPLOADED: 1,
  PRELIMS_SCHEDULED: 1,
  PRELIMS_LIVE: 2,
  PRELIMS_CLOSED: 3,
  PLAYOFFS_SCHEDULED: 3,
  PLAYOFFS_LIVE: 4,
  PLAYOFFS_CLOSED: 5,
  ARCHIVED: 6,
};

export function StatusStepper({ status }: { status: string }) {
  const currentIndex = STAGE_TO_SEGMENT[status] ?? 0;

  return (
    <div className="flex overflow-hidden rounded-full border">
      {SEGMENTS.map((label, i) => (
        <div
          key={label}
          className={cn(
            "flex-1 border-r px-3 py-2 text-center text-xs font-semibold last:border-r-0",
            i <= currentIndex ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
          )}
        >
          {label}
        </div>
      ))}
    </div>
  );
}
