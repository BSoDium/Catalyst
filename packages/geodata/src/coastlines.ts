import { decodePolylines, type EncodedPolylines, type Polylines } from "./format";

/** Coastline polylines (Natural Earth 110m land outline). Lazy: the data is a separate chunk. */
export async function loadCoastlines(): Promise<Polylines> {
  const mod = await import("../data/coastlines-110m.json");
  return decodePolylines(mod.default as EncodedPolylines);
}
