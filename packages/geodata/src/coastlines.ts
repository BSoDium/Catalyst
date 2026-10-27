import { decodePolylines, type EncodedPolylines, type Polylines } from "./format";

/** Coastline polylines (Natural Earth 110m land outline). Lazy: the data is a separate chunk. */
export async function loadCoastlines(): Promise<Polylines> {
  const mod = await import("../data/coastlines-110m.json");
  return decodePolylines(mod.default as EncodedPolylines);
}

/** The finer coastline (Natural Earth 50m land outline: 1422 lines, about 110 KB gzipped). A lazy chunk of its own, for the views that come close. */
export async function loadDetailedCoastlines(): Promise<Polylines> {
  const mod = await import("../data/coastlines-50m.json");
  return decodePolylines(mod.default as EncodedPolylines);
}
