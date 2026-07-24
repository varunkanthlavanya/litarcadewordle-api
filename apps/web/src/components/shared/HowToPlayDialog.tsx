import type { TileColor } from "@litarcadewordle/shared-types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { WordleTile, type WordleTileState } from "@/components/shared/WordleTile";

const TILE_COLOR_TO_STATE: Record<TileColor, WordleTileState> = {
  GREEN: "correct",
  YELLOW: "present",
  GRAY: "absent",
};

export interface HowToPlayExample {
  /** A whole 5-letter word shown as the example row — only `highlightIndex`
   * is actually colored (see reference: real Wordle's own "How to Play"
   * only colors the one tile being explained, leaving the rest plain, so
   * the reader's eye isn't split across five things at once). */
  word: string;
  highlightIndex: number;
  color: TileColor;
  caption: string;
}

export interface HowToPlayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gameName: string;
  tagline: string;
  rules: string[];
  examples: HowToPlayExample[];
  closingNote: string;
}

function ExampleRow({ word, highlightIndex, color, caption }: HowToPlayExample) {
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        {word.split("").map((letter, i) => (
          <WordleTile
            key={i}
            size="sm"
            state={i === highlightIndex ? TILE_COLOR_TO_STATE[color] : "empty"}
            letter={letter}
          />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        <span className="font-bold text-foreground">{word[highlightIndex]}</span> {caption}
      </p>
    </div>
  );
}

/** Shared "How to Play" presentation for both games — each is really 5-6
 * distinct cards of content (intro, rules, one per tile color, a closing
 * note), matching the reference screenshot's structure. The two games only
 * differ in copy (passed in by the caller), never in this layout. */
export function HowToPlayDialog({ open, onOpenChange, gameName, tagline, rules, examples, closingNote }: HowToPlayDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <div className="space-y-5">
          <div>
            <DialogTitle className="text-2xl font-extrabold">How To Play</DialogTitle>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">{gameName}</p>
          </div>

          <p className="text-sm">{tagline}</p>

          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {rules.map((rule, i) => (
              <li key={i}>{rule}</li>
            ))}
          </ul>

          <div className="space-y-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Examples</p>
            {examples.map((example, i) => (
              <ExampleRow key={i} {...example} />
            ))}
          </div>

          <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">{closingNote}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
