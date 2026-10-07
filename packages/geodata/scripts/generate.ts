/**
 * Generates the committed polyline datasets in ../data.
 *
 *   coastlines-110m.json  from the `world-atlas` package (Natural Earth land, TopoJSON), unchanged since the first version;
 *   borders-50m.json      from Natural Earth's classified boundary lines (ne_50m_admin_0_boundary_lines_land), only the solid
 *                         de-facto land borders (see borders.ts for the class rule). Disputed, line-of-control, indefinite and
 *                         similar frontiers are NOT in the data.
 *
 *   pnpm --filter @catalyst/geodata generate                          # downloads the pinned source (scripts/sources.json), checks its sha256
 *   pnpm --filter @catalyst/geodata generate -- --borders <path|url>  # a local file or another URL (still sha256-checked against the pin, --no-verify to skip)
 *   pnpm --filter @catalyst/geodata generate -- --countries <path|url> --report-json <file>
 *        # also label every line with its country pair (ne_50m_admin_0_countries) and write the keep/drop table the checks read
 *   pnpm --filter @catalyst/geodata generate -- --report              # sizes of every candidate, incl. the 110m lines
 *   pnpm --filter @catalyst/geodata generate -- --strict-classes       # the class rule alone, ignoring scripts/osm-evidence.json
 *   ... --no-write                                                      # do not touch data/ (reports only)
 *
 * Output format (see src/format.ts): quantised, delta-coded flat integer arrays. Loader API unchanged.
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { MultiLineString } from "geojson";
import { encodePolylines, type RawPolylines } from "../src/format";
import { PRESENT_PAIRS, decide, labelPair, readCountries, samplePoints, type Evidence, type NeFeature } from "./borders";
import { cutBetween, cutLongSegments, dp, mergeAtContinuations, splitArtificial } from "./lines";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const sources = JSON.parse(readFileSync(join(root, "scripts", "sources.json"), "utf8")) as {
  files: Record<string, { file: string; url: string; sha256: string }>;
};

/** Which resolution feeds which dataset. Only these two files are loaded by the web app (src/borders.ts, src/coastlines.ts). */
const CHOSEN = { coastlines: "110m", borders: "50m" } as const;
/** Coordinate quantisation: 1/100 degree (~1.1 km). Well below the pixel size of a pixelated globe. */
const QUANT = 100;
/** Douglas-Peucker tolerance in degrees applied before quantisation (0 = none). */
const SIMPLIFY: Record<string, number> = { "110m": 0, "50m": 0.03 };
if (process.argv.includes("--simplify")) SIMPLIFY["50m"] = Number(process.argv[process.argv.indexOf("--simplify") + 1]);
/** No border segment is longer than this many degrees (lon or lat): long straight segments sink into a globe drawn with chords. */
const MAX_SEGMENT_DEG = 4;

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function fetchSource(key: string, override?: string): Promise<string> {
  const pin = sources.files[key]!;
  const where = override ?? pin.url;
  const text = /^https?:\/\//.test(where) ? await (await fetch(where)).text() : readFileSync(where, "utf8");
  const sha = createHash("sha256").update(text).digest("hex");
  if (sha !== pin.sha256 && !argv.includes("--no-verify")) {
    throw new Error(`${where}: sha256 ${sha} is not the pinned ${pin.sha256} (${pin.file}); pass --no-verify to use it anyway`);
  }
  return text;
}

function readFeatures(text: string): NeFeature[] {
  const fc = JSON.parse(text) as { features: { properties: Record<string, any>; geometry: { type: string; coordinates: any } }[] };
  return fc.features.map((f) => ({
    cls: f.properties.FEATURECLA,
    id: f.properties.NE_ID,
    brk: f.properties.BRK_A3 ?? null,
    lines: f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates,
  }));
}

function readTopology(file: string): Topology {
  return JSON.parse(readFileSync(require.resolve(`world-atlas/${file}`), "utf8")) as Topology;
}

function coastlines(res: string): RawPolylines {
  const topo = readTopology(`land-${res}.json`);
  const land = topo.objects.land as GeometryCollection;
  const geom: MultiLineString = mesh(topo, land);
  return { lines: splitArtificial(geom.coordinates).map((l) => dp(l, 0)) };
}

/**
 * The Natural Earth lines the globe draws, after the class rule, the OSM evidence and the cuts (and before any simplification),
 * per feature; and the lines that were removed by a cut or a drop, for the frontier reference (see --fixture).
 */
function selectBorders(features: NeFeature[], ev: Evidence | null) {
  const kept: { feature: number; lines: number[][][] }[] = [];
  const removed: { feature: number; why: string; lines: number[][][] }[] = [];
  features.forEach((f, i) => {
    const d = decide(f, i, ev);
    if (!d.keep) return void removed.push({ feature: i, why: d.reason, lines: f.lines });
    let lines = f.lines;
    for (const cut of ev?.cuts.filter((c) => c.feature === i) ?? []) {
      if (cut.id !== f.id) throw new Error(`osm-evidence.json cut on feature #${i} has NE_ID ${cut.id}, the source has ${f.id}`);
      let done = false;
      lines = lines.flatMap((l) => {
        const r = done ? null : cutBetween(l, cut.from, cut.to);
        if (!r) return [l];
        done = true;
        removed.push({ feature: i, why: cut.why, lines: [r.removed] });
        return r.kept;
      });
      if (!done) throw new Error(`osm-evidence.json cut on feature #${i} (${cut.pair}) matches none of its lines`);
    }
    kept.push({ feature: i, lines });
  });
  return { kept, removed };
}

