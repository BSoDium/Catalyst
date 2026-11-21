import { createActivityGraph, DEFAULT_COLORS, fakeLayer, type ActivityGraph, type GraphData, type Tones } from "neon-activity-graph";

// The demo draws the owner's current activity, written by the `activity` workflow to the `data` branch; until that file exists (or if it cannot be fetched) a generated sample is drawn, so the page never shows nothing.
// The place-holder (the flat days) is the package's own: it is there at once and fades out when the scene is ready. The outline and the card are the package's overlay.
const DATA_URL = "https://raw.githubusercontent.com/BSoDium/Neon-activity-graph/data/activity.json";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const host = $("graph");
const stage = $("stage");
const live$ = $("live");
// (the portrait picture, four strips: on a phone, and on any screen that is as tall as it is wide or taller, where one long strip would be a thin line in the middle of it)
const narrow = matchMedia("(max-width: 767px), (max-aspect-ratio: 1/1)");

// (the title is plain markup in the page: there from the first paint, whole. Only the graph's own start-up flickers.)

// --- theme: "system" (follow the visitor's system, the default) or "light" / "dark", chosen with the three words in the text ---
type Theme = "light" | "dark" | null;
let theme: Theme = (() => {
  try {
    const t = localStorage.getItem("nag-theme");
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
})();
const themeButtons = [...document.querySelectorAll<HTMLButtonElement>("button.theme")];
const paintTheme = () => themeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === (theme ?? "system"))));
const applyTheme = (t: Theme) => {
  theme = t;
  if (t) document.documentElement.dataset.theme = t;
  else document.documentElement.removeAttribute("data-theme");
  try {
    if (t) localStorage.setItem("nag-theme", t);
    else localStorage.removeItem("nag-theme");
  } catch {
    /* (no storage: the choice lasts for the visit) */
  }
  paintTheme();
  ask("small");
  // (the page's colours have changed: the graph is told, and re-reads the background)
  graph?.setTheme(t ?? "auto");
};
themeButtons.forEach((b) => b.addEventListener("click", () => applyTheme(b.dataset.theme === "system" ? null : (b.dataset.theme as Theme))));
paintTheme();

// --- colours: two layers, a preset or a swatch each; kept in the URL hash ---
type Pair = { top: string; bottom: string };
const PRESETS: Record<string, Pair | null> = {
  Original: null,
  Technicolor: { top: "#ff3b6b", bottom: "#00c8ff" },
  Ice: { top: "#b9ecff", bottom: "#3f6bff" },
  Sunset: { top: "#ff8a1f", bottom: "#c4128a" },
  Mono: { top: "#eeeef2", bottom: "#7f879c" },
};
const ORIGINAL: Pair = { top: "#3ddc6a", bottom: "#5aa9ff" };
const toTones = (hex: string): Tones => {
  const n = parseInt(hex.slice(1), 16);
  const k = (f: number) => `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c * f).toString(16).padStart(2, "0")).join("")}`;
  return [k(0.62), hex];
};
const toColors = (p: Pair | null) => (p ? { top: { light: toTones(p.top), dark: toTones(p.top) }, bottom: { light: toTones(p.bottom), dark: toTones(p.bottom) } } : undefined);
const readHash = (): Pair | null => {
  const m = /top=([0-9a-f]{6})&bottom=([0-9a-f]{6})/i.exec(location.hash) ?? /top=([0-9a-f]{6})&bottom=([0-9a-f]{6})/i.exec(localStorage.getItem("nag-colors") ?? "");
  return m ? { top: `#${m[1]}`, bottom: `#${m[2]}` } : null;
};
let pair: Pair | null = readHash();
const paintPage = () => {
  // (the legend and the card follow the layers' colours; the originals are the stylesheet's)
  for (const k of ["top", "bottom"] as const) {
    if (pair) host.closest("body")!.style.setProperty(`--${k}`, pair[k]);
    else host.closest("body")!.style.removeProperty(`--${k}`);
  }
};

// A cling for a change the visitor made sounds when the picture has been redrawn with it (onRedrawn), not on the click: there is a moment between the two.
let pending: { size: "small" | "big"; at: number } | null = null;
const latencies: number[] = [];
const ask = (size: "small" | "big") => (pending = { size, at: performance.now() });
let graph: ActivityGraph | null = null;
let current: GraphData | null = null;

const valid = (v: any): v is GraphData & { generatedAt?: string } => ["top", "bottom"].every((k) => Array.isArray(v?.[k]?.days) && v[k].days.length > 30 && v[k].days.every((d: any) => typeof d?.date === "string" && Number.isFinite(d?.value)));
async function load(): Promise<{ data: GraphData; live: boolean; at?: string }> {
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    const json = res.ok ? await res.json() : null;
    if (valid(json)) return { data: json, live: true, at: json.generatedAt };
  } catch {
    /* (offline, or no data branch yet: the sample) */
  }
  return { data: { top: fakeLayer({ seed: 3, scale: 14, label: "contributions" }), bottom: fakeLayer({ seed: 103, scale: 6, label: "coded", unit: "h" }) }, live: false };
}

