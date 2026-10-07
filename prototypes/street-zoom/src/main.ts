import { NAMED_VIEWS, PLACES, parseConfig } from "./config";
import type { Street } from "./street";

const cfg = parseConfig(location.search);
const q = new URLSearchParams(location.search);
if (cfg.theme) document.documentElement.dataset.theme = cfg.theme;
if (q.get("bench") === "1") document.body.classList.add("bench");

// count rAF calls for the idle check (scripts read window.__rafCount)
const w = window as unknown as { __rafCount: number; __app?: unknown };
w.__rafCount = 0;
const nativeRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb) => {
  w.__rafCount++;
  return nativeRaf(cb);
};

const hud = document.getElementById("hud")!;
const attribution = document.getElementById("attribution")!;
attribution.innerHTML =
  cfg.source === "pm"
    ? `<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>`
    : `<a href="https://openfreemap.org">OpenFreeMap</a> <a href="https://www.openmaptiles.org/">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>`;

function link(label: string, params: Record<string, string>, current = false): HTMLAnchorElement {
  const u = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(params)) u.set(k, v);
  const a = document.createElement("a");
  a.className = "btn";
  a.href = `?${u}`;
  a.textContent = label;
  if (current) a.setAttribute("aria-current", "true");
  return a;
}

const opts = document.getElementById("opts")!;
opts.append(
  link("pm", { src: "pm" }, cfg.source === "pm"),
  link("ofm", { src: "ofm" }, cfg.source === "ofm"),
  link("copy-device", { comp: "copy-device" }, cfg.compositor === "copy-device"),
  link("copy-art", { comp: "copy-art" }, cfg.compositor === "copy-art"),
  link("inline", { comp: "inline" }, cfg.compositor === "inline"),
  link("none", { comp: "none" }, cfg.compositor === "none"),
);

async function main() {
  const { createStreet } = await import("./street");
  const { runBench, idleCheck, isolatedCosts } = await import("./bench");
  const street: Street = await createStreet(cfg, document.getElementById("map")!, document.getElementById("labels")!);
  const integrity = () => import("./integrity");
  w.__app = { street, cfg, integrity: {
    classes: async () => (await integrity()).CLASSES,
    static: async (o: Omit<Parameters<Awaited<ReturnType<typeof integrity>>["measureStatic"]>[1], "legacyWidths">) => (await integrity()).measureStatic(street, { ...o, legacyWidths: cfg.widths === "legacy", thinStairs: cfg.thin > 0 && cfg.thinMode === "stairs" }),
    motion: async (o: Omit<Parameters<Awaited<ReturnType<typeof integrity>>["measureMotion"]>[1], "legacyWidths">) => (await integrity()).measureMotion(street, { ...o, legacyWidths: cfg.widths === "legacy", thinStairs: cfg.thin > 0 && cfg.thinMode === "stairs" }),
    fillChurn: async (o: Parameters<Awaited<ReturnType<typeof integrity>>["measureFillChurn"]>[1]) => (await integrity()).measureFillChurn(street, o),
    snapshot: async () => (await integrity()).snapshotCodes(street),
  }, bench: { run: (o: Parameters<typeof runBench>[1]) => runBench(street, o), idle: (ms: number) => idleCheck(street, ms), isolated: (n?: number) => isolatedCosts(street, n) } };

  const views = document.getElementById("views")!;
  for (const [name, v] of Object.entries(NAMED_VIEWS)) {
    const b = document.createElement("button");
    b.textContent = name;
    b.onclick = () => street.flyTo(v.lon, v.lat, v.zoom);
    views.append(b);
  }
  const places = document.getElementById("places")!;
  for (const p of PLACES) {
    const b = document.createElement("button");
    b.textContent = p.name;
    b.onclick = () => {
      street.select(p.slug);
      street.flyTo(p.lon, p.lat, 14.5);
    };
    places.append(b);
  }
  const clear = document.createElement("button");
  clear.textContent = "clear";
  clear.onclick = () => street.select(null);
  places.append(clear);
  const reveal = document.getElementById("reveal") as HTMLInputElement;
  reveal.onchange = () => street.setReveal(reveal.checked);
  const sharp = document.getElementById("sharpall") as HTMLInputElement;
  sharp.value = String(cfg.sharpAll);
  sharp.oninput = () => street.setSharpAll(Number(sharp.value));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => street.refreshTheme());

  const paintHud = () => {
    const c = street.map.getCenter();
    hud.textContent = `${cfg.compositor} ${cfg.source}  lon ${c.lng.toFixed(3)} lat ${c.lat.toFixed(3)} z ${street.map.getZoom().toFixed(2)} ${street.projectionName()}  art ${street.cellCss()}px  renders ${street.counters.renders}`;
  };
  street.map.on("render", paintHud);
  paintHud();
  document.body.dataset.ready = "1";
}

main().catch((e) => {
  console.error(e);
  document.body.dataset.error = String(e?.message ?? e);
});
