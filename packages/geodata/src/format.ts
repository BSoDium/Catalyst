/**
 * Compact polyline wire format shared by the generator and the loaders.
 *
 * All coordinates are WGS84 degrees, quantised to 1/`q` degree and delta-coded:
 * for each line, the first vertex is absolute and each later vertex is the
 * integer difference from the previous one. `deltas` is one flat array
 * [x0, y0, dx1, dy1, ...] per line, concatenated; `lengths` holds the vertex
 * count of each line.
 */
export interface EncodedPolylines {
  /** Format version. */
  v: 1;
  /** Quantisation: integer units per degree. */
  q: number;
  /** Vertex count per line. */
  lengths: number[];
  /** Concatenated delta-coded integer lon/lat pairs. */
  deltas: number[];
}

/** Decoded, GPU-friendly polylines. */
export interface Polylines {
  /** Interleaved lon, lat in degrees. */
  positions: Float32Array;
  /** Index of the first vertex of each line; length = lineCount + 1 (last = total vertices). */
  offsets: Uint32Array;
}

/** Unencoded input to the generator: lines of [lon, lat] pairs. */
export interface RawPolylines {
  lines: number[][][];
}

export function encodePolylines(raw: RawPolylines, q: number): EncodedPolylines {
  const lengths: number[] = [];
  const deltas: number[] = [];
  for (const line of raw.lines) {
    const pts: [number, number][] = [];
    for (const [lon, lat] of line) {
      const x = Math.round(lon! * q);
      const y = Math.round(lat! * q);
      const last = pts[pts.length - 1];
      if (!last || last[0] !== x || last[1] !== y) pts.push([x, y]);
    }
    if (pts.length < 2) continue;
    lengths.push(pts.length);
    let px = 0;
    let py = 0;
    pts.forEach(([x, y], i) => {
      deltas.push(i === 0 ? x : x - px, i === 0 ? y : y - py);
      px = x;
      py = y;
    });
  }
  return { v: 1, q, lengths, deltas };
}

export function decodePolylines(enc: EncodedPolylines): Polylines {
  const total = enc.lengths.reduce((a, b) => a + b, 0);
  const positions = new Float32Array(total * 2);
  const offsets = new Uint32Array(enc.lengths.length + 1);
  let di = 0;
  let vi = 0;
  enc.lengths.forEach((n, li) => {
    offsets[li] = vi;
    let x = 0;
    let y = 0;
    for (let k = 0; k < n; k++) {
      x += enc.deltas[di++]!;
      y += enc.deltas[di++]!;
      positions[vi * 2] = x / enc.q;
      positions[vi * 2 + 1] = y / enc.q;
      vi++;
    }
  });
  offsets[enc.lengths.length] = vi;
  return { positions, offsets };
}

/** Convert polylines to GeoJSON MultiLineString coordinates (for MapLibre sources). */
export function polylinesToMultiLineString(p: Polylines): [number, number][][] {
  const out: [number, number][][] = [];
  for (let i = 0; i < p.offsets.length - 1; i++) {
    const line: [number, number][] = [];
    for (let v = p.offsets[i]!; v < p.offsets[i + 1]!; v++) line.push([p.positions[v * 2]!, p.positions[v * 2 + 1]!]);
    out.push(line);
  }
  return out;
}
