import { Orbit } from "lucide-react";
import { NavLink } from "react-router";
import { cn } from "~/lib/utils";

const LINKS = [
  { to: "/projects", label: "Projects" },
  { to: "/articles", label: "Articles" },
  { to: "/artworks", label: "Artworks" },
] as const;

const linkClass =
  "pointer-events-auto inline-flex min-h-11 items-center rounded-md px-2.5 text-sm transition-colors duration-(--duration-fast)";

/**
 * Floating navigation: no background, border or blur of its own (readability over scrolling content comes from
 * `NavScrim`). The logo is an icon-only link home; the section links are text only. The bar itself ignores the
 * pointer so that wheel and touch gestures in the strip still reach the content underneath.
 */
export function Navbar() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40">
      <div className="flex h-(--navbar-height) items-center justify-between gap-2 px-3 md:px-4">
        <NavLink to="/" end aria-label="Catalyst, home" className={cn(linkClass, "-ml-1 min-w-11 justify-center")}>
          <Orbit aria-hidden="true" strokeWidth={1.75} className="size-6" />
        </NavLink>
        <nav aria-label="Primary">
          <ul className="flex items-center">
            {LINKS.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  prefetch="intent"
                  className={({ isActive }) =>
                    cn(
                      linkClass,
                      isActive
                        ? "text-foreground underline decoration-1 underline-offset-8"
                        : "text-muted-foreground hover:text-foreground",
                    )
                  }
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
