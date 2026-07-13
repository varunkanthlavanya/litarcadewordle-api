import { useMemo, useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface SessionMonitorColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface SessionMonitorTableProps<T> {
  rows: T[];
  totalCount: number;
  columns: SessionMonitorColumn<T>[];
  getRowId: (row: T) => number;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onToggleSelectAll: () => void;
  recentlyUpdatedIds?: Set<number>;
  action?: (row: T) => ReactNode;
  pageSize?: number;
}

/** Shared session-monitor table shell (checkbox column + pluggable columns + action
 * column) — A5 (Timed Wordle) and A8 (UNWORDLE) are two instances of this with
 * different column sets and state-badge vocabularies. Paginated so a 600-row cohort
 * never renders as one giant DOM table. */
export function SessionMonitorTable<T>({
  rows,
  totalCount,
  columns,
  getRowId,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  recentlyUpdatedIds,
  action,
  pageSize = 50,
}: SessionMonitorTableProps<T>) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = useMemo(() => rows.slice(page * pageSize, page * pageSize + pageSize), [rows, page, pageSize]);
  const allSelectedOnPage = pageRows.length > 0 && pageRows.every((r) => selectedIds.has(getRowId(r)));

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox checked={allSelectedOnPage} onCheckedChange={onToggleSelectAll} aria-label="Select all" />
            </TableHead>
            {columns.map((col) => (
              <TableHead key={col.key} className={col.className}>
                {col.header}
              </TableHead>
            ))}
            {action && <TableHead className="w-20">Action</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.map((row) => {
            const id = getRowId(row);
            return (
              <TableRow
                key={id}
                className={cn(recentlyUpdatedIds?.has(id) && "row-flash")}
                data-state={selectedIds.has(id) ? "selected" : undefined}
              >
                <TableCell>
                  <Checkbox checked={selectedIds.has(id)} onCheckedChange={() => onToggleSelect(id)} aria-label="Select row" />
                </TableCell>
                {columns.map((col) => (
                  <TableCell key={col.key} className={col.className}>
                    {col.render(row)}
                  </TableCell>
                ))}
                {action && <TableCell>{action(row)}</TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between border-t bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span>
          Showing {pageRows.length ? page * pageSize + 1 : 0}–{page * pageSize + pageRows.length} of {rows.length}
          {totalCount !== rows.length ? ` (filtered from ${totalCount})` : ""}
        </span>
        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <span>
              Page {page + 1} / {pageCount}
            </span>
            <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
