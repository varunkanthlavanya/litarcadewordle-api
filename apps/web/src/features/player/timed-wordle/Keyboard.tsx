import { cn } from "@/lib/utils";

const ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

interface KeyboardProps {
  onKey: (key: string) => void;
  onEnter: () => void;
  onBackspace: () => void;
  disabled?: boolean;
  letterStatus: Record<string, "GREEN" | "YELLOW" | "GRAY" | undefined>;
}

const STATUS_CLASSES: Record<string, string> = {
  GREEN: "bg-tile-green text-white",
  YELLOW: "bg-tile-yellow text-white",
  GRAY: "bg-tile-gray text-white",
};

export function Keyboard({ onKey, onEnter, onBackspace, disabled, letterStatus }: KeyboardProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {ROWS.map((row, rowIndex) => (
        <div key={rowIndex} className="flex justify-center gap-1">
          {rowIndex === 2 && (
            <KeyButton wide onClick={onEnter} disabled={disabled}>
              Enter
            </KeyButton>
          )}
          {row.split("").map((letter) => (
            <KeyButton
              key={letter}
              onClick={() => onKey(letter)}
              disabled={disabled}
              className={STATUS_CLASSES[letterStatus[letter] ?? ""]}
            >
              {letter}
            </KeyButton>
          ))}
          {rowIndex === 2 && (
            <KeyButton wide onClick={onBackspace} disabled={disabled}>
              ⌫
            </KeyButton>
          )}
        </div>
      ))}
    </div>
  );
}

function KeyButton({
  children,
  onClick,
  disabled,
  wide,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  wide?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-11 items-center justify-center rounded-md bg-secondary px-2 text-xs font-semibold uppercase text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:pointer-events-none disabled:opacity-50 sm:text-sm",
        wide ? "min-w-[3.5rem] px-3" : "min-w-[2rem] flex-1 sm:min-w-[2.5rem]",
        className
      )}
    >
      {children}
    </button>
  );
}
