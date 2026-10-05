import { useMatches } from "react-router";
import { cn } from "~/lib/utils";

/**
 * Top scrim under the floating nav: dims what scrolls beneath it so the nav text stays readable. All styling
 * lives in `.nav-scrim` (app.css); see docs/design-tokens.md. Fixed to the viewport unless `className` positions it
 * (the detail panel uses an `absolute` copy that covers only the panel).
 */
export function NavScrim({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("nav-scrim", className)}>
      <span />
      <span />
      <span />
    </div>
  );
}

/**
 * The page-wide scrim. Not rendered on the globe screen: there the page colour is the ocean and the map must not
 * be dimmed; the open detail panel brings its own scrim.
 */
export function PageNavScrim() {
  const onGlobe = useMatches().some((m) => m.id === "routes/shell");
  return onGlobe ? null : <NavScrim />;
}
