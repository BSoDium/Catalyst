import { useEffect, useState } from "react";
import { useNavigation } from "react-router";

/** Wait this long before showing the line: a navigation that answers within it (most of them) shows nothing. */
const SHOW_AFTER_MS = 150;

/**
 * Page-level loading state: a thin signal line at the top of the viewport while a navigation is pending (`.nav-progress`, app.css),
 * plus a polite "Loading" for screen readers. Decorative otherwise: the page underneath stays usable.
 */
export function NavProgress() {
  const pending = useNavigation().state !== "idle";
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!pending) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [pending]);
  return (
    <>
      <div aria-hidden="true" className="nav-progress" data-active={shown ? "" : undefined} />
      <span role="status" className="sr-only">
        {shown ? "Loading" : ""}
      </span>
    </>
  );
}
