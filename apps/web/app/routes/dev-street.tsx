/**
 * DEV ONLY: `/dev/street` mounts the street map alone, for visual checks, failure drills and measurements
 * (apps/web/scripts/street/*). It exists only where `routes.ts` includes it (development, or a build made with
 * CATALYST_DEV_ROUTES=1) and answers 404 anywhere else, so a production deploy never serves it.
 *
 * Query parameters (all optional):
 *   source=primary|fallback         pin the tile source (no probing, failover or recovery)
 *   chaos=block-primary|slow-primary|block-all   break the network the way a failing provider would
 *   chaos-after=ms  chaos-heal=ms   start the chaos late / stop it again (runtime death, recovery)
 *   view=lon,lat,zoom               camera (default Ho Chi Minh City z14.5)
 *   select=slug  inset=px  rm=1  theme=light|dark
 *   reveal=1  sharp=0..1  blend=0..1  capabilities of the compositor
 *   primaryUrl= fallbackUrl= maxFallbackZoom=   override the server's tile configuration
 *   timings=key:ms,...  thresholds=key:value,...   tune the source manager (fast failure drills)
 *   projection=globe|mercator  hud=0 hides the control panel
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { data, useLoaderData, useSearchParams } from "react-router";
import { StreetMapCanvas, type StreetMap, type StreetMapOptions, type StreetTileConfig, type StreetView, type TileStatus } from "~/globe/street";
import { projectLonLat, viewBasis } from "~/globe/engine/geo";
import { getTilesConfig } from "~/lib/tiles-config.server";
import type { GlobePlace, GlobeRoute } from "~/globe/types";

const enabled = () => import.meta.env.DEV || process.env.CATALYST_DEV_ROUTES === "1";

export function loader() {
  if (!enabled()) throw data("Not found", { status: 404 });
  return { tiles: getTilesConfig() };
}

export function meta() {
  return [{ title: "Street map (dev)" }, { name: "robots", content: "noindex" }];
}

const PLACES: GlobePlace[] = [
  { slug: "ho-chi-minh-city", name: "Ho Chi Minh City", lat: 10.7769, lon: 106.7009, labelPriority: 100 },
  { slug: "ben-thanh-market", name: "Ben Thanh Market", lat: 10.7721, lon: 106.698, labelPriority: 60 },
  { slug: "notre-dame-cathedral", name: "Notre-Dame Cathedral", lat: 10.7798, lon: 106.6992, labelPriority: 55 },
  { slug: "independence-palace", name: "Independence Palace", lat: 10.777, lon: 106.6955, labelPriority: 50 },
  { slug: "bach-dang-wharf", name: "Bach Dang Wharf", lat: 10.7748, lon: 106.7066, labelPriority: 40 },
  { slug: "da-nang", name: "Da Nang", lat: 16.0544, lon: 108.2022, labelPriority: 70 },
  { slug: "hue", name: "Hué", lat: 16.4637, lon: 107.5909, labelPriority: 80 },
  { slug: "hanoi", name: "Hanoi", lat: 21.0285, lon: 105.8542, labelPriority: 90 },
  { slug: "paris", name: "Paris", lat: 48.8566, lon: 2.3522, labelPriority: 85 },
  { slug: "kyoto", name: "Kyoto", lat: 35.0116, lon: 135.7681, labelPriority: 75 },
  { slug: "cape-town", name: "Cape Town", lat: -33.9249, lon: 18.4241, labelPriority: 65 },
];

const ROUTES: GlobeRoute[] = [
  {
    id: "vietnam",
    title: "Vietnam",
    points: [PLACES[0]!, PLACES[5]!, PLACES[6]!, PLACES[7]!].map((p) => ({ lat: p.lat, lon: p.lon })),
  },
  {
    id: "saigon-walk",
    title: "Saigon walk",
    points: [PLACES[1]!, PLACES[3]!, PLACES[2]!].map((p) => ({ lat: p.lat, lon: p.lon })),
  },
];

const num = (v: string | null, d: number) => {
  const n = v === null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

function pairs(v: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (v ?? "").split(",")) {
    const [k, val] = part.split(":");
    if (k && val !== undefined && Number.isFinite(Number(val))) out[k] = Number(val);
  }
  return out;
}

type Chaos = "block-primary" | "slow-primary" | "block-all";

/**
 * Break `window.fetch` for the tile hosts, the way a failing provider would. Everything the street map loads from
 * the network goes through `fetch` (probes, primary tiles, PMTiles ranges), so one wrapper covers all of it.
 */
function installChaos(kind: Chaos, tiles: StreetTileConfig, after: number, heal: number | null, slowMs: number): () => void {
  const real = window.fetch;
  const t0 = performance.now();
  const host = (u: string) => {
    try {
      return new URL(u, location.href).host;
    } catch {
      return "";
    }
  };
  const primaryHost = host(tiles.primaryUrl);
  const fallbackHost = tiles.fallbackPmtilesUrl ? host(tiles.fallbackPmtilesUrl) : null;
  const active = () => {
    const t = performance.now() - t0;
    return t >= after && (heal === null || t < heal);
  };
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const h = host(url);
    const isPrimary = h === primaryHost && h !== fallbackHost;
    const isFallback = fallbackHost !== null && h === fallbackHost;
    if (active()) {
      if ((kind === "block-primary" && isPrimary) || (kind === "block-all" && (isPrimary || isFallback))) throw new TypeError(`chaos: ${h} blocked`);
      if (kind === "slow-primary" && isPrimary) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, slowMs);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }
    }
    return real(input, init);
  }) as typeof fetch;
  return () => {
    window.fetch = real;
  };
}

