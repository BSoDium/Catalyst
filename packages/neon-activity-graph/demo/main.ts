import { createActivityGraph, fakeLayer, type ActivityGraph, type GraphData } from "neon-activity-graph";

// The demo draws the owner's current activity, written by the `activity` workflow to the `data` branch; until that file exists (or if it cannot be fetched) a generated sample is drawn, so the page never shows nothing.
const DATA_URL = "https://raw.githubusercontent.com/BSoDium/Neon-activity-graph/data/activity.json";

const host = document.getElementById("graph")!;
const card = document.getElementById("card")!;
const sub = document.getElementById("sub")!;

const valid = (v: any): v is GraphData & { generatedAt?: string } => ["top", "bottom"].every((k) => Array.isArray(v?.[k]?.days) && v[k].days.length > 30 && v[k].days.every((d: any) => typeof d?.date === "string" && Number.isFinite(d?.value)));

async function load(): Promise<{ data: GraphData; live: boolean; at?: string }> {
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    const json = res.ok ? await res.json() : null;
    if (valid(json)) return { data: json, live: true, at: json.generatedAt };
  } catch {
    /* (offline, or no data branch yet: the sample) */
  }
  return { data: { top: fakeLayer({ seed: 3, scale: 14 }), bottom: fakeLayer({ seed: 103, scale: 6 }) }, live: false };
}

const text = (s: string, cls?: string) => Object.assign(document.createElement("div"), { textContent: s, className: cls ?? "" });
const narrow = matchMedia("(max-width: 767px)");

let graph: ActivityGraph | null = null;
const { data, live, at } = await load();
sub.textContent = live ? `Live: my GitHub contributions over my WakaTime coding time, over the last year${at ? ` (updated ${new Date(at).toLocaleDateString()})` : ""}.` : "Generated sample data: the live activity file is not there yet.";

const mount = () => {
  graph?.destroy();
  graph = createActivityGraph(host, {
    data,
    // (a phone gets the four staggered strips)
    strips: narrow.matches ? 4 : 1,
    theme: "auto",
    background: () => getComputedStyle(document.body).backgroundColor,
    onHover: (i) => {
      if (!i) return void (card.style.opacity = "0");
      card.replaceChildren(
        text(new Date(`${i.date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }), "d"),
        text(`${i.top} contribution${i.top === 1 ? "" : "s"}`, "g"),
        text(i.bottom >= 0.05 ? `${i.bottom.toFixed(1)} h coded` : "no coding", "b"),
      );
      const half = card.offsetWidth / 2;
      const x = Math.min(Math.max(i.x, half + 8), host.clientWidth - half - 8);
      card.style.transform = `translate(${x - half}px, ${Math.max(0, i.y - card.offsetHeight - 14)}px)`;
      card.style.opacity = "1";
    },
  });
};
mount();
narrow.addEventListener("change", mount);
