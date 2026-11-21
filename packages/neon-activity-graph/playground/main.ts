import { createActivityGraph, fakeLayer, type ActivityGraph, type GraphData, type GraphOptions, type RodContext } from "neon-activity-graph";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const host = $("graph");
const card = $("card");
const status = $("status");

let seed = 1;
const makeData = (): GraphData => ({
  top: fakeLayer({ seed, scale: 14, label: "Commits", unit: "commits" }),
  bottom: fakeLayer({ seed: seed + 100, scale: 6, label: "Coding", unit: "h" }),
});

/** A string of lights: every day one colour of a small palette (a demo of `rodColor`; the values are linear RGB). */
const PALETTE: [number, number, number][] = [[1, 0.003, 0.003], [0, 0.75, 0.04], [1, 0.38, 0], [0.01, 0.045, 1], [1, 0.9, 0.7]];
const lights = ({ index, t }: RodContext): [number, number, number] => {
  const c = PALETTE[(Math.imul(index + 1, 2654435761) >>> 13) % PALETTE.length]!;
  return [c[0] * (0.3 + 0.7 * t), c[1] * (0.3 + 0.7 * t), c[2] * (0.3 + 0.7 * t)];
};

let graph: ActivityGraph | null = null;
const options = (): GraphOptions => ({
  data: makeData(),
  strips: Number($<HTMLSelectElement>("strips").value),
  theme: $<HTMLSelectElement>("theme").value as "auto" | "light" | "dark",
  sound: $<HTMLInputElement>("sound").checked,
  lite: $<HTMLInputElement>("lite").checked ? true : "auto",
  grain: Number($<HTMLInputElement>("grain").value),
  rodColor: $<HTMLInputElement>("lights").checked ? lights : undefined,
  background: (theme) => getComputedStyle(document.body).backgroundColor || (theme === "dark" ? "#0b0b0e" : "#f6f6f4"),
  onLit: (lit) => (status.textContent = lit ? "lit" : "starting up…"),
  onHover: (info) => {
    if (!info) return void (card.style.opacity = "0");
    card.textContent = `${info.date}: ${info.top} commits, ${info.bottom} h`;
    card.style.left = `${info.x}px`;
    card.style.top = `${info.y}px`;
    card.style.opacity = "1";
  },
});

const mount = () => {
  graph?.destroy();
  host.classList.toggle("narrow", $<HTMLSelectElement>("strips").value === "4");
  graph = createActivityGraph(host, options());
};
const applyTheme = () => {
  const t = $<HTMLSelectElement>("theme").value;
  // (the page's own colours follow the theme, then the graph is told: it re-reads the background)
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = t;
  graph?.setTheme(t as "auto" | "light" | "dark");
};

mount();
$("theme").addEventListener("change", applyTheme);
for (const id of ["strips", "sound", "lite", "grain", "lights"]) $(id).addEventListener("change", mount);
$("again").addEventListener("click", () => {
  seed++;
  graph?.update(makeData());
});
