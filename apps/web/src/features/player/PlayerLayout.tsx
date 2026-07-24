import { Outlet } from "react-router-dom";
import { NotificationCenter } from "./notifications/NotificationCenter";

/** Wraps every authenticated player route so the notification center (live toasts +
 * missed-while-offline resurfacing) is available regardless of which screen they're on.
 * Also the one place the player-facing visual language (serif type, square
 * corners — see .wl-player-shell in index.css) gets applied, so every route
 * nested here inherits it without needing its own wrapper class. */
export function PlayerLayout() {
  return (
    <div className="wl-player-shell font-serif">
      <NotificationCenter />
      <Outlet />
    </div>
  );
}
