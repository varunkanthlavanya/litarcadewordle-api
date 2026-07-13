import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "./ConfirmDialog";

interface BulkActionsBarProps {
  selectedCount: number;
  totalCount: number;
  onEndSelected: () => Promise<void> | void;
  onEndAll: () => Promise<void> | void;
}

export function BulkActionsBar({ selectedCount, totalCount, onEndSelected, onEndAll }: BulkActionsBarProps) {
  const [confirmSelected, setConfirmSelected] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-3">
      <span className="text-sm text-muted-foreground">{selectedCount} selected</span>
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" disabled={selectedCount === 0} onClick={() => setConfirmSelected(true)}>
          End Selected
        </Button>
        <Button variant="destructive" size="sm" onClick={() => setConfirmAll(true)}>
          End All ({totalCount})
        </Button>
      </div>

      <ConfirmDialog
        open={confirmSelected}
        onOpenChange={setConfirmSelected}
        title="End selected sessions?"
        description={`This will log out ${selectedCount} user${selectedCount === 1 ? "" : "s"}. Continue?`}
        confirmLabel="End Selected"
        onConfirm={onEndSelected}
      />
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="End all active sessions?"
        description={`This will log out ${totalCount} user${totalCount === 1 ? "" : "s"}. Continue?`}
        confirmLabel="End All"
        onConfirm={onEndAll}
      />
    </div>
  );
}
