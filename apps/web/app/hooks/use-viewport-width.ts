import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

const getSnapshot = () => document.documentElement.clientWidth;
// Unknown on the server and during hydration (the globe, the only consumer, renders after hydration).
const getServerSnapshot = () => 0;

/** Layout viewport width in CSS px (excludes a scrollbar), live on resize. */
export function useViewportWidth(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
