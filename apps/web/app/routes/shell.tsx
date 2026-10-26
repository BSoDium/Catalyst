import { useReducedMotion } from "motion/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useLocation, useMatches, useNavigate, useOutlet } from "react-router";
import type { Route } from "./+types/shell";
import { AttributionSlot } from "~/components/attribution-slot";
import { DetailPanel, type OpenIntent } from "~/components/detail-panel";
import { LandingHero } from "~/components/landing-hero";
import { PlacesNav } from "~/components/places-nav";
import { Globe, placeFraming, ringPhrases, type GlobeInitialView, type GlobeViewState } from "~/globe";
import { useIsMobile } from "~/hooks/use-is-mobile";
import { useLandingHero } from "~/hooks/use-landing-hero";
import { useViewportWidth } from "~/hooks/use-viewport-width";
import { getProjection } from "~/lib/content.server";
import { getTilesConfig } from "~/lib/tiles-config.server";
import { focusPlaceOf, KIND_PATHS, KIND_PLURALS, parsePanelPath, parseView, resolveBackTarget, viewSearch, type EntryView } from "~/lib/entries";
import { panelInset } from "~/lib/layout";
import { buildPlaceIndex, placePath, toGlobeGroups } from "~/lib/projection";
import { countryGroupOf, parseCountryParam } from "~/lib/country";
import { ARCHIVED_V1, SITE, siteCaption, type KindCounts } from "~/lib/site";

/** The sections the no-script text lists, in the order of the header (the names and addresses are `lib/sections.ts`'s). */
const NOSCRIPT_KINDS = ["project", "article", "artwork", "poem", "photograph"] as const;

/** The words of the globe's ring of type: the site's identity (name, role, fields, place), the same constant the head tags and the hero read. */
const RING_PHRASES = ringPhrases(SITE);
/** The moon that circles the globe: a link to the first version of the site (`ARCHIVED_V1`). */
const MOON_LINK = { href: ARCHIVED_V1.url, title: ARCHIVED_V1.title, description: ARCHIVED_V1.description, cta: ARCHIVED_V1.cta } as const;
/** The caption that floats over the planet with it: what the site is and what to do (it replaces the hero's how-to line while the globe has the caption). */
const NO_PHRASES = { sets: [], fixed: [] } as const;

export async function loader() {
  // `tiles` is the street map's tile source configuration (CATALYST_TILES_* read at request time, see
  // docs/street-architecture.md). The globe hands over to the street map with it (docs/web-architecture.md).
  const projection = await getProjection();
  // How much of each kind there is (the caption's third phrase set): the projection's own collections.
  const counts: KindCounts = { project: projection.projects.length, article: projection.articles.length, artwork: projection.artworks.length, poem: projection.poems.length, photograph: projection.photographs.length };
  return { ...buildPlaceIndex(projection), tiles: getTilesConfig(), counts };
}

/** The place index never changes between navigations inside the shell. */
export function shouldRevalidate() {
  return false;
}

/**
 * Pathless layout for `/`, `/locations/:slug` and the entries (`/articles/:slug`, `/software/:slug`, `/artworks/:slug`,
 * `/poetry/:slug`): one full-bleed globe instance, the keyboard path to the places (`PlacesNav`, visually hidden until
 * focused), and the detail panel (whose content is the child route). An entry opens in the side panel or, with `?view=full`,
 * in the full-screen container: the panel widens over the SAME globe, which stays mounted and keeps its view.
 */
