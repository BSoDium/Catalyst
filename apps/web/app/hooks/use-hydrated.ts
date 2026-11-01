import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** `true` once the page is hydrated: false on the server and in the hydration pass, so what only the browser knows (a history entry's `state`) never makes the first client render differ from the server's. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