declare global {
  interface Window {
    __streetDev?: {
      status: TileStatus[];
      threeProject(view: StreetView, pts: [number, number][], w: number, h: number): { x: number; y: number; visible: boolean }[];
    };
  }
}

export default function DevStreet() {
  // Not `Route.ComponentProps`: the generated types do not exist in builds without this route (see routes.ts).
  const loaderData = useLoaderData<typeof loader>();
  const [q] = useSearchParams();
  const p = (k: string) => q.get(k);
  const tiles = useMemo<StreetTileConfig>(
    () => ({
      primaryUrl: p("primaryUrl") ?? loaderData.tiles.primaryUrl,
      fallbackPmtilesUrl: p("fallbackUrl") ?? loaderData.tiles.fallbackPmtilesUrl,
      maxFallbackZoom: num(p("maxFallbackZoom"), loaderData.tiles.maxFallbackZoom),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaderData.tiles, q.toString()],
  );
  const view = useMemo<StreetView>(() => {
    const v = (p("view") ?? "").split(",").map(Number);
    return v.length === 3 && v.every(Number.isFinite) ? { lon: v[0]!, lat: v[1]!, zoom: v[2]! } : { lon: 106.698, lat: 10.774, zoom: 14.5 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.toString()]);
  const [selected, setSelected] = useState<string | null>(p("select"));
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<TileStatus | null>(null);
  const [current, setCurrent] = useState<StreetView>(view);
  const mapRef = useRef<StreetMap | null>(null);
  const reduced = p("rm") === "1";
  const chaos = p("chaos") as Chaos | null;

  useEffect(() => {
    const theme = p("theme");
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    try {
      sessionStorage.setItem("street-debug", "1");
    } catch {
      // private mode: the URL flag still works
    }
    window.__streetDev = {
      status: [],
      threeProject: (v, pts, w, h) => {
        const basis = viewBasis(v, h);
        return pts.map(([lon, lat]) => {
          const s = projectLonLat(lon, lat, basis, w, h);
          return { x: s.x, y: s.y, visible: s.visible };
        });
      },
    };
    const undo = chaos ? installChaos(chaos, tiles, num(p("chaos-after"), 0), p("chaos-heal") ? num(p("chaos-heal"), 0) : null, num(p("chaos-slow"), 7000)) : () => {};
    setReady(true);
    return () => {
      undo();
      delete window.__streetDev;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaos, tiles]);

  const engineOptions = useMemo<StreetMapOptions | undefined>(() => {
    const o: Partial<StreetMapOptions> = {};
    const src = p("source");
    if (src === "primary" || src === "fallback") o.forceSource = src;
    if (p("projection") === "mercator") o.projection = "mercator";
    if (p("tileFade") === "0") o.tileFade = false;
    if (p("timings")) o.timings = pairs(p("timings"));
    if (p("thresholds")) o.thresholds = pairs(p("thresholds"));
    if (p("ptimeout")) o.probeTimeoutMs = num(p("ptimeout"), 3000);
    if (p("rtimeout")) o.requestTimeoutMs = num(p("rtimeout"), 10000);
    if (p("blend")) o.initialBlend = num(p("blend"), 1);
    if (p("sharp")) o.initialSharp = num(p("sharp"), 0);
    // The sharp reveal / dissolve need the device-resolution render; everything else runs at native art resolution.
    if (p("scale")) o.renderScale = num(p("scale"), 2);
    if (p("hires") === "1" || p("reveal") === "1" || (p("sharp") && num(p("sharp"), 0) > 0)) o.highResolution = true;
    return o as StreetMapOptions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.toString()]);

  const onReady = (m: StreetMap | null) => {
    mapRef.current = m;
    if (m && p("reveal") === "1") void m.setReveal(true, { animate: false });
  };
  const m = () => mapRef.current;

  return (
    <div data-dev-street data-tile-state={status?.state ?? "connecting"} data-tile-reason={status?.reason ?? ""} className="fixed inset-0">
      {ready && (
        <StreetMapCanvas
          places={PLACES}
          routes={ROUTES}
          selectedSlug={selected}
          focusedSlug={null}
          initialView={view}
          reducedMotion={reduced}
          tiles={tiles}
          insetRight={num(p("inset"), 0)}
          onSelect={setSelected}
          onViewChange={setCurrent}
          onTileStatus={(s) => {
            setStatus(s);
            window.__streetDev?.status.push(s);
          }}
          onReady={onReady}
          engineOptions={engineOptions}
        />
      )}
      {p("hud") !== "0" && (
        <div className="absolute top-16 left-3 z-20 max-w-[min(22rem,calc(100vw-1.5rem))] border border-border bg-background/90 p-2 font-mono text-xs">
          <div data-testid="status">
            {status ? `${status.state} · ${status.source ?? "none"} · ${status.reason}` : "connecting"} · z {current.zoom.toFixed(2)}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {PLACES.slice(0, 3).map((pl) => (
              <button
                key={pl.slug}
                type="button"
                className="border border-border px-2 py-1"
                onClick={() => {
                  setSelected(pl.slug);
                  m()?.flyTo({ lon: pl.lon, lat: pl.lat, zoom: 14.5 });
                }}
              >
                {pl.name}
              </button>
            ))}
            <button type="button" className="border border-border px-2 py-1" onClick={() => void m()?.setReveal(true)}>
              reveal
            </button>
            <button type="button" className="border border-border px-2 py-1" onClick={() => void m()?.setReveal(false)}>
              close
            </button>
            <button type="button" className="border border-border px-2 py-1" onClick={() => void m()?.setBlend(0.5)}>
              blend 50%
            </button>
            <button type="button" className="border border-border px-2 py-1" onClick={() => void m()?.setBlend(1)}>
              blend 100%
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