// The caption takes the blocks' left edge from the variable the package sets on the graph box. It is set at once, from the geometry, and replaced by the scene's own value: the caption is only shown (faded in) once it has the first.
const copyVar = () => stage.style.setProperty("--nag-content-left", host.style.getPropertyValue("--nag-content-left") || "0px");
new MutationObserver(copyVar).observe(host, { attributes: true, attributeFilter: ["style"] });

const mount = () => {
  graph?.destroy();
  graph = createActivityGraph(host, {
    data: current,
    strips: narrow.matches ? 4 : 1,
    theme: theme ?? "auto",
    colors: toColors(pair),
    overlay: true,
    debug: location.search.includes("debug") || location.search.includes("hold") ? { metrics: location.search.includes("debug"), neonHold: location.search.includes("hold") ? Number(new URLSearchParams(location.search).get("hold")) || true : undefined } : undefined,
    onRedrawn: () => {
      if (!pending) return;
      latencies.push(Math.round(performance.now() - pending.at));
      graph?.cling(pending.size);
      pending = null;
    },
    background: () => getComputedStyle(document.body).backgroundColor,
    // (the hint fades once the visitor has hovered a day)
    onHover: (i) => i && document.body.classList.add("hovered"),
  });
  copyVar();
  $("caption").classList.add("ready");
};
paintPage();
mount();
narrow.addEventListener("change", mount);
const { data, live, at } = await load();
(window as unknown as { __nag?: unknown }).__nag = location.search.includes("debug") ? { get graph() { return graph; }, latencies } : undefined;
current = data;
live$.textContent = live ? `Live data · updated ${new Date(at ?? Date.now()).toLocaleDateString()}` : "Sample data";
(graph as ActivityGraph | null)?.update(data);

// --- the panels: "How it works" and "Colours" (keyboard accessible: Escape closes, so does a click outside) ---
const panels = [
  { panel: $("how"), button: $("how-btn") },
  { panel: $("paint"), button: $("paint-btn") },
];
panels.forEach((p) => (p.panel.tabIndex = -1));
const setOpen = (target: (typeof panels)[number] | null) => {
  for (const p of panels) {
    const open = p === target && p.panel.hidden;
    p.panel.hidden = !open;
    p.button.setAttribute("aria-expanded", String(open));
    if (open) (p.panel.querySelector<HTMLElement>("input, button:not([disabled])") ?? p.panel).focus({ preventScroll: true });
  }
};
panels.forEach((p) => p.button.addEventListener("click", () => setOpen(p)));
addEventListener("keydown", (e) => {
  const open = panels.find((p) => !p.panel.hidden);
  if (e.key === "Escape" && open) {
    setOpen(null);
    open.button.focus();
  }
});
addEventListener("pointerdown", (e) => {
  const open = panels.find((p) => !p.panel.hidden);
  if (open && !open.panel.contains(e.target as Node) && !open.button.contains(e.target as Node)) setOpen(null);
});

// the colour controls
const inTop = $<HTMLInputElement>("c-top");
const inBottom = $<HTMLInputElement>("c-bottom");
const presetBox = $("presets");
const syncInputs = () => {
  inTop.value = (pair ?? ORIGINAL).top;
  inBottom.value = (pair ?? ORIGINAL).bottom;
  presetBox.querySelectorAll("button").forEach((b) => {
    const p = PRESETS[b.dataset.name!];
    b.setAttribute("aria-pressed", String(p ? !!pair && p.top === pair.top && p.bottom === pair.bottom : !pair));
  });
};
const apply = (p: Pair | null) => {
  pair = p;
  paintPage();
  syncInputs();
  const next = p ? `#top=${p.top.slice(1)}&bottom=${p.bottom.slice(1)}` : "";
  history.replaceState(null, "", `${location.pathname}${location.search}${next}`);
  if (p) localStorage.setItem("nag-colors", next.slice(1));
  else localStorage.removeItem("nag-colors");
  // (the package rebuilds the blocks in place: no start-up again, nothing refetched)
  graph?.setColors(toColors(p) ?? { top: DEFAULT_COLORS.top, bottom: DEFAULT_COLORS.bottom });
};
for (const [name, p] of Object.entries(PRESETS)) {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.name = name;
  b.innerHTML = `<i style="--a:${(p ?? ORIGINAL).top};--b:${(p ?? ORIGINAL).bottom}"></i>${name}`;
  b.addEventListener("click", () => {
    ask("big");
    apply(p);
  });
  presetBox.append(b);
}
const picked = () => {
  ask("small");
  apply({ top: inTop.value, bottom: inBottom.value });
};
inTop.addEventListener("input", picked);
inBottom.addEventListener("input", picked);
syncInputs();

// The install chip: greyed ("coming soon") until the package is on npm; the registry is asked, so it turns on by itself.
const copy = $<HTMLButtonElement>("copy");
fetch("https://registry.npmjs.org/neon-activity-graph", { headers: { accept: "application/vnd.npm.install-v1+json" } })
  .then((r) => {
    if (!r.ok) return;
    copy.disabled = false;
    copy.textContent = "copy";
    copy.addEventListener("click", async () => {
      await navigator.clipboard?.writeText("npm i neon-activity-graph").catch(() => {});
      copy.textContent = "copied";
      setTimeout(() => (copy.textContent = "copy"), 1500);
    });
  })
  .catch(() => {});
