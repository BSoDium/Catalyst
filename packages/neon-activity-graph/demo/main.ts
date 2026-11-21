import { createActivityGraph, fakeLayer, type ActivityGraph, type GraphData } from "neon-activity-graph";

// The demo draws the owner's current activity, written by the `activity` workflow to the `data` branch; until that file exists (or if it cannot be fetched) a generated sample is drawn, so the page never shows nothing.
// The place-holder (the flat days) is the package's own: it is there at once and fades out when the scene is ready. The outline and the card are the package's overlay.
const DATA_URL = "https://raw.githubusercontent.com/BSoDium/Neon-activity-graph/data/activity.json";

const host = document.getElementById("graph")!;
const stage = document.getElementById("stage")!;
const sub = document.getElementById("sub")!;
const narrow = matchMedia("(max-width: 767px)");

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

let graph: ActivityGraph | null = null;
let current: GraphData | null = null;
const mount = () => {
  graph?.destroy();
  // (a phone gets the four staggered strips; the place-holder shows from the first paint, over the empty box)
  graph = createActivityGraph(host, { data: current, strips: narrow.matches ? 4 : 1, theme: "auto", overlay: true,
    // (the package sets --nag-content-left on the graph box; the caption lives in the stage around it)
    onLayout: (b) => stage.style.setProperty("--nag-content-left", `${b.left}px`), background: () => getComputedStyle(document.body).backgroundColor });
};
// (the place-holder is drawn at once, while the data is fetched: the graph is created with no data, then given it)
mount();
narrow.addEventListener("change", mount);
const { data, live, at } = await load();
current = data;
sub.textContent = live ? `Live data${at ? `, updated ${new Date(at).toLocaleDateString()}` : ""}.` : "Generated sample data.";
(graph as ActivityGraph | null)?.update(data);
