// Pure helpers for extract-places.mjs. No I/O except the injected `fetch`, so everything here
// is unit-testable with `node --test deploy/tiles`.

export const DEFAULT_RADIUS_KM = 10;
export const DEFAULT_MAX_ZOOM = 14;
export const DEFAULT_BUILD_BASE_URL = "https://build.protomaps.com";
export const DEFAULT_LOOKBACK_DAYS = 10;
export const DEFAULT_DOWNLOAD_THREADS = 2;

const KM_PER_DEG_LAT = 111.32; // spherical approximation, plenty for a margin around a place
const MAX_MERCATOR_LAT = 85.0511;

const round6 = (n) => Math.round(n * 1e6) / 1e6;

// ---------------------------------------------------------------- places and regions

/**
 * Pulls { slug, lat, lon } out of a published projection. Throws a readable error on malformed
 * input instead of silently skipping a place (a skipped place would silently lose its tiles).
 */
export function placesFromProjection(projection) {
  if (!projection || typeof projection !== "object" || !Array.isArray(projection.places)) {
    throw new Error('Projection has no "places" array');
  }
  return projection.places.map((place, i) => {
    const label = place?.slug ?? `#${i}`;
    const lat = place?.coordinates?.lat;
    const lon = place?.coordinates?.lon;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new Error(`Place ${label}: invalid coordinates.lat ${JSON.stringify(lat)}`);
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new Error(`Place ${label}: invalid coordinates.lon ${JSON.stringify(lon)}`);
    }
    return { slug: String(label), lat, lon };
  });
}

/**
 * Axis-aligned box (in degrees) of half-size `halfSizeKm` around a point, as one or two
 * [west, south, east, north] boxes. Two when the box crosses the antimeridian.
 * Latitude is clamped to the Web Mercator limit; longitude extent widens with 1/cos(lat).
 */
export function boxAround({ lat, lon }, halfSizeKm) {
  if (!(halfSizeKm > 0)) throw new RangeError("halfSizeKm must be > 0");
  const dLat = halfSizeKm / KM_PER_DEG_LAT;
  const cos = Math.max(Math.cos((Math.min(Math.abs(lat), 89) * Math.PI) / 180), 0.01);
  const dLon = Math.min(halfSizeKm / (KM_PER_DEG_LAT * cos), 180);
  const south = Math.max(lat - dLat, -MAX_MERCATOR_LAT);
  const north = Math.min(lat + dLat, MAX_MERCATOR_LAT);
  const west = lon - dLon;
  const east = lon + dLon;
  if (west < -180) return [[-180, south, east, north], [west + 360, south, 180, north]];
  if (east > 180) return [[west, south, 180, north], [-180, south, east - 360, north]];
  return [[west, south, east, north]];
}

/** Counter-clockwise closed ring (RFC 7946 exterior ring) for a [w, s, e, n] box. */
export function ringFromBox([w, s, e, n]) {
  return [
    [round6(w), round6(s)],
    [round6(e), round6(s)],
    [round6(e), round6(n)],
    [round6(w), round6(n)],
    [round6(w), round6(s)],
  ];
}

/**
 * GeoJSON MultiPolygon covering a box around each place. Boxes are deduplicated (two places at
 * the same coordinates cost nothing extra); overlapping boxes are fine, pmtiles takes the union
 * of the tiles they touch.
 */
export function buildRegion(places, halfSizeKm = DEFAULT_RADIUS_KM) {
  if (!Array.isArray(places) || places.length === 0) throw new Error("No places to build a region from");
  const seen = new Set();
  const polygons = [];
  for (const place of places) {
    for (const box of boxAround(place, halfSizeKm)) {
      const ring = ringFromBox(box);
      const key = JSON.stringify(ring);
      if (seen.has(key)) continue;
      seen.add(key);
      polygons.push([ring]);
    }
  }
  return { type: "MultiPolygon", coordinates: polygons };
}

// ---------------------------------------------------------------- build discovery

/** YYYYMMDD in UTC. */
export function formatBuildDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** Most recent first: today (UTC), yesterday, ... `days` entries. */
export function candidateBuildDates(now, days = DEFAULT_LOOKBACK_DAYS) {
  if (!Number.isInteger(days) || days < 1) throw new RangeError("days must be a positive integer");
  const out = [];
  for (let i = 0; i < days; i++) {
    out.push(formatBuildDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i))));
  }
  return out;
}

export function buildUrl(date, baseUrl = DEFAULT_BUILD_BASE_URL) {
  return `${baseUrl.replace(/\/+$/, "")}/${date}.pmtiles`;
}

/**
 * Finds the newest published Protomaps daily build: HEAD requests, newest date first, one at a
 * time, stopping at the first success. A day's file appears some hours after midnight UTC, so
 * "today" often 404s; that is normal. Network errors count as misses for that day.
 * Returns { date, url }. Throws when nothing is found in `lookbackDays`.
 */
