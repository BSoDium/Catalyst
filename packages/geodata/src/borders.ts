import { decodePolylines, type EncodedPolylines, type Polylines } from "./format";

/** Country border polylines (interior borders only; coasts are in the coastline set). Lazy chunk. */
export async function loadBorders(): Promise<Polylines> {
  const mod = await import("../data/borders-50m.json");
  return decodePolylines(mod.default as EncodedPolylines);
}
