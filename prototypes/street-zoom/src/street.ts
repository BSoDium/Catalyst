/**
 * The lazy "street" chunk: MapLibre (globe -> mercator), the PMTiles protocol, the monochrome style, the pixel pass
 * compositor, HTML labels and the reveal animation. Everything the main bundle must not pay for lives behind this
 * module's dynamic import.
 */
import { Map as MLMap, addProtocol, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";
import { loadBorders, loadCoastlines, polylinesToMultiLineString } from "@catalyst/geodata";
import { PLACES, type AppConfig } from "./config";
import { DEGRADED, ErrorWindow, chooseSource, clampedZoom, probe, retryDelayMs, type SourceStatus } from "./core/health";
import { RevealState, artPixelCss, cellDevicePx, over, parseCssColor, type Rgb } from "./core/pixel";
import { CopyCompositor, InlineCompositor, type Compositor, type PassConfig } from "./gl/compositors";
import type { PassParams } from "./gl/pixelPass";
import { SOLID_FROM } from "./core/artLine";
import { HudLabels, type LabelSource } from "./labels";
import { applyCell, buildMonoStyle, graticule, type Schema } from "./style/monoStyle";

export const OFM_TILEJSON = "https://tiles.openfreemap.org/planet";
export const PMTILES_FILE = "/hcmc.pmtiles";

export interface Palette {
  bg: Rgb;
  fg: Rgb;
  muted: Rgb;
  css: { bg: string; fg: string; muted: string };
}

/** Resolve the design tokens through a probe element, like the production globe does (engine/colors.ts). */
export function readPalette(): Palette {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const get = (v: string) => {
    probe.style.color = `var(${v})`;
    return parseCssColor(getComputedStyle(probe).color);
  };
  const bgRgba = get("--background");
  const bg: Rgb = [bgRgba[0], bgRgba[1], bgRgba[2]];
  const fgRgba = get("--foreground");
  const fg: Rgb = over(fgRgba, bg);
  const muted = over(get("--globe-limb"), bg);
  probe.remove();
  const hex = (c: Rgb) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
  return { bg, fg, muted, css: { bg: hex(bg), fg: hex(fg), muted: hex(muted) } };
}

export interface Street {
  map: MLMap;
  compositor: Compositor | null;
  labels: HudLabels;
  palette: Palette;
  counters: { renders: number };
  cellCss(): number;
  setView(v: { lon: number; lat: number; zoom: number }): void;
  flyTo(lon: number, lat: number, zoom: number): void;
  select(slug: string | null): void;
  setReveal(on: boolean): void;
  setSharpAll(v: number): void;
  setDither(on: boolean): void;
  refreshTheme(): void;
  whenSettled(timeoutMs?: number): Promise<void>;
  projectionName(): string;
  skew(): number;
  tileState(): TileState;
  /** test hook: pretend the active source just failed */
  dispose(): void;
}

export interface TileState {
  active: "pm" | "ofm" | null;
  status: Record<string, SourceStatus>;
  degraded: boolean;
  /** human readable log of every decision, newest last */
  log: string[];
}

const SCHEMA: Record<"pm" | "ofm", Schema> = { pm: "protomaps", ofm: "openmaptiles" };
const tilesUrlFor = (k: "pm" | "ofm") => (k === "pm" ? `pmtiles://${location.origin}${PMTILES_FILE}` : OFM_TILEJSON);
/** A header read for PMTiles, the TileJSON for OpenFreeMap: one small request each. */
const probeFor = (k: "pm" | "ofm") =>
  k === "pm" ? { url: `${location.origin}${PMTILES_FILE}`, headers: { Range: "bytes=0-15" } } : { url: OFM_TILEJSON, headers: undefined };

let protocolReady = false;

/**
 * 0 for a Mercator view (meridians are vertical lines); grows with globe curvature. The transform is private in
 * MapLibre 6, so the projection state is read from the public `unproject` instead.
 */
export function projectionSkew(map: MLMap): number {
  const c = map.getCanvas();
  const w = c.clientWidth;
  const h = c.clientHeight;
  const tl = map.unproject([0, 0]);
  const bl = map.unproject([0, h]);
  const tr = map.unproject([w, 0]);
  const span = Math.abs(tr.lng - tl.lng) || 1;
  return Math.abs(tl.lng - bl.lng) / span;
}

export async function createStreet(cfg: AppConfig, container: HTMLElement, labelRoot: HTMLElement): Promise<Street> {
  setWorkerUrl(workerUrl);
  if (!protocolReady) {
    const protocol = new Protocol();
    addProtocol("pmtiles", protocol.tilev4 as unknown as Parameters<typeof addProtocol>[1]);
    protocolReady = true;
  }
  const dpr = window.devicePixelRatio || 1;
  const reduced = cfg.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let palette = readPalette();

  const [coast, borders] = await Promise.all([loadCoastlines(), loadBorders()]);
  const fc = (p: Awaited<ReturnType<typeof loadCoastlines>>): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: polylinesToMultiLineString(p) } }],
  });

  // ---- tile source selection (health probe, fail-over chain, degraded mode) ---------
  const log: string[] = [];
  const note = (m: string) => {
    log.push(`${Math.round(performance.now())}ms ${m}`);
  };
  const status: Record<string, SourceStatus> = {};
  const failures: Record<string, number> = {};
  let active: "pm" | "ofm" | null = cfg.chain[0]!;
  let degraded = false;

  const runProbe = async (k: "pm" | "ofm") => {
    const p = probeFor(k);
    const r = await probe(p.url, { timeoutMs: cfg.probeTimeoutMs, headers: p.headers });
    status[k] = r.ok ? "up" : "down";
    note(`probe ${k}: ${r.ok ? "up" : `down (${r.reason})`} in ${Math.round(r.ms)}ms`);
    return r.ok;
  };

  // With probing on, the map starts tile-less (the bundled globe renders at once) and gets its tile source when the
  // probes answer, or its degraded notice when they do not. Without probing it starts on the first source.
  const initial: "pm" | "ofm" | null = cfg.probe ? null : active;
  note(cfg.probe ? "start tile-less, probing the chain" : `start on ${active} (no probe)`);

  const native = cfg.compositor === "none" && new URLSearchParams(location.search).get("native") === "1";
  let schema: Schema = SCHEMA[cfg.chain[0]!];
  /** art cell in CSS px actually used by the pass (whole device px / dpr); the style's art widths follow it */
  let styleCell = cellDevicePx(cfg.px ?? artPixelCss(Math.min(container.clientWidth, container.clientHeight)), window.devicePixelRatio || 1) / (window.devicePixelRatio || 1);
  const styleFor = (kind: "pm" | "ofm" | null) =>
    buildMonoStyle({
      widths: cfg.widths,
      cellCss: styleCell,
      schema: kind ? SCHEMA[kind] : schema,
      tilesUrl: kind ? tilesUrlFor(kind) : null,
      coastlines: fc(coast),
      borders: fc(borders),
      graticule: graticule(15, 3),
      projection: cfg.projection,
      nativePalette: native ? palette.css : undefined,
    });
  const style = styleFor(initial);

  // Map render scale: source px per CSS px. Art-only output pools down from CSS-resolution; device output and the
  // inline layer keep the full device scale so the sharp reveal is really sharp.
  const scale = cfg.scale ?? (cfg.compositor === "copy-art" ? 1 : Math.min(dpr, 2));
  const map = new MLMap({
    container,
    style,
    center: [cfg.view.lon, cfg.view.lat],
    zoom: cfg.view.zoom,
    pixelRatio: native && cfg.px ? 1 / cfg.px : scale,
    minZoom: 0.5,
    maxZoom: 17.5,
    attributionControl: false,
    renderWorldCopies: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    fadeDuration: 0,
    canvasContextAttributes: { antialias: false, preserveDrawingBuffer: false },
    // the line-integrity harness renders a high-resolution reference of the same map (docs/pixel-line-rules.md)
    maxCanvasSize: [8192, 8192],
  });
  map.touchZoomRotate.disableRotation();
  if (native) map.getCanvas().style.imageRendering = "pixelated";

  await new Promise<void>((res, rej) => {
    map.once("load", () => res());
    map.once("error", (e) => rej(e.error));
  });

  const counters = { renders: 0 };
  map.on("render", () => counters.renders++);

  // ---- pass configuration -------------------------------------------------
  const reveal = new RevealState(700, reduced);
  let sharpAll = cfg.sharpAll;
  let dither = cfg.dither;
  let selected: (typeof PLACES)[number] | null = null;
  let cellCss = cfg.px ?? artPixelCss(Math.min(container.clientWidth, container.clientHeight));

  const pass: PassConfig = {
    params(outW: number, outH: number, d: number): PassParams {
      cellCss = cfg.px ?? artPixelCss(Math.min(outW, outH) / d);
      const cellOut = cellDevicePx(cellCss, d);
      if (cfg.widths === "art" && Math.abs(cellOut / d - styleCell) > 1e-6) {
        styleCell = cellOut / d;
        queueMicrotask(() => applyCell(map, styleCell));
      }
      let focus = { x: 0, y: 0, radius: 0, feather: 1 };
      if (selected && reveal.value > 0) {
        const p = map.project([selected.lon, selected.lat]);
        const maxR = Math.min(280, 0.34 * Math.min(outW, outH) / d) * d;
        const r = maxR * reveal.eased;
        focus = { x: p.x * d, y: p.y * d, radius: r, feather: Math.max(1, r * 0.4) };
      }
      return {
        bg: palette.bg,
        fg: palette.fg,
        muted: palette.muted,
        cellOut,
        inkThreshold: cfg.inkThreshold,
        solidThreshold: cfg.solid ?? (cfg.rule === "legacy" || cfg.widths === "legacy" ? 1.1 : SOLID_FROM),
        anyThreshold: cfg.anyThreshold,
        rule: cfg.rule,
        thinIters: cfg.thin,
      thinMode: cfg.thinMode,
        pattern: cfg.pattern,
        dither,
        sharp: sharpAll,
        focus,
        anchor: [0, 0],
      };
    },
  };

  let compositor: Compositor | null = null;
  const syncAfter = new URLSearchParams(location.search).get("syncpass") === "1";
  if (cfg.compositor === "copy-art") compositor = new CopyCompositor(map, container, pass, "art", syncAfter);
  else if (cfg.compositor === "copy-device") compositor = new CopyCompositor(map, container, pass, "device", syncAfter);
  else if (cfg.compositor === "inline") compositor = new InlineCompositor(map, pass, syncAfter);
  map.triggerRepaint();

  // ---- labels ---------------------------------------------------------------
  const labels = new HudLabels(map, labelRoot);
  labels.setCell(cellCss);
  const placeSources = (): LabelSource[] =>
    PLACES.map((p) => ({ id: p.slug, name: p.name, lon: p.lon, lat: p.lat, priority: 10, pinned: selected?.slug === p.slug, selected: selected?.slug === p.slug }));
  let tileLabels: LabelSource[] = [];
  const refreshTileLabels = () => {
    if (map.getZoom() < 9) {
      tileLabels = [];
      labels.set(placeSources());
      return;
    }
    const layer = schema === "protomaps" ? "places" : "place";
    let feats: ReturnType<MLMap["querySourceFeatures"]> = [];
    try {
      feats = map.querySourceFeatures("tiles", { sourceLayer: layer });
    } catch {
      feats = [];
    }
    const seen = new Set<string>();
    const out: LabelSource[] = [];
    for (const f of feats) {
      const props = f.properties as Record<string, unknown>;
      const name = String(props["name:vi"] ?? props["name:en"] ?? props.name ?? "");
      if (!name || seen.has(name) || f.geometry.type !== "Point") continue;
      const kind = String(props.kind ?? props.class ?? "");
      const rank = Number(props.population_rank ?? props.rank ?? 0);
      const major = ["locality", "city", "town"].includes(kind);
      const minor = ["neighbourhood", "suburb", "quarter", "village", "macrohood"].includes(kind) && map.getZoom() >= 13;
      if (!major && !minor) continue;
      if (PLACES.some((p) => name.toLowerCase().includes(p.name.toLowerCase().split(" ")[0]!))) continue;
      seen.add(name);
      const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
      out.push({ id: `t:${name}`, name, lon, lat, priority: major ? 5 + rank : 1 + rank / 10 });
    }
    out.sort((a, b) => b.priority - a.priority);
    tileLabels = out.slice(0, 14);
    labels.set([...placeSources(), ...tileLabels]);
  };
  map.on("idle", refreshTileLabels);
  labels.set(placeSources());

  // ---- reveal animation -----------------------------------------------------
  let raf = 0;
  let last = 0;
  const tick = (ts: number) => {
    raf = 0;
    reveal.step(last ? ts - last : 16);
    last = ts;
    if (compositor?.kind === "copy") {
      if (!compositor.redraw()) map.triggerRepaint();
    } else map.triggerRepaint();
    if (reveal.animating) raf = requestAnimationFrame(tick);
    else last = 0;
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };

  const autoReveal = () => {
    if (cfg.reveal === "on") reveal.set(selected ? 1 : 0);
    else if (cfg.reveal === "off") reveal.set(0);
    else reveal.set(selected && map.getZoom() >= 12.5 ? 1 : 0);
    if (reveal.animating) kick();
    else if (compositor) map.triggerRepaint();
  };
  map.on("moveend", autoReveal);
  if (cfg.reveal === "on") reveal.set(0);

  // ---- fail-over ---------------------------------------------------------------
  const notice = document.getElementById("notice");
  const showNotice = (text: string | null) => {
    if (!notice) return;
    notice.textContent = text ?? "";
    notice.hidden = text === null;
  };
  const errors = new ErrorWindow(6, 8000);
  let recheckTimer: ReturnType<typeof setTimeout> | undefined;

  const applySource = (kind: "pm" | "ofm" | null) => {
    schema = SCHEMA[kind ?? cfg.chain[0]!];
    active = kind;
    degraded = kind === null;
    map.setStyle(styleFor(kind), { diff: false });
    if (kind) {
      map.setMaxZoom(17.5);
      showNotice(null);
      document.body.dataset.tiles = kind;
    } else {
      map.setMaxZoom(DEGRADED.maxZoom);
      if (map.getZoom() > DEGRADED.maxZoom) map.easeTo({ zoom: clampedZoom(map.getZoom()), duration: reduced ? 0 : 900, essential: true });
      showNotice(DEGRADED.notice);
      document.body.dataset.tiles = "degraded";
    }
    errors.reset();
    note(kind ? `serving tiles from ${kind}` : "degraded: bundled globe only, max zoom capped");
    scheduleRecheck();
  };

  /** Re-probe sources that are down (with back-off) and promote the best one as soon as it answers. */
  const scheduleRecheck = () => {
    clearTimeout(recheckTimer);
    const downs = cfg.chain.filter((k) => status[k] === "down");
    if (downs.length === 0) return;
    const delay = retryDelayMs(Math.max(...downs.map((k) => failures[k] ?? 1)));
    recheckTimer = setTimeout(async () => {
      for (const k of downs) {
        if (await runProbe(k)) failures[k] = 0;
        else failures[k] = (failures[k] ?? 1) + 1;
      }
      const best = chooseSource(cfg.chain, status) as "pm" | "ofm" | null;
      if (best !== active && best !== null && cfg.chain.indexOf(best) < (active ? cfg.chain.indexOf(active) : 99)) applySource(best);
      else scheduleRecheck();
    }, cfg.recheckMs ?? delay);
  };

  const failover = async (why: string) => {
    if (!active) return;
    const cur = active;
    note(`${why}: re-probing ${cur}`);
    if (await runProbe(cur)) {
      errors.reset();
      return;
    }
    failures[cur] = (failures[cur] ?? 0) + 1;
    applySource(chooseSource(cfg.chain, status) as "pm" | "ofm" | null);
  };

  map.on("error", (e) => {
    const ev = e as unknown as { sourceId?: string; error?: Error };
    if (ev.sourceId !== "tiles" || ev.error?.name === "AbortError") return;
    if (errors.record(performance.now())) void failover("tile errors");
  });

  const probing: Promise<void> = cfg.probe
    ? Promise.all(cfg.chain.map((k) => runProbe(k))).then(() => {
        const first = chooseSource(cfg.chain, status) as "pm" | "ofm" | null;
        note(first ? `probes done, start on ${first}` : "probes done: all sources down");
        for (const k of cfg.chain) if (status[k] === "down") failures[k] = 1;
        applySource(first);
      })
    : Promise.resolve();

  const durationFor = (lon: number, lat: number, zoom: number) => {
    if (reduced) return 0;
    const c = map.getCenter();
    const dist = Math.hypot(c.lng - lon, c.lat - lat);
    return Math.min(6500, 1800 + dist * 90 + Math.abs(map.getZoom() - zoom) * 260);
  };

  const street: Street = {
    map,
    compositor,
    labels,
    get palette() {
      return palette;
    },
    counters,
    cellCss: () => cellCss,
    setView(v) {
      map.jumpTo({ center: [v.lon, v.lat], zoom: v.zoom });
    },
    flyTo(lon, lat, zoom) {
      map.flyTo({ center: [lon, lat], zoom, duration: durationFor(lon, lat, zoom), essential: true, curve: 1.5 });
    },
    select(slug) {
      selected = PLACES.find((p) => p.slug === slug) ?? null;
      labels.set([...placeSources(), ...tileLabels]);
      autoReveal();
    },
    setReveal(on) {
      reveal.set(on ? 1 : 0);
      kick();
    },
    setSharpAll(v) {
      sharpAll = v;
      if (compositor?.kind === "copy") (compositor as CopyCompositor).repool();
      else map.triggerRepaint();
    },
    setDither(on) {
      dither = on;
      if (compositor?.kind === "copy") (compositor as CopyCompositor).repool();
      else map.triggerRepaint();
    },
    refreshTheme() {
      palette = readPalette();
      if (compositor?.kind === "copy") (compositor as CopyCompositor).repool();
      else map.triggerRepaint();
    },
    async whenSettled(timeoutMs = 60000) {
      await probing;
      return new Promise<void>((resolve, reject) => {
        const t0 = performance.now();
        const check = () => {
          if (!map.isMoving() && map.loaded() && map.areTilesLoaded() && !reveal.animating) {
            // two animation frames so the last render + composite have been presented
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          } else if (performance.now() - t0 > timeoutMs) reject(new Error("map did not settle"));
          else setTimeout(check, 100);
        };
        check();
      });
    },
    skew() {
      return projectionSkew(map);
    },
    projectionName() {
      return projectionSkew(map) < 1e-9 ? "mercator" : "globe";
    },
    tileState() {
      return { active, status: { ...status }, degraded, log: [...log] };
    },
    dispose() {
      clearTimeout(recheckTimer);
      cancelAnimationFrame(raf);
      labels.dispose();
      compositor?.dispose();
      map.remove();
    },
  };
  if (cfg.select) street.select(cfg.select);
  return street;
}