export async function discoverLatestBuild({
  fetch: fetchImpl = globalThis.fetch,
  now = new Date(),
  baseUrl = DEFAULT_BUILD_BASE_URL,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  timeoutMs = 10_000,
  log = () => {},
} = {}) {
  const dates = candidateBuildDates(now, lookbackDays);
  for (const date of dates) {
    const url = buildUrl(date, baseUrl);
    try {
      const response = await fetchImpl(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return { date, url };
      log(`${date}: HTTP ${response.status}`);
    } catch (error) {
      log(`${date}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    `No Protomaps build found in the last ${lookbackDays} days under ${baseUrl}. ` +
      "Pass --source <url-or-path> (see https://maps.protomaps.com/builds).",
  );
}

// ---------------------------------------------------------------- CLI

export const HELP = `Usage: node deploy/tiles/extract-places.mjs [options]

Builds a GeoJSON MultiPolygon of boxes around every published place and runs ONE
"pmtiles extract" of the latest Protomaps daily build into a single places.pmtiles.

Options
  --projection <file>   Projection JSON (default: packages/published/data/projection.json)
  --demo                Use the demo fixture (packages/published/fixtures/demo.json)
  --radius-km <n>       Half-size of the box around each place, in km (default ${DEFAULT_RADIUS_KM})
  --maxzoom <n>         Maximum zoom, 0-15 (default ${DEFAULT_MAX_ZOOM})
  --source <url|path>   Source archive. Skips build discovery (any PMTiles URL or local file)
  --build <YYYYMMDD>    Use that specific Protomaps daily build instead of the newest one
  --out <file>          Output (default: deploy/data/tiles/places.pmtiles)
  --threads <n>         Download threads (default ${DEFAULT_DOWNLOAD_THREADS}; pmtiles' own default is 4)
  --pmtiles-bin <path>  pmtiles executable (default: pmtiles from PATH)
  --dry-run             Plan only: print the estimated tiles and size, download nothing
  -h, --help            This text

Exit codes: 0 ok, 1 runtime error, 2 bad arguments.`;

export class UsageError extends Error {}

const VALUE_FLAGS = new Set([
  "--projection",
  "--radius-km",
  "--maxzoom",
  "--source",
  "--build",
  "--out",
  "--threads",
  "--pmtiles-bin",
]);
const BOOLEAN_FLAGS = new Set(["--demo", "--dry-run", "--help", "-h"]);

function positiveNumber(flag, raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`${flag} must be a positive number, got "${raw}"`);
  return n;
}

function integerInRange(flag, raw, min, max) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new UsageError(`${flag} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return n;
}

/** Parses argv (without node and the script). Accepts "--flag value" and "--flag=value". */
export function parseArgs(argv) {
  const options = {
    projection: undefined,
    demo: false,
    radiusKm: DEFAULT_RADIUS_KM,
    maxZoom: DEFAULT_MAX_ZOOM,
    source: undefined,
    build: undefined,
    out: undefined,
    threads: DEFAULT_DOWNLOAD_THREADS,
    pmtilesBin: "pmtiles",
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inline;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq > 0) {
      inline = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    if (BOOLEAN_FLAGS.has(arg)) {
      if (inline !== undefined) throw new UsageError(`${arg} does not take a value`);
      if (arg === "--demo") options.demo = true;
      else if (arg === "--dry-run") options.dryRun = true;
      else options.help = true;
      continue;
    }
    if (!VALUE_FLAGS.has(arg)) throw new UsageError(`Unknown option "${arg}"`);
    const value = inline ?? argv[++i];
    if (value === undefined || value === "" || (inline === undefined && value.startsWith("--"))) {
      throw new UsageError(`${arg} needs a value`);
    }
    switch (arg) {
      case "--projection": options.projection = value; break;
      case "--radius-km": options.radiusKm = positiveNumber(arg, value); break;
      case "--maxzoom": options.maxZoom = integerInRange(arg, value, 0, 15); break;
      case "--source": options.source = value; break;
      case "--build":
        if (!/^\d{8}$/.test(value)) throw new UsageError(`--build must look like YYYYMMDD, got "${value}"`);
        options.build = value;
        break;
      case "--out": options.out = value; break;
      case "--threads": options.threads = integerInRange(arg, value, 1, 8); break;
      case "--pmtiles-bin": options.pmtilesBin = value; break;
    }
  }

  if (options.demo && options.projection) throw new UsageError("--demo and --projection are mutually exclusive");
  if (options.source && options.build) throw new UsageError("--source and --build are mutually exclusive");
  if (options.radiusKm > 200) throw new UsageError("--radius-km above 200 would extract a huge area; refusing");
  return options;
}

/** The exact argument vector for `pmtiles extract`. */
export function buildExtractArgs({ source, output, regionPath, maxZoom, threads, dryRun }) {
  const args = ["extract", source, output, `--region=${regionPath}`, `--maxzoom=${maxZoom}`, `--download-threads=${threads}`];
  if (dryRun) args.push("--dry-run");
  return args;
}
