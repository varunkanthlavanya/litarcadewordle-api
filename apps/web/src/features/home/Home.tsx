import { Link } from "react-router-dom";
import { PlayerLoginForm } from "@/features/player/auth/PlayerLoginForm";
import { EntertainmentPartners } from "@/components/shared/EntertainmentPartners";

// The wordmark: each letter of WORDLE styled like a game tile, echoing the
// actual gameplay tiles rather than a generic logo mark.
const WORDMARK_TILES = [
  { letter: "W", color: "bg-tile-green" },
  { letter: "O", color: "bg-tile-yellow" },
  { letter: "R", color: "bg-tile-gray" },
  { letter: "D", color: "bg-tile-gray" },
  { letter: "L", color: "bg-tile-yellow" },
  { letter: "E", color: "bg-tile-green" },
] as const;

export function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[oklch(0.94_0.012_75)] px-5 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background px-8 py-10 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]">
        <div className="flex w-full flex-col items-center">
          <div className="mb-2.5 flex gap-[5px]">
            {WORDMARK_TILES.map(({ letter, color }) => (
              <div
                key={letter}
                className={`flex h-[30px] w-[30px] items-center justify-center rounded-[5px] font-mono text-[15px] font-bold text-white ${color}`}
              >
                {letter}
              </div>
            ))}
          </div>
          <h1 className="text-2xl font-extrabold tracking-[0.08em]">LEAGUE</h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            A two-stage Wordle tournament — Prelims speed round, then Finals reverse-Wordle showdown.
          </p>

          <PlayerLoginForm />

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Are you an event admin?{" "}
            <Link to="/admin" className="font-medium text-foreground underline underline-offset-2 hover:text-primary">
              Enter admin console
            </Link>
          </p>

          <p className="mt-4 text-center text-xs text-muted-foreground">Having trouble? Ask your event coordinator.</p>
        </div>
      </div>

      <EntertainmentPartners />
    </div>
  );
}
