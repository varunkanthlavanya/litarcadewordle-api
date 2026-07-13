import { Outlet } from "react-router-dom";
import { NotificationCenter } from "./notifications/NotificationCenter";

/** Wraps every authenticated player route so the notification center (live toasts +
 * missed-while-offline resurfacing) is available regardless of which screen they're on. */
export function PlayerLayout() {
  return (
    <>
      <NotificationCenter />
      <Outlet />
    </>
  );
}
