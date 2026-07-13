import { Check } from "lucide-react";
import { WordleTile } from "@/components/shared/WordleTile";
import { cn } from "@/lib/utils";
import type { UnwordleRowDto } from "@litarcadewordle/shared-types";

interface UnwordleRowProps {
  row: UnwordleRowDto;
  selected: boolean;
  onSelect: () => void;
}

export function UnwordleRow({ row, selected, onSelect }: UnwordleRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={row.solved}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-2 text-left transition-colors",
        row.solved ? "border-success/40 bg-success-subtle" : "border-border",
        selected && !row.solved && "border-primary ring-1 ring-primary"
      )}
    >
      <div className="grid grid-cols-5 gap-1">
        {row.pattern.map((color, i) => (
          <WordleTile
            key={i}
            size="sm"
            state="pattern"
            patternColor={color}
            letter={row.solved ? row.solvedWord?.[i] ?? "" : ""}
          />
        ))}
      </div>
      {row.solved && (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
          <Check className="h-3.5 w-3.5" />
        </span>
      )}
    </button>
  );
}
