import { createActivityGraph, fakeLayer, type ActivityGraph, type GraphData, type Tones } from "neon-activity-graph";

// The demo draws the owner's current activity, written by the `activity` workflow to the `data` branch; until that file exists (or if it cannot be fetched) a generated sample is drawn, so the page never shows nothing.
// The place-holder (the flat days) is the package's own: it is there at once and fades out when the scene is ready. The outline and the card are the package's overlay.
const DATA_URL = "https://raw.githubusercontent.com/BSoDium/Neon-activity-graph/data/activity.json";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const host = $("graph");
const stage = $("stage");
const sub = $("sub");
const narrow = matchMedia("(max-width: 767px)");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

// --- the title: real text, one span a letter, switched on like a neon sign ---
const TITLE = "Neon-activity-graph";
const RAINBOW = new Set([0, 4, 13]); // (the N and the two hyphens carry the Technicolor stripes)
const letters = [...TITLE].map((ch, i) => {
  const s = document.createElement("span");
  s.className = RAINBOW.has(i) ? "l rb" : "l";
  s.textContent = ch;
  return s;
});
$("title-letters").append(...letters);
let titleOn = false;
const switchOn = () => {
  if (titleOn) return;
  titleOn = true;
  if (reduced.matches) return void letters.forEach((l) => (l.style.opacity = ""));
  // Each tube has its own stutter, over the 2.6 s the graph's own start-up takes: a few false starts, gaps, then on (a tiny brightness overshoot) and steady.
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  letters.forEach((l, i) => {
    const start = 0.08 + rnd() * 0.5;
    const stutters = 2 + Math.floor(rnd() * 3);
    const frames: Keyframe[] = [{ opacity: 0.1, offset: 0 }];
    let t = start;
    for (let k = 0; k < stutters; k++) {
      frames.push({ opacity: 0.1, offset: t }, { opacity: 0.45 + rnd() * 0.5, offset: t + 0.01 }, { opacity: 0.1, offset: t + 0.02 + rnd() * 0.04 });
      t += 0.05 + rnd() * 0.12;
    }
    frames.push({ opacity: 0.1, offset: Math.min(0.88, t) }, { opacity: 1.15 > 1 ? 1 : 1, offset: Math.min(0.9, t + 0.02), filter: "brightness(1.6)" }, { opacity: 1, offset: 1, filter: "brightness(1)" });
    l.animate(frames.sort((a, b) => (a.offset as number) - (b.offset as number)), { duration: 2600 + i * 40, fill: "both", easing: "linear" });
  });
};
// (off until then: faint, as an unlit tube is)
if (!reduced.matches) letters.forEach((l) => (l.style.opacity = "0.1"));
// (if the graph never comes, the title still lights)
const fallback = window.setTimeout(switchOn, 3500);

// --- colours: two layers, a preset or a swatch each; kept in the URL hash ---
type Pair = { top: string; bottom: string };
const PRESETS: Record<string, Pair | null> = {
  Original: null,
  Technicolor: { top: "#ff3b6b", bottom: "#00c8ff" },
  Ice: { top: "#b9ecff", bottom: "#3f6bff" },
  Sunset: { top: "#ff8a1f", bottom: "#c4128a" },
  Mono: { top: "#eeeef2", bottom: "#7f879c" },
};
const dark = matchMedia("(prefers-color-scheme: dark)");
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
    theme: "auto",
    colors: toColors(pair),
    overlay: true,
    background: () => getComputedStyle(document.body).backgroundColor,
    // (the hint fades once the visitor has hovered a day)
    onHover: (i) => i && document.body.classList.add("hovered"),
    onReady: () => {
      window.clearTimeout(fallback);
      switchOn();
    },
  });
  copyVar();
  $("caption").classList.add("ready");
};
paintPage();
mount();
narrow.addEventListener("change", mount);
const { data, live, at } = await load();
current = data;
sub.textContent = live ? `Live data, updated ${new Date(at ?? Date.now()).toLocaleDateString()}.` : "Generated sample data.";
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
  graph?.setColors(toColors(p ?? { top: dark.matches ? ORIGINAL.top : "#0a8f2c", bottom: dark.matches ? ORIGINAL.bottom : "#1a6fe0" })!);
};
for (const [name, p] of Object.entries(PRESETS)) {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.name = name;
  b.innerHTML = `<i style="--a:${(p ?? ORIGINAL).top};--b:${(p ?? ORIGINAL).bottom}"></i>${name}`;
  b.addEventListener("click", () => apply(p));
  presetBox.append(b);
}
inTop.addEventListener("input", () => apply({ top: inTop.value, bottom: inBottom.value }));
inBottom.addEventListener("input", () => apply({ top: inTop.value, bottom: inBottom.value }));
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
