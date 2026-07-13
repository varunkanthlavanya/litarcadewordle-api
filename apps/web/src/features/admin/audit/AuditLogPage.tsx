import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { AuditLogApiRow } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function AuditLogPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [entries, setEntries] = useState<AuditLogApiRow[]>([]);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [adminFilter, setAdminFilter] = useState("all");

  useEffect(() => {
    apiClient.get<AuditLogApiRow[]>(`/admin/events/${eventId}/audit`).then(setEntries);
  }, [eventId]);

  const actionTypes = useMemo(() => [...new Set(entries.map((e) => e.action_type))], [entries]);
  const admins = useMemo(() => [...new Set(entries.map((e) => e.admin_label))], [entries]);

  const filtered = entries.filter((e) => {
    if (actionFilter !== "all" && e.action_type !== actionFilter) return false;
    if (adminFilter !== "all" && e.admin_label !== adminFilter) return false;
    if (search) {
      const haystack = `${e.action_type} ${JSON.stringify(e.target_ids ?? "")} ${e.reason ?? ""}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Audit Log</h1>

      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          placeholder="Search action or target"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Action: All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Action: All</SelectItem>
            {actionTypes.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={adminFilter} onValueChange={setAdminFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Admin: All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Admin: All</SelectItem>
            {admins.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono text-xs">{new Date(e.created_at).toLocaleString()}</TableCell>
                <TableCell>{e.admin_label}</TableCell>
                <TableCell>{e.action_type}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {e.target_type ? `${e.target_type}: ${JSON.stringify(e.target_ids)}` : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">{e.reason ?? "—"}</TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No audit entries yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
