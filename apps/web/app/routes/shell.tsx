import { useReducedMotion } from "motion/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useOutlet } from "react-router";
import type { Route } from "./+types/shell";
import { ArchiveEmpty } from "~/components/archive-empty";
import { AttributionSlot } from "~/components/attribution-slot";
import { DetailPanel, type OpenIntent } from "~/components/detail-panel";
import { PlacesNav } from "~/components/places-nav";
import { Globe, placeFraming, type GlobeInitialView, type GlobeViewState } from "~/globe";
import { useIsMobile } from "~/hooks/use-is-mobile";
import { useViewportWidth } from "~/hooks/use-viewport-width";
import { getProjection } from "~/lib/content.server";
import { getTilesConfig } from "~/lib/tiles-config.server";
import { countEntries, KIND_LABELS, parsePanelPath, parseView, resolveBackTarget, viewSearch, type EntryView } from "~/lib/entries";
import { panelInset } from "~/lib/layout";
import { buildPlaceIndex, placePath, toGlobeGroups } from "~/lib/projection";

export async function loader() {
  // `tiles` is the street map's tile source configuration (CATALYST_TILES_* read at request time, see
  // docs/street-architecture.md). The globe hands over to the street map with it (docs/web-architecture.md).
  const projection = await getProjection();
  return { ...buildPlaceIndex(projection), entryCounts: countEntries(projection), tiles: getTilesConfig() };
}

/** The place index never changes between navigations inside the shell. */
export function shouldRevalidate() {
  return false;
}

/**
 * Pathless layout for `/`, `/locations/:slug` and the entries (`/articles/:slug`, `/projects/:slug`, `/artworks/:slug`,
 * `/poems/:slug`): one full-bleed globe instance, the keyboard path to the places (`PlacesNav`, visually hidden until
 * focused), and the detail panel (whose content is the child route). An entry opens in the side panel or, with `?view=full`,
 * in the full-screen container: the panel widens over the SAME globe, which stays mounted and keeps its view.
 */
