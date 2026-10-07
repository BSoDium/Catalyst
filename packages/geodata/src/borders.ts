import { decodePolylines, type EncodedPolylines, type Polylines } from "./format";

/** Country border polylines: solid de-facto land borders only (no disputed, line-of-control or maritime lines, see README.md); coasts are in the coastline set. Lazy chunk. */
export async function loadBorders(): Promise<Polylines> {
  const mod = await import("../data/borders-50m.json");
  return decodePolylines(mod.default as EncodedPolylines);
}
