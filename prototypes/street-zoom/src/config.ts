import type { Schema } from "./style/monoStyle";

export type CompositorKind = "none" | "copy-art" | "copy-device" | "inline";

export interface AppConfig {
  source: "pm" | "ofm";
  schema: Schema;
  compositor: CompositorKind;
  theme: "light" | "dark" | null;
  /** art pixel size in CSS px; null = tuned default */
  px: number | null;
  /** map render scale (source px per CSS px); null = device pixel ratio capped at 2 */
  scale: number | null;
  view: { lon: number; lat: number; zoom: number };
  select: string | null;
  reveal: "auto" | "on" | "off";
  sharpAll: number;
  dither: boolean;
  inkThreshold: number;
  reducedMotion: boolean | null;
  projection: "globe" | "mercator";
  /** tile source fail-over chain, first healthy wins (default: just `source`) */
  chain: ("pm" | "ofm")[];
  /** probe the chain at start even for a single source */
  probe: boolean;
  probeTimeoutMs: number;
  /** test hook: fixed re-probe delay in ms instead of the back-off */
  recheckMs: number | null;
}

function chainFrom(raw: string | null, fallback: "pm" | "ofm"): ("pm" | "ofm")[] {
  const ids = (raw ?? "").split(",").filter((x): x is "pm" | "ofm" => x === "pm" || x === "ofm");
  const uniq = [...new Set(ids)];
  return uniq.length ? uniq : [fallback];
}

export const DEFAULT_VIEW = { lon: 100, lat: 14, zoom: 2.4 };

export function parseConfig(search: string): AppConfig {
  const q = new URLSearchParams(search);
  const num = (k: string): number | null => {
    const v = q.get(k);
    if (v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const source = q.get("src") === "ofm" ? "ofm" : "pm";
  const comp = q.get("comp");
  const compositor: CompositorKind =
    comp === "none" || comp === "copy-art" || comp === "inline" || comp === "copy-device" ? comp : "copy-device";
  const theme = q.get("theme") === "dark" || q.get("theme") === "light" ? (q.get("theme") as "dark" | "light") : null;
  let view = { ...DEFAULT_VIEW };
  const v = q.get("view")?.split(",").map(Number);
  if (v && v.length === 3 && v.every(Number.isFinite)) view = { lon: v[0]!, lat: v[1]!, zoom: v[2]! };
  const rm = q.get("rm");
  const px = num("px");
  const scale = num("scale");
  return {
    source,
    schema: source === "pm" ? "protomaps" : "openmaptiles",
    compositor,
    theme,
    px: px !== null && px >= 1 && px <= 8 ? px : null,
    scale: scale !== null && scale >= 0.5 && scale <= 4 ? scale : null,
    view,
    select: q.get("select"),
    reveal: q.get("reveal") === "on" ? "on" : q.get("reveal") === "off" ? "off" : "auto",
    sharpAll: Math.min(1, Math.max(0, num("sharp") ?? 0)),
    dither: q.get("dither") !== "0",
    inkThreshold: Math.min(0.95, Math.max(0.05, num("ink") ?? 0.5)),
    reducedMotion: rm === "1" ? true : rm === "0" ? false : null,
    projection: q.get("proj") === "mercator" ? "mercator" : "globe",
    chain: chainFrom(q.get("chain"), source),
    probe: q.get("probe") === "1" || (q.get("chain") ?? "").includes(","),
    probeTimeoutMs: Math.min(15000, Math.max(200, num("ptimeout") ?? 3000)),
    recheckMs: num("recheck"),
  };
}

export const PLACES = [
  { slug: "ho-chi-minh-city", name: "Ho Chi Minh City", lon: 106.7009, lat: 10.7769 },
  { slug: "hue", name: "Hué", lon: 107.5909, lat: 16.4637 },
  { slug: "hanoi", name: "Hanoi", lon: 105.8542, lat: 21.0285 },
] as const;

export const NAMED_VIEWS: Record<string, { lon: number; lat: number; zoom: number }> = {
  world: { lon: 100, lat: 14, zoom: 2.4 },
  asia: { lon: 106, lat: 14, zoom: 4 },
  region: { lon: 106.7, lat: 10.8, zoom: 8 },
  city: { lon: 106.7, lat: 10.78, zoom: 11.5 },
  streets: { lon: 106.698, lat: 10.774, zoom: 14.5 },
  block: { lon: 106.6995, lat: 10.7765, zoom: 16.5 },
};