export default function Shell({ loaderData }: Route.ComponentProps) {
  const { places, globePlaces, groups, routes, tiles, entryCounts } = loaderData;
  const globeGroups = useMemo(() => toGlobeGroups(groups), [groups]);
  const location = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const panelRoute = parsePanelPath(location.pathname);
  const isOpen = panelRoute !== null;
  const view: EntryView = panelRoute?.type === "entry" ? parseView(location.search) : "panel";
  const isMobile = useIsMobile();
  const reducedMotion = useReducedMotion() ?? false;
  const viewportWidth = useViewportWidth();

  const [focusedSlug, setFocusedSlug] = useState<string | null>(null);
  // View state lives here so it survives the globe being unmounted behind the mobile slide-over.
  const viewRef = useRef<GlobeViewState | null>(null);
  const intent = useRef<OpenIntent>({ user: false });

  // The place the globe is on: the open place, or, for an entry opened from a place panel, that place (the entry's route state
  // names it) so the selection and the camera stay where they were.
  const slug = panelRoute?.type === "place" ? panelRoute.slug : null;
  const cameFrom = panelRoute?.type === "entry" ? resolveBackTarget(location.state, places)?.slug ?? null : null;
  const selectedSlug = useMemo(() => {
    const wanted = slug ?? cameFrom;
    return places.some((p) => p.slug === wanted) ? wanted : null;
  }, [places, slug, cameFrom]);
  // A direct load or reload on /locations/:slug starts ALREADY framed on the place (centred on its bounding box, else on
  // its point, with the framing radius fitted to the free area): derived from the loader's data, so the very first frame
  // is the final one and nothing flies. A saved view (the globe remounting after the mobile slide-over) wins. In-app
  // selections still fly (the globe handles those).
  const startView = useMemo<GlobeInitialView | null>(() => {
    const p = globePlaces.find((g) => g.slug === selectedSlug);
    const f = p && placeFraming(p);
    return f ? { lon: f.lon, lat: f.lat, fitRadiusKm: f.radiusKm } : null;
  }, [globePlaces, selectedSlug]);

  const close = useCallback(() => {
    void navigate("/", { preventScrollReset: true });
  }, [navigate]);
  // The container is part of the URL (`?view=full`): a history entry, so Back collapses; the router state (where the visitor came from) is kept.
  const setView = useCallback(
    (next: EntryView) => {
      void navigate({ pathname: location.pathname, search: viewSearch(location.search, next) }, { preventScrollReset: true, state: location.state });
    },
    [navigate, location.pathname, location.search, location.state],
  );
  const select = useCallback(
    (next: string) => {
      intent.current.user = true;
      void navigate(placePath(next), { preventScrollReset: true });
    },
    [navigate],
  );
  const markUserIntent = useCallback(() => {
    intent.current.user = true;
  }, []);
  const saveView = useCallback((view: GlobeViewState) => {
    viewRef.current = view;
  }, []);

  // On mobile the globe is unmounted while the slide-over is open and remounted with the saved view.
  const globeActive = !(isMobile && isOpen);
  // The desktop panel covers the right half: the globe centres itself on the free left half (and animates there).
  // The inset is the same for both containers: the globe does not re-centre when the panel widens (it keeps its state, untouched).
  const insetRight = panelInset(viewportWidth, isOpen, isMobile);
  // Full screen on desktop: the panel is the page's `main`; the globe's `main` steps aside (inert, and the skip link's `#main` moves to the panel).
  const fullScreen = view === "full" && !isMobile;

  return (
    <>
      <main id={fullScreen ? undefined : "main"} tabIndex={-1} inert={fullScreen} className="relative h-dvh overflow-hidden outline-none">
        {/* The globe page's own h1 (the panel's title is the h1 while it is open). */}
        {!isOpen && <h1 className="sr-only">Catalyst</h1>}
        <div className="absolute inset-0">
          {globeActive && (
            <Globe
              places={globePlaces}
              groups={globeGroups}
              routes={routes}
              selectedSlug={selectedSlug}
              focusedSlug={focusedSlug}
              initialView={viewRef.current ?? startView}
              reducedMotion={reducedMotion}
              insetRight={insetRight}
              tiles={tiles}
              attribution={AttributionSlot}
              onSelect={select}
              onViewChange={saveView}
            />
          )}
          {/* Only the globe needs JavaScript: the lists, the entries and the places are server-rendered pages that read and navigate without it. */}
          <noscript>
            <p className="absolute inset-y-0 left-0 m-0 flex w-full items-center justify-center px-6 text-center text-sm text-muted-foreground md:w-1/2 [&_a]:underline">
              <span className="max-w-xs">
                The globe needs JavaScript. The <a href="/articles">articles</a>, <a href="/projects">projects</a>, <a href="/artworks">artworks</a> and{" "}
                <a href="/poems">poems</a> are readable without it.
              </span>
            </p>
          </noscript>
          {/* No place published: the globe stays, with a HUD card that says so and opens the lists. */}
          {places.length === 0 && !isOpen && <ArchiveEmpty counts={entryCounts} />}
        </div>
        <PlacesNav places={places} groups={groups} currentSlug={selectedSlug} onFocusSlug={setFocusedSlug} onOpen={markUserIntent} />
      </main>
      <DetailPanel
        open={isOpen}
        isMobile={isMobile}
        reducedMotion={reducedMotion}
        routeKey={panelRoute ? location.pathname : null}
        returnSlug={slug}
        label={panelRoute?.type === "entry" ? KIND_LABELS[panelRoute.kind] : "Place"}
        layout={view}
        onLayoutChange={panelRoute?.type === "entry" ? setView : undefined}
        intent={intent}
        onClose={close}
      >
        {outlet}
      </DetailPanel>
    </>
  );
}
