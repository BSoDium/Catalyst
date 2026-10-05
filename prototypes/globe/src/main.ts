import { installGlDebug } from "./core/glDebug";
import { fitZoom, type ViewState } from "./core/geo";
import { LabelLayer } from "./core/labels";
import { THEMES, TUNING, type GlobeRenderer, type Theme } from "./core/types";
import { loadDataset, loadGeodata } from "./data";

installGlDebug();

type RendererKind = "three" | "maplibre";
const q = new URLSearchParams(location.search);
const kind: RendererKind = q.get("renderer") === "maplibre" ? "maplibre" : "three";
const bench = q.get("bench") === "1";
const themeName: Theme["name"] =
  q.get("theme") === "dark" || q.get("theme") === "light"
    ? (q.get("theme") as Theme["name"])
    : matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
const theme = THEMES[themeName];
document.documentElement.dataset.theme = themeName;
if (bench) document.body.classList.add("bench");

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const globeEl = $("globe");
const labelsEl = $("labels");
const panel = $("panel");
const hud = $("hud");

const data = loadDataset({ stressMarkers: Number(q.get("markers") ?? 0) });
const bySlug = new Map(data.places.map((p) => [p.slug, p]));
const demoRouteFor = (slug: string) => data.routes.find((r) => r.stops.includes(slug))?.id ?? null;

/* ---- reduced motion: OS setting, ?rm=1/0, or the checkbox ---- */
const mq = matchMedia("(prefers-reduced-motion: reduce)");
let reducedOverride: boolean | null = q.has("rm") ? q.get("rm") === "1" : null;
const reduced = () => reducedOverride ?? mq.matches;
const applyReduced = () => {
  document.documentElement.dataset.rm = reduced() ? "1" : "0";
  renderer?.setReducedMotion(reduced());
  const cb = document.getElementById("rm") as HTMLInputElement | null;
  if (cb) cb.checked = reduced();
};
mq.addEventListener("change", applyReduced);

/* ---- state ---- */
let renderer: GlobeRenderer | null = null;
let labels: LabelLayer | null = null;
let savedView: ViewState | null = null;
let selected: string | null = q.get("select");
let routeId: string | null = null;
let mounting = false;
const pixelOverride = q.get("px") ? Number(q.get("px")) : null;

function defaultView(): ViewState {
  const w = globeEl.clientWidth;
  const h = globeEl.clientHeight;
  return { lon: 15, lat: 28, zoom: fitZoom(w, h, 0.12) };
}

function parseViewParam(): ViewState | null {
  const v = q.get("view")?.split(",").map(Number);
  return v && v.length === 3 && v.every(Number.isFinite) ? { lon: v[0]!, lat: v[1]!, zoom: v[2]! } : null;
}

async function mount(view?: ViewState | null) {
  if (renderer || mounting) return;
  mounting = true;
  const t0 = performance.now();
  try {
    const [geo, mod] = await Promise.all([
      loadGeodata(),
      kind === "three" ? import("./three/ThreeGlobe") : import("./maplibre/MapLibreGlobe"),
    ]);
    const factory = "createThreeGlobe" in mod ? mod.createThreeGlobe : mod.createMapLibreGlobe;
    const minSide = Math.min(globeEl.clientWidth, globeEl.clientHeight);
    const r = await factory({
      container: globeEl,
      places: data.places,
      routes: data.routes,
      coastlines: geo.coastlines,
      borders: geo.borders,
      initialView: view ?? parseViewParam() ?? defaultView(),
      pixelSize: pixelOverride ?? TUNING.pixelSize(minSide, devicePixelRatio),
      reducedMotion: reduced(),
      theme,
      routeMode: q.get("route") === "loop" ? "loop" : "once",
      onSelect: (slug) => selectPlace(slug, { fly: true }),
      onViewChange: () => syncLabels(),
    });
    renderer = r;
    labels = new LabelLayer(
      labelsEl,
      data.places.map((p) => ({
        id: p.slug,
        text: p.name,
        title: p.region,
        lon: p.coordinates.lon,
        lat: p.coordinates.lat,
        priority: p.labelPriority,
      })),
      { onSelect: (slug) => selectPlace(slug, { fly: true }) },
    );
    void document.fonts?.ready.then(() => labels?.remeasure());
    labels.setSelected(selected);
    r.select(selected);
    r.setRoute(routeId);
    r.requestRender();
    mountMs = performance.now() - t0;
  } finally {
    mounting = false;
  }
  updatePanel();
}
let mountMs = 0;

function unmount() {
  if (!renderer) return;
  savedView = renderer.getView();
  labels?.dispose();
  labels = null;
  renderer.dispose();
  renderer = null;
  updatePanel();
}

async function remount() {
  await mount(savedView);
}

function syncLabels() {
  if (!renderer || !labels) return;
  labels.update(renderer, renderer.getSize());
}

