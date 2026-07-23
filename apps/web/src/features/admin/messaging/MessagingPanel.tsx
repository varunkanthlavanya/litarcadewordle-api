import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { EventPlayerApiRow } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const TEMPLATES = [
  { key: "advanced", title: "You've advanced to the Finals!", type: "ADVANCED" as const },
  { key: "custom", title: "Custom message", type: "ADMIN_MESSAGE" as const },
];

interface DeliveryResult {
  eventPlayerId: number;
  status: "live" | "queued";
}

export function MessagingPanel() {
  const { eventId } = useParams<{ eventId: string }>();
  const [cohort, setCohort] = useState<EventPlayerApiRow[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [allPlayers, setAllPlayers] = useState(true);
  const [templateKey, setTemplateKey] = useState<(typeof TEMPLATES)[number]["key"]>("advanced");
  const [body, setBody] = useState("Round 2 opens in 10 minutes — head back to the app.");
  const [sending, setSending] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<EventPlayerApiRow[]>(`/admin/events/${eventId}/cohort`).then(setCohort);
  }, [eventId]);

  const filteredCohort = cohort.filter((p) =>
    `${p.display_name ?? ""} ${p.mobile_number}`.toLowerCase().includes(search.toLowerCase())
  );

  function toggle(id: number) {
    setAllPlayers(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const template = TEMPLATES.find((t) => t.key === templateKey)!;
      const recipients = allPlayers ? "all" : [...selected];
      const res = await apiClient.post<{ results: DeliveryResult[] }>(`/admin/events/${eventId}/notifications`, {
        recipients,
        type: template.type,
        title: templateKey === "advanced" ? template.title : body,
        body,
      });
      setDelivery(res.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Messaging</h1>
      <div className="grid gap-8 md:grid-cols-2">
        <section className="space-y-4">
          <div>
            <Label>Recipients</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setAllPlayers(true);
                  setSelected(new Set());
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium",
                  allPlayers ? "border-primary bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                )}
              >
                All players ({cohort.length})
              </button>
            </div>
            <Input
              className="mt-2"
              placeholder="Search player or mobile number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="mt-2 max-h-40 overflow-y-auto rounded-md border">
              {filteredCohort.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-muted",
                    !allPlayers && selected.has(p.id) && "bg-accent/20"
                  )}
                >
                  <span>{p.display_name ?? p.mobile_number}</span>
                  {!allPlayers && selected.has(p.id) && <Badge variant="secondary">selected</Badge>}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Template</Label>
            <Select value={templateKey} onValueChange={(v) => setTemplateKey(v as typeof templateKey)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATES.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="body">Message</Label>
            <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleSend} disabled={sending || (!allPlayers && selected.size === 0)}>
            {sending ? "Sending..." : "Send"}
          </Button>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Delivery</h2>
          {!delivery && <p className="text-sm text-muted-foreground">Send a message to see delivery status.</p>}
          {delivery && (
            <ul className="divide-y rounded-md border">
              {delivery.map((d) => {
                const player = cohort.find((p) => p.id === d.eventPlayerId);
                return (
                  <li key={d.eventPlayerId} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{player?.display_name ?? player?.mobile_number ?? d.eventPlayerId}</span>
                    <Badge variant={d.status === "live" ? "success" : "warning"}>
                      {d.status === "live" ? "Live" : "Queued"}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
