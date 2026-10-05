import { useReducedMotion } from "motion/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useMatch, useNavigate, useOutlet, useParams } from "react-router";
import type { Route } from "./+types/shell";
import { DetailPanel, type OpenIntent } from "~/components/detail-panel";
import { PlacesNav } from "~/components/places-nav";
import { Globe, type GlobeViewState } from "~/globe";
import { useIsMobile } from "~/hooks/use-is-mobile";
import { useViewportWidth } from "~/hooks/use-viewport-width";
import { getProjection } from "~/lib/content.server";
import { getTilesConfig } from "~/lib/tiles-config.server";
import { panelInset } from "~/lib/layout";
import { buildPlaceIndex, placePath } from "~/lib/projection";

export async function loader() {
  // `tiles` is the street map's tile source configuration (CATALYST_TILES_* read at request time, see
  // docs/street-architecture.md). The globe hands over to the street map with it (docs/web-architecture.md).
  return { ...buildPlaceIndex(await getProjection()), tiles: getTilesConfig() };
}

/** The place index never changes between navigations inside the shell. */
export function shouldRevalidate() {
  return false;
}

/**
 * Pathless layout for `/` and `/locations/:slug`: one full-bleed globe instance, the keyboard path to the
 * places (`PlacesNav`, visually hidden until focused), and the detail panel (whose content is the child route).
 */
export default function Shell({ loaderData }: Route.ComponentProps) {
  const { places, globePlaces, routes, tiles } = loaderData;
  const params = useParams();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const isOpen = useMatch("/locations/:slug") !== null;
  const isMobile = useIsMobile();
  const reducedMotion = useReducedMotion() ?? false;
  const viewportWidth = useViewportWidth();

  const [focusedSlug, setFocusedSlug] = useState<string | null>(null);
  // View state lives here so it survives the globe being unmounted behind the mobile slide-over.
  const viewRef = useRef<GlobeViewState | null>(null);
  const intent = useRef<OpenIntent>({ user: false });

  const slug = params.slug ?? null;
  const selectedSlug = useMemo(() => (places.some((p) => p.slug === slug) ? slug : null), [places, slug]);

  const close = useCallback(() => {
    void navigate("/", { preventScrollReset: true });
  }, [navigate]);
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
  const insetRight = panelInset(viewportWidth, isOpen, isMobile);

  return (
    <>
      <main id="main" tabIndex={-1} className="relative h-dvh overflow-hidden outline-none">
        <div className="absolute inset-0">
          {globeActive && (
            <Globe
              places={globePlaces}
              routes={routes}
              selectedSlug={selectedSlug}
              focusedSlug={focusedSlug}
              initialView={viewRef.current}
              reducedMotion={reducedMotion}
              insetRight={insetRight}
              tiles={tiles}
              onSelect={select}
              onViewChange={saveView}
            />
          )}
          {places.length === 0 && (
            <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">
              Nothing on the globe yet.
            </p>
          )}
        </div>
        <PlacesNav places={places} currentSlug={selectedSlug} onFocusSlug={setFocusedSlug} onOpen={markUserIntent} />
      </main>
      <DetailPanel
        open={isOpen}
        isMobile={isMobile}
        reducedMotion={reducedMotion}
        slug={slug}
        intent={intent}
        onClose={close}
      >
        {outlet}
      </DetailPanel>
    </>
  );
}
