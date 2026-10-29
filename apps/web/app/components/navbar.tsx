import { useEffect, useLayoutEffect, useRef } from "react";
import { NavLink, useLocation, useMatches } from "react-router";
import { SearchPalette, SearchTriggers } from "~/components/search-palette";
import { SectionsMenu } from "~/components/sections-menu";
import { CAREER_LABEL, CAREER_PATH } from "~/lib/career";
import { KIND_PATHS, KIND_PLURALS, parsePanelPath, parseView } from "~/lib/entries";
import { GESTURE_GUARD_CAP_MS, GESTURE_GUARD_MS, GestureGuard } from "~/lib/gesture-guard";
import { markLeftHome, useHeroResting } from "~/lib/hero-rest";
import { useHasCareer } from "~/lib/use-has-career";
import { useSectionCounts } from "~/lib/use-section-counts";
import { SITE_NAME } from "~/lib/site";
import { cn } from "~/lib/utils";

/** Re-exported for the tests that name the guard's length. */
export { GESTURE_GUARD_CAP_MS, GESTURE_GUARD_MS };
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Guards the header that appears BECAUSE OF a gesture on the home page (the hero stepping back): while `data-guard` is on it, CSS (app.css,
 * `[data-slot="site-header"][data-guard]`) makes its controls ignore the pointer, so the click that gesture produces lands on the globe
 * beneath, which has no click behaviour. A touch tap fires its click at whatever is under the finger when the finger lifts: the header's row is
 * there by then, and a tap near the top of the globe would activate a link nobody aimed at (observed: "Articles", navigating away). The guard
 * ends `GESTURE_GUARD_MS` after the pointer sequence that is going on has ended (or after the header appeared when none is), and in any case
 * `GESTURE_GUARD_CAP_MS` after it appeared (`lib/gesture-guard.ts`: a pointerup that never came must not leave the header inert). Only
 * `pointer-events`: the header stays visible, keyboard focus and assistive technology are not affected (activating a link by them dispatches a
 * click on the element itself). Every other way the header comes (a route change, a load) is not guarded.
 */