export default function Shell({ loaderData }: Route.ComponentProps) {
  const { places, globePlaces, groups, routes, tiles, counts } = loaderData;
  // The caption's rows (built once: the globe reads them once, when it is created).
  const captionPhrases = useMemo(() => siteCaption(counts), [counts]);
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
  // An entry's own places (its route's data): with no place it was opened from, the globe goes to the first of them.
  const matches = useMatches();
  const entryData = panelRoute?.type === "entry" ? (matches.find((m) => (m.data as { entry?: { places?: unknown } } | undefined)?.entry?.places)?.data as { entry: { places: Array<{ slug: string }>; country?: { code: string } } } | undefined)?.entry : undefined;
  const entryPlaces = entryData?.places ?? null;
  const selectedSlug = useMemo(() => {
    const known = (s: string) => places.some((p) => p.slug === s);
    return slug ? (known(slug) ? slug : null) : focusPlaceOf(cameFrom, entryPlaces, known);
  }, [places, slug, cameFrom, entryPlaces]);
  // A country to frame and no place to select: the home page asked for one (`/?country=BR`, the link of an entry whose only location is its
  // country), or such an entry is open in the panel. The globe frames the country's group (`lib/country.ts`); nothing is selected.
  const countryCode = location.pathname === "/" ? parseCountryParam(location.search) : selectedSlug === null ? (entryData?.country?.code ?? null) : null;
  const framedGroup = useMemo(() => (countryCode ? countryGroupOf(countryCode, places, groups) : null), [countryCode, places, groups]);
  // A direct load or reload on /locations/:slug starts ALREADY framed on the place (centred on its bounding box, else on
  // its point, with the framing radius fitted to the free area): derived from the loader's data, so the very first frame
  // is the final one and nothing flies. A saved view (the globe remounting after the mobile slide-over) wins. In-app
  // selections still fly (the globe handles those).
  const startView = useMemo<GlobeInitialView | null>(() => {
    const p = globePlaces.find((g) => g.slug === selectedSlug);
    const f = p && placeFraming(p);
    if (f) return { lon: f.lon, lat: f.lat, fitRadiusKm: f.radiusKm };
    const g = framedGroup ? groups.find((x) => x.slug === framedGroup) : undefined;
    return g ? { lon: g.coordinates.lon, lat: g.coordinates.lat, fitRadiusKm: g.viewRadiusKm } : null;
  }, [globePlaces, selectedSlug, framedGroup, groups]);

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
  const hero = useLandingHero(isOpen);
  // The globe has the caption (it is up, and the page does not switch it off): the hero's how-to line is then said by the caption and is
  // kept for assistive technology only (visually hidden). Nothing else of the shell depends on it.
  const [orbit, setOrbit] = useState<boolean | null>(null);
  const empty = places.length === 0;
  const heroOnView = hero.onView;
  const saveView = useCallback(
    (view: GlobeViewState) => {
      viewRef.current = view;
      heroOnView(view);
    },
    [heroOnView],
  );

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
        <div className="absolute inset-0">
          {globeActive && (
            <Globe
              places={globePlaces}
              groups={globeGroups}
              routes={routes}
              selectedSlug={selectedSlug}
              focusedSlug={focusedSlug}
              framedGroup={framedGroup}
              initialView={viewRef.current ?? startView}
              reducedMotion={reducedMotion}
              insetRight={insetRight}
              tiles={tiles}
              attribution={AttributionSlot}
              ringPhrases={RING_PHRASES}
              moon={MOON_LINK}
              captionPhrases={empty ? NO_PHRASES : captionPhrases}
              showcase={hero.showcase}
              onOrbit={setOrbit}
              onSelect={select}
              onViewChange={saveView}
              onInteract={hero.onInteract}
            />
          )}
          {/* Only the globe needs JavaScript: the lists, the entries and the places are server-rendered pages that read and navigate without it. */}
          <noscript>
            <p className="absolute inset-y-0 left-0 m-0 flex w-full items-center justify-center px-6 text-center text-sm text-muted-foreground md:w-1/2 [&_a]:underline">
              <span className="max-w-xs">
                The globe needs JavaScript. The{" "}
                {NOSCRIPT_KINDS.map((kind, i) => (
                  <span key={kind}>
                    {i > 0 && (i === NOSCRIPT_KINDS.length - 1 ? " and " : ", ")}
                    <a href={KIND_PATHS[kind]}>{KIND_PLURALS[kind].toLowerCase()}</a>
                  </span>
                ))}{" "}
                are readable without it.
              </span>
            </p>
          </noscript>
        </div>
        {/* The landing hero: the globe page's h1 (the panel's title is the h1 while a place or entry is open) and the way into the lists. */}
        <LandingHero machine={hero.machine} away={isOpen} empty={empty} orbit={orbit} onCover={hero.setCover} />
        <PlacesNav places={places} groups={groups} currentSlug={selectedSlug} onFocusSlug={setFocusedSlug} onOpen={markUserIntent} />
      </main>
      <DetailPanel
        open={isOpen}
        isMobile={isMobile}
        reducedMotion={reducedMotion}
        routeKey={panelRoute ? location.pathname : null}
        returnSlug={slug}
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