/** The kept lines as globe polylines: antimeridian-safe, continuations joined, simplified, no long segments. */
function borderLines(features: NeFeature[], res: string, ev: Evidence | null): RawPolylines {
  const merged = mergeAtContinuations(splitArtificial(selectBorders(features, ev).kept.flatMap((k) => k.lines)));
  return { lines: merged.map((l) => cutLongSegments(dp(l, SIMPLIFY[res] ?? 0), MAX_SEGMENT_DEG)) };
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

const lengthKm = (lines: number[][][]) =>
  lines.reduce(
    (s, l) => s + l.slice(1).reduce((t, p, i) => t + Math.hypot((p[0]! - l[i]![0]!) * Math.cos((p[1]! * Math.PI) / 180) * 111.32, (p[1]! - l[i]![1]!) * 110.57), 0),
    0,
  );

mkdirSync(dataDir, { recursive: true });
const features50 = readFeatures(await fetchSource("borders-50m", arg("--borders")));
const evidence: Evidence | null = argv.includes("--strict-classes") ? null : (JSON.parse(readFileSync(join(root, "scripts", "osm-evidence.json"), "utf8")) as Evidence);

const reportJson = arg("--report-json");
const fixture = arg("--fixture");
if (reportJson || fixture) {
  const countries = readCountries(JSON.parse(await fetchSource("countries-50m", arg("--countries"))));
  const pairs = features50.map((f) => labelPair(f.lines, countries));
  if (reportJson) {
    const rows = features50.map((f, index) => {
      const d = decide(f, index, evidence);
      return { index, id: f.id, cls: f.cls, brk: f.brk, keep: d.keep, reason: d.reason, pair: pairs[index], km: Math.round(lengthKm(f.lines)), bbox: f.lines.flat().reduce((a, [x, y]) => [Math.min(a[0]!, x!), Math.min(a[1]!, y!), Math.max(a[2]!, x!), Math.max(a[3]!, y!)], [1e9, 1e9, -1e9, -1e9]) };
    });
    writeFileSync(reportJson, JSON.stringify(rows, null, 1) + "\n");
    const by = (keep: boolean) => rows.filter((r) => r.keep === keep);
    console.log(`report: ${by(true).length} features kept (${by(true).reduce((s, r) => s + r.km, 0)} km), ${by(false).length} dropped (${by(false).reduce((s, r) => s + r.km, 0)} km) -> ${reportJson}`);
  }
  if (fixture) {
    // Reference for src/borders.test.ts: points every 40 km along the frontiers that must be complete, and along the ones that must be absent.
    const sel = selectBorders(features50, evidence);
    const present: Record<string, number[]> = {};
    const neKm: Record<string, number> = {};
    for (const pair of PRESENT_PAIRS) {
      const lines = sel.kept.filter((k) => pairs[k.feature] === pair).flatMap((k) => k.lines);
      if (!lines.length) throw new Error(`no kept feature labelled "${pair}"`);
      present[pair] = samplePoints(lines, 40);
      neKm[pair] = Math.round(lengthKm(lines));
    }
    const absent: Record<string, number[]> = {};
    for (const r of sel.removed) {
      const km = lengthKm(r.lines);
      if (km < 10) continue;
      const b = r.lines.flat().reduce((a, [x, y]) => [a[0]! + x! / r.lines.flat().length, a[1]! + y! / r.lines.flat().length], [0, 0]);
      const name = `${pairs[r.feature] || "?"} (${Math.round(km)} km near ${b[0]!.toFixed(1)}, ${b[1]!.toFixed(1)}; ${r.why.replace(/^OSM evidence: /, "")})`;
      absent[name] = samplePoints(r.lines, 20, 12);
    }
    writeFileSync(fixture, JSON.stringify({ spacingKm: { present: 40, absent: 20 }, neKm, present, absent }) + "\n");
    console.log(`fixture: ${Object.keys(present).length} frontiers to be complete, ${Object.keys(absent).length} stretches to be absent -> ${fixture}`);
  }
}

if (argv.includes("--report")) {
  const f110 = readFeatures(await fetchSource("borders-110m"));
  const rows = [sizes("coastlines-110m", coastlines("110m")), sizes("coastlines-50m", coastlines("50m")), sizes("borders-110m (not loaded)", borderLines(f110, "110m", null)), sizes("borders-50m", borderLines(features50, "50m", evidence))];
  console.table(rows.map(({ json: _j, ...r }) => r));
}

if (argv.includes("--no-write")) process.exit(0);
const outputs = [
  ["coastlines", CHOSEN.coastlines, coastlines(CHOSEN.coastlines)],
  ["borders", CHOSEN.borders, borderLines(features50, CHOSEN.borders, evidence)],
] as const;
for (const [kind, res, raw] of outputs) {
  const s = sizes(`${kind}-${res}`, raw);
  const file = join(dataDir, `${kind}-${res}.json`);
  writeFileSync(file, s.json + "\n");
  console.log(`${kind}-${res}: ${s.lines} lines, ${s.vertices} vertices, ${s.rawBytes} B raw, ${s.gzipBytes} B gzip, ${s.brotliBytes} B brotli -> ${file}`);
}