function useGestureGuard(bar: boolean, onHome: boolean, ref: { current: HTMLElement | null }) {
  const was = useRef(bar);
  const guard = useRef<GestureGuard | null>(null);
  guard.current ??= new GestureGuard();
  useEffect(() => {
    const g = guard.current!;
    const down = (e: Event) => g.pointerDown((e as PointerEvent).pointerId ?? 0);
    const up = (e: Event) => g.pointerUp((e as PointerEvent).pointerId ?? 0, performance.now());
    const reset = () => g.reset(performance.now());
    const hidden = () => {
      if (document.hidden) reset();
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", down, opts);
    window.addEventListener("pointerup", up, opts);
    window.addEventListener("pointercancel", up, opts);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pointerdown", down, opts);
      window.removeEventListener("pointerup", up, opts);
      window.removeEventListener("pointercancel", up, opts);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  useIsoLayoutEffect(() => {
    const appeared = bar && !was.current;
    was.current = bar;
    const el = ref.current;
    if (!appeared || !onHome || !el) return;
    const g = guard.current!;
    const at = performance.now();
    el.setAttribute("data-guard", "");
    let timer = 0;
    const check = () => {
      if (g.mayRelease(at, performance.now())) {
        el.removeAttribute("data-guard");
        return;
      }
      timer = window.setTimeout(check, 50);
    };
    timer = window.setTimeout(check, GESTURE_GUARD_MS);
    return () => {
      window.clearTimeout(timer);
      el.removeAttribute("data-guard");
    };
  }, [bar, onHome, ref]);
}

/** The first item names the globe (the home page): the site's own name is the landing hero's headline and the document title, not the row's. */
const HOME_LABEL = "Globe";

/** In the narrow form's drawer "Globe" is a section like the others, the first: the home page, and the places on it. */
const HOME_ITEM = { to: "/", label: HOME_LABEL } as const;

/** The sections, in the header's order (the hero's rows have the same): paths and names come from the kinds' tables (`Poetry` at `/poetry`). */
const LINKS = (["project", "article", "artwork", "poem", "photograph"] as const).map((kind) => ({ to: KIND_PATHS[kind], label: KIND_PLURALS[kind], kind }));

/** The career page, after the sections and only while the projection has a career document (`useHasCareer`). Not a content kind. */
const CAREER_LINK = { to: CAREER_PATH, label: CAREER_LABEL } as const;

interface NavbarProps {
  /** A fixed answer in place of the projection's (tests): whether the career link is drawn. */
  hasCareer?: boolean | undefined;
  /** A fixed answer in place of the hero's published state (tests: the server snapshot is always "at rest"). */
  heroResting?: boolean | undefined;
}

/**
 * One row of mono capitals (`.nav-link`, app.css: size, tracking and the gap between items follow the room the row has, because the header
 * is a size container: with the place panel open the row has half of the viewport). 44 px by 44 px targets, also for the shortest word ("Globe" at 320 px). The current one is in the
 * foreground and underlined, the others muted, and the pointer or the keyboard turns an item to the accent.
 */
const linkClass = "nav-link pointer-events-auto inline-flex min-h-11 min-w-11 items-center justify-center";

/**
 * The navigation, centred at the top of the viewport; no logo. (In the narrow form, a phone or the half beside the panel, it is the section selector at the left and the search at the right: "Globe" is a row of the selector's drawer, `SectionsMenu`.) Its parts, in reading and focus order: "Globe" (the way home: the globe is
 * the home page; the site's name is the landing hero's headline), the four sections, the search trigger.
 *
 * On the home page, while the landing hero is at rest, there is NO header at all (owner, 2026-10-13): the hero's four rows are the
 * sections and its own search line is the search with its key hint (docs/landing.md), so a bar above them would only repeat them. The
 * hero's list is the page's one "Primary" navigation then, and Cmd/Ctrl-K opens the palette as everywhere. The header comes back
 * whenever the hero is not at rest (a gesture on the globe, a zoomed-in view: its rows are hidden then) and on every other route.
 * The palette is mounted next to the header, not in it, so it stays open (and keeps its query) while the header comes and goes.
 *
 * Where it is centred. Over the whole viewport on every page, except while the place or entry panel sits beside the globe (desktop, `md`
 * and up): then the row is centred over the free left half, the map, so it neither crosses the panel's own header (close and expand) nor
 * floats over the panel's text. The right edge of the header follows the panel's slide (same duration and easing). In the full-screen
 * entry view the panel covers the viewport, the header is centred over all of it and the panel's controls are at the left, clear of it.
 * On a phone the panel is a dialog above this header, which stays centred over the whole screen.
 *
 * The header is a size container (`@container`): what the row shows depends on its own width. From 28 rem the search trigger is shown,
 * from 36 rem its key hint; below that the row is the five items and, in place of the icon, the one word "Search" (a 44 px target, fits a
 * 360 px phone: `.nav-link` shrinks its size, tracking and gaps by container width).
 *
 * Readability. No background, border or blur of its own: where content scrolls under the row (the lists, the entries) `PageNavScrim`
 * fades it; over the globe and the map (the shell) the row brings a short fade of its own (`.nav-fade`, app.css): the page colour at 85 %
 * at the top edge easing to nothing, as wide as the row plus a soft margin, so the globe is not dimmed across the whole width. The bar itself
 * ignores the pointer so that wheel and touch gestures in the strip still reach the content underneath.
 */
export function Navbar({ heroResting: forced, hasCareer: forcedCareer }: NavbarProps) {
  const storedCareer = useHasCareer();
  const withCareer = forcedCareer ?? storedCareer;
  const links: readonly { to: string; label: string; kind?: (typeof LINKS)[number]["kind"] }[] = withCareer ? [...LINKS, CAREER_LINK] : LINKS;
  const counts = useSectionCounts();
  const { pathname, search } = useLocation();
  const onGlobe = useMatches().some((m) => m.id === "routes/shell");
  const route = parsePanelPath(pathname);
  const fullScreen = route?.type === "entry" && parseView(search) === "full";
  // The panel sits beside the globe: the right half of the viewport is its.
  const beside = route !== null && !fullScreen;
  // The home page's hero shows the sections and the search itself while it is at rest: no header then.
  const stored = useHeroResting();
  const heroResting = forced ?? stored;
  const bar = !(pathname === "/" && heroResting);
  const headerRef = useRef<HTMLElement>(null);
  // The landing hero starts collapsed when the visitor comes back to the home page from another one (`lib/hero-rest.ts`).
  useEffect(() => {
    if (pathname !== "/") markLeftHome();
  }, [pathname]);
  useGestureGuard(bar, pathname === "/", headerRef);
  return (
    <>
      {bar && (
        <header
          ref={headerRef}
          data-slot="site-header"
          data-career={withCareer ? "" : undefined}
          data-globe={onGlobe ? "" : undefined}
          className={cn(
            "@container pointer-events-none fixed top-0 right-0 left-0 z-40",
            "md:transition-[right] md:duration-(--duration-slow) md:ease-(--ease-standard)",
            beside && "md:right-1/2",
          )}
        >
          <div className="flex h-(--navbar-height) items-center justify-center px-2">
            <nav aria-label="Primary" className="relative flex items-center">
              {/* The full-screen entry view has its own, panel-wide fade (detail-panel.tsx); the lists have the page one (nav-scrim.tsx). */}
              {onGlobe && !fullScreen && <span aria-hidden="true" className="nav-fade print:hidden" />}
              <NavLink
                to="/"
                end
                data-nav="home"
                aria-label={`${HOME_LABEL}, ${SITE_NAME} home`}
                className={({ isActive }) => cn(linkClass, isActive ? "text-foreground underline decoration-1 underline-offset-8" : "text-muted-foreground")}
              >
                {HOME_LABEL}
              </NavLink>
              <ul className="nav-inline">
                {links.map((link) => (
                  <li key={link.to} data-nav-item={link.to === CAREER_PATH ? "career" : undefined}>
                    <NavLink
                      to={link.to}
                      prefetch="intent"
                      className={({ isActive }) =>
                        cn(linkClass, isActive ? "text-foreground underline decoration-1 underline-offset-8" : "text-muted-foreground")
                      }
                    >
                      {link.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
              <SectionsMenu items={[HOME_ITEM, ...links]} counts={counts} />
              <SearchTriggers />
            </nav>
          </div>
        </header>
      )}
      <SearchPalette />
    </>
  );
}
