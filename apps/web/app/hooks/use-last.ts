import { useRef } from "react";

/**
 * The latest value that was not null or undefined. A route's loader data disappears as soon as the router leaves the route, but
 * the detail panel keeps the route's element on screen for its exit animation: this keeps what it was showing.
 */
export function useLast<T>(value: T | null | undefined): T | undefined {
  const last = useRef<T | undefined>(undefined);
  if (value !== null && value !== undefined) last.current = value;
  return last.current;
}
