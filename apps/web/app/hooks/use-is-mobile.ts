import { useSyncExternalStore } from "react";
import { MOBILE_QUERY } from "~/lib/tokens";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const getSnapshot = () => window.matchMedia(MOBILE_QUERY).matches;
// The server (and the hydration pass) always renders the desktop markup.
const getServerSnapshot = () => false;

/** `true` below 768px. Hydration-safe: false on the server, corrected right after hydration. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
