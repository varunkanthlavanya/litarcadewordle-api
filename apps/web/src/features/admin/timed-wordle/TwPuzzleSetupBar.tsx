import { useState } from "react";
import type { EventApiRow } from "@litarcadewordle/shared-types";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface TwPuzzleSetupBarProps {
  eventId: number;
  puzzle: { secret_word: string; definition: string | null; status: "SCHEDULED" | "OPEN" | "CLOSED" } | null;
  onChanged: () => void;
}

export function TwPuzzleSetupBar({ eventId, puzzle, onChanged }: TwPuzzleSetupBarProps) {
  const [secretWord, setSecretWord] = useState("");
  const [definition, setDefinition] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post(`/admin/events/${eventId}/timed-wordle/puzzle`, { secretWord, definition });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create puzzle");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleRound() {
    if (!puzzle) return;
    const nextStatus = puzzle.status === "OPEN" ? "CLOSED" : "OPEN";
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post(`/admin/events/${eventId}/timed-wordle/puzzle/status`, { status: nextStatus });
      onChanged();
    } catch (err) {
      // Previously uncaught — a failed request here just did nothing
      // visible at all, which looked exactly like a broken "Open Round"
      // button instead of showing whatever actually went wrong.
      setError(err instanceof Error ? err.message : "Could not update round status");
    } finally {
      setSubmitting(false);
    }
  }

  if (!puzzle) {
    return (
      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <div className="space-y-1">
          <Label htmlFor="secretWord">Secret word</Label>
          <Input
            id="secretWord"
            value={secretWord}
            onChange={(e) => setSecretWord(e.target.value.toUpperCase())}
            maxLength={5}
            className="w-32 font-mono uppercase"
            required
          />
        </div>
        <div className="flex-1 space-y-1">
          <Label htmlFor="definition">Definition</Label>
          <Input id="definition" value={definition} onChange={(e) => setDefinition(e.target.value)} />
        </div>
        <Button type="submit" disabled={submitting}>
          Create Puzzle
        </Button>
        {error && <p className="w-full text-sm text-destructive">{error}</p>}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Secret word</p>
        <p className="font-mono text-lg font-bold">{puzzle.secret_word}</p>
      </div>
      {puzzle.definition && <p className="flex-1 text-sm italic text-muted-foreground">{puzzle.definition}</p>}
      <Badge variant={puzzle.status === "OPEN" ? "success" : "secondary"}>
        {puzzle.status === "OPEN" ? "● Round Open" : puzzle.status === "CLOSED" ? "Round Closed" : "Round Scheduled"}
      </Badge>
      <Button
        variant={puzzle.status === "OPEN" ? "destructive" : "default"}
        size="sm"
        onClick={toggleRound}
        disabled={submitting}
      >
        {puzzle.status === "OPEN" ? "Close Round" : "Open Round"}
      </Button>
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </div>
  );
}