function selectPlace(slug: string | null, opts: { fly?: boolean } = {}) {
  selected = slug;
  routeId = slug ? demoRouteFor(slug) : null;
  if (!renderer) return;
  renderer.select(slug);
  renderer.setRoute(routeId);
  labels?.setSelected(slug);
  const p = slug ? bySlug.get(slug) : null;
  if (p && opts.fly) {
    renderer.flyTo({ lon: p.coordinates.lon, lat: p.coordinates.lat, zoom: Math.max(renderer.getView().zoom, TUNING.selectZoom) });
  }
  syncLabels();
  updatePanel();
}

/* ---- panel ---- */
const link = (label: string, params: Record<string, string>) => {
  const u = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(params)) u.set(k, v);
  return `<a class="btn" href="?${u}" ${params.renderer === kind ? 'aria-current="true"' : ""}>${label}</a>`;
};

function buildPanel() {
  panel.innerHTML = `
    <details id="ctl"><summary>Globe prototype</summary>
    <div class="row">${link("three", { renderer: "three" })}${link("maplibre", { renderer: "maplibre" })}</div>
    <div class="row">
      <button id="unmount" type="button">Unmount</button>
      <button id="remount" type="button">Remount</button>
      <button id="reset" type="button">Reset view</button>
    </div>
    <div class="row"><label><input id="rm" type="checkbox"> reduce motion</label></div>
    <details><summary>Places</summary><div id="places"></div></details>
    <div class="row"><button id="clear" type="button">Clear selection</button></div>
    </details>
  `;
  const places = $("places");
  for (const p of data.places.filter((x) => !x.slug.startsWith("stress-"))) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = p.name;
    b.dataset.slug = p.slug;
    b.addEventListener("click", () => selectPlace(p.slug, { fly: true }));
    places.append(b);
  }
  $("unmount").addEventListener("click", unmount);
  $("remount").addEventListener("click", () => void remount());
  $("reset").addEventListener("click", () => {
    selectPlace(null);
    renderer?.flyTo(defaultView());
  });
  $("clear").addEventListener("click", () => selectPlace(null));
  $("rm").addEventListener("change", (e) => {
    reducedOverride = (e.target as HTMLInputElement).checked;
    applyReduced();
  });
  if (innerWidth >= 600) panel.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
}

function updatePanel() {
  panel.querySelectorAll<HTMLButtonElement>("#places button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.slug === selected)));
  ($("unmount") as HTMLButtonElement).disabled = !renderer;
  ($("remount") as HTMLButtonElement).disabled = !!renderer;
}

function updateHud() {
  const v = renderer?.getView();
  const gl = window.__gl;
  hud.textContent = renderer
    ? `${kind}  lon ${v!.lon.toFixed(1)}  lat ${v!.lat.toFixed(1)}  z ${v!.zoom.toFixed(2)}  frames ${renderer.stats.frames}  ${renderer.isAnimating() ? "animating" : "idle"}\n` +
      `px ${pixelOverride ?? TUNING.pixelSize(Math.min(globeEl.clientWidth, globeEl.clientHeight), devicePixelRatio).toFixed(2)}  rm ${reduced() ? "on" : "off"}  gl live ${gl?.live()} / created ${gl?.created}  canvases ${gl?.liveCanvases()}  labels ${labels?.shown().size ?? 0}`
    : `${kind}  unmounted (saved view ${savedView ? `${savedView.lon.toFixed(1)}, ${savedView.lat.toFixed(1)}, z ${savedView.zoom.toFixed(2)}` : "none"})  gl live ${gl?.live()} / created ${gl?.created}  canvases ${gl?.liveCanvases()}`;
}

/* ---- boot ---- */
buildPanel();
applyReduced();
await mount();
if (selected) selectPlace(selected, { fly: false });
updatePanel();
setInterval(updateHud, 250); // timers, not rAF: never keeps the GPU awake.

/** Automation / measurement hook. */
declare global {
  interface Window {
    __app?: unknown;
  }
}
window.__app = {
  kind,
  get renderer() {
    return renderer;
  },
  get labels() {
    return labels;
  },
  get mountMs() {
    return mountMs;
  },
  data,
  mount,
  unmount,
  remount,
  select: selectPlace,
  getSavedView: () => savedView,
  setReducedOverride(v: boolean | null) {
    reducedOverride = v;
    applyReduced();
  },
};

if (bench) {
  const { runBench } = await import("./bench");
  const duration = Number(q.get("dur") ?? 10);
  const out = $("bench-out");
  out.hidden = false;
  out.textContent = "Benchmark: running...";
  const res = await runBench({ kind, getRenderer: () => renderer!, duration, label: kind });
  out.textContent = JSON.stringify(res, null, 2);
  (window as unknown as { __bench: unknown }).__bench = res;
}
