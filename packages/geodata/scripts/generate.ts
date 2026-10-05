/**
 * Generates the committed polyline datasets in ../data from Natural Earth
 * (public domain), redistributed as TopoJSON by the `world-atlas` package.
 *
 *   pnpm --filter @catalyst/geodata generate            # writes data/*.json
 *   pnpm --filter @catalyst/geodata generate -- --report # also prints size table for all candidates
 *
 * Output format (see src/format.ts): quantised, delta-coded flat integer arrays.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { MultiLineString } from "geojson";
import { encodePolylines, type RawPolylines } from "../src/format";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");

/** Which world-atlas resolution feeds which dataset. Chosen from `--report`, see docs/renderer-decision.md. */
const CHOSEN = { coastlines: "110m", borders: "50m" } as const;
/** Coordinate quantisation: 1/100 degree (~1.1 km). Well below the pixel size of a pixelated globe. */
const QUANT = 100;
/** Douglas-Peucker tolerance in degrees applied before quantisation (0 = none). */
const SIMPLIFY: Record<string, number> = { "110m": 0, "50m": 0.04 };

const EPS = 1e-6;
const onAntimeridian = (a: number[], b: number[]) =>
  Math.abs(Math.abs(a[0]!) - 180) < EPS && Math.abs(Math.abs(b[0]!) - 180) < EPS;
const onSouthPole = (a: number[], b: number[]) => a[1]! <= -90 + EPS && b[1]! <= -90 + EPS;

/**
 * Make lines safe for any projection:
 *  - drop the artificial edges Natural Earth adds along the antimeridian and the south pole;
 *  - split segments that jump across the antimeridian (e.g. 178 -> -180) at +-180 so no line wraps the world.
 */
function splitArtificial(lines: number[][][]): number[][][] {
  const out: number[][][] = [];
  for (const line of lines) {
    let cur: number[][] = [];
    const flush = () => {
      if (cur.length > 1) out.push(cur);
      cur = [];
    };
    for (let i = 0; i < line.length; i++) {
      const p = line[i]!;
      const prev = line[i - 1];
      if (prev && Math.abs(p[0]! - prev[0]!) > 180) {
        const side = prev[0]! > 0 ? 1 : -1;
        const t = (180 * side - prev[0]!) / (p[0]! + 360 * side - prev[0]!);
        const lat = prev[1]! + t * (p[1]! - prev[1]!);
        cur.push([180 * side, lat]);
        flush();
        cur.push([-180 * side, lat]);
      } else if (prev && (onAntimeridian(prev, p) || onSouthPole(prev, p))) {
        flush();
      }
      cur.push(p);
    }
    flush();
  }
  return dropArtificial(out);
}

function dropArtificial(lines: number[][][]): number[][][] {
  const out: number[][][] = [];
  for (const line of lines) {
    let cur: number[][] = [];
    for (const p of line) {
      const prev = cur[cur.length - 1];
      if (prev && (onAntimeridian(prev, p) || onSouthPole(prev, p))) {
        if (cur.length > 1) out.push(cur);
        cur = [];
      }
      cur.push(p);
    }
    if (cur.length > 1) out.push(cur);
  }
  return out;
}

function dp(points: number[][], tol: number): number[][] {
  if (tol <= 0 || points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let max = 0;
    let idx = -1;
    const [ax, ay] = points[a]!;
    const [bx, by] = points[b]!;
    const dx = bx! - ax!;
    const dy = by! - ay!;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]!;
      let t = len2 ? ((px! - ax!) * dx + (py! - ay!) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px! - (ax! + t * dx), py! - (ay! + t * dy));
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function readTopology(file: string): Topology {
  return JSON.parse(readFileSync(require.resolve(`world-atlas/${file}`), "utf8")) as Topology;
}

function toRaw(geom: MultiLineString, tol: number): RawPolylines {
  const lines = splitArtificial(geom.coordinates).map((l) => dp(l, tol));
  return { lines };
}

function coastlines(res: string): RawPolylines {
  const topo = readTopology(`land-${res}.json`);
  const land = topo.objects.land as GeometryCollection;
  return toRaw(mesh(topo, land), SIMPLIFY[res] ?? 0);
}

function borders(res: string): RawPolylines {
  const topo = readTopology(`countries-${res}.json`);
  const countries = topo.objects.countries as GeometryCollection;
  // Interior arcs only: arcs shared by two different countries. Coastlines come from the coastline dataset.
  return toRaw(mesh(topo, countries, (a, b) => a !== b), SIMPLIFY[res] ?? 0);
}

function sizes(name: string, raw: RawPolylines) {
  const enc = encodePolylines(raw, QUANT);
  const json = JSON.stringify(enc);
  return {
    name,
    lines: enc.lengths.length,
    vertices: enc.lengths.reduce((a, b) => a + b, 0),
    rawBytes: Buffer.byteLength(json),
    gzipBytes: gzipSync(json, { level: 9 }).length,
    brotliBytes: brotliCompressSync(json).length,
    json,
  };
}

const report = process.argv.includes("--report");
mkdirSync(dataDir, { recursive: true });

if (report) {
  const rows = [
    sizes("coastlines-110m", coastlines("110m")),
    sizes("coastlines-50m", coastlines("50m")),
    sizes("borders-110m", borders("110m")),
    sizes("borders-50m", borders("50m")),
  ];
  console.table(rows.map(({ json: _j, ...r }) => r));
}

const outputs = [
  ["coastlines", CHOSEN.coastlines, coastlines(CHOSEN.coastlines)],
  ["borders", CHOSEN.borders, borders(CHOSEN.borders)],
] as const;
for (const [kind, res, raw] of outputs) {
  const s = sizes(`${kind}-${res}`, raw);
  const file = join(dataDir, `${kind}-${res}.json`);
  writeFileSync(file, s.json + "\n");
  console.log(`${kind}-${res}: ${s.lines} lines, ${s.vertices} vertices, ${s.rawBytes} B raw, ${s.gzipBytes} B gzip, ${s.brotliBytes} B brotli -> ${file}`);
}
