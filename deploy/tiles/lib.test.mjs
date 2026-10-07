import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UsageError,
  boxAround,
  buildExtractArgs,
  buildRegion,
  buildUrl,
  candidateBuildDates,
  discoverLatestBuild,
  formatBuildDate,
  parseArgs,
  placesFromProjection,
  ringFromBox,
} from "./lib.mjs";

// ---------------------------------------------------------------- projection and regions

test("placesFromProjection reads slug and coordinates", () => {
  const places = placesFromProjection({
    places: [{ slug: "lisbon", coordinates: { lat: 38.72, lon: -9.14 }, name: "Lisbon" }],
  });
  assert.deepEqual(places, [{ slug: "lisbon", lat: 38.72, lon: -9.14 }]);
});

test("placesFromProjection rejects malformed input loudly", () => {
  assert.throws(() => placesFromProjection({}), /no "places" array/);
  assert.throws(() => placesFromProjection({ places: [{ slug: "x", coordinates: { lat: 91, lon: 0 } }] }), /x: invalid coordinates.lat/);
  assert.throws(() => placesFromProjection({ places: [{ slug: "y", coordinates: { lat: 0 } }] }), /y: invalid coordinates.lon/);
  assert.throws(() => placesFromProjection({ places: [{ slug: "z" }] }), /z: invalid coordinates.lat/);
});

test("boxAround is about 2 x half-size km tall and wider away from the equator", () => {
  const [[w, s, e, n]] = boxAround({ lat: 0, lon: 0 }, 10);
  assert.ok(Math.abs(n - s - 20 / 111.32) < 1e-9);
  assert.ok(Math.abs(e - w - 20 / 111.32) < 1e-9);
  const [[w60, , e60]] = boxAround({ lat: 60, lon: 10 }, 10);
  assert.ok(Math.abs(e60 - w60 - 20 / (111.32 * 0.5)) < 1e-6, "twice as many degrees of longitude at 60 degrees north");
  assert.ok(Math.abs((w60 + e60) / 2 - 10) < 1e-9, "centred on the place");
});

test("boxAround splits at the antimeridian", () => {
  const east = boxAround({ lat: 0, lon: 179.99 }, 10);
  assert.equal(east.length, 2);
  assert.equal(east[0][2], 180);
  assert.equal(east[1][0], -180);
  assert.ok(east[1][2] > -180 && east[1][2] < -179.8);
  const west = boxAround({ lat: 0, lon: -179.99 }, 10);
  assert.equal(west.length, 2);
  assert.equal(west[0][0], -180);
  assert.equal(west[1][2], 180);
});

test("boxAround clamps latitude to the Web Mercator limit and survives the poles", () => {
  const [[, s, , n]] = boxAround({ lat: 85, lon: 0 }, 100);
  assert.ok(n <= 85.0511 && s < n);
  const boxes = boxAround({ lat: 90, lon: 0 }, 10);
  for (const [w, , e] of boxes) assert.ok(w >= -180 && e <= 180);
  assert.throws(() => boxAround({ lat: 0, lon: 0 }, 0), RangeError);
});

test("ringFromBox is a closed counter-clockwise ring", () => {
  const ring = ringFromBox([0, 0, 2, 1]);
  assert.deepEqual(ring, [[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]);
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  assert.ok(area > 0, "positive signed area means counter-clockwise");
});

test("buildRegion makes one polygon per place, dedupes identical places, splits across 180", () => {
  const places = [
    { slug: "a", lat: 10, lon: 10 },
    { slug: "a2", lat: 10, lon: 10 },
    { slug: "b", lat: -41.29, lon: 174.78 },
    { slug: "fiji", lat: -17.7, lon: 179.99 },
  ];
  const region = buildRegion(places, 10);
  assert.equal(region.type, "MultiPolygon");
  assert.equal(region.coordinates.length, 4); // a, b, fiji (2 halves)
  for (const polygon of region.coordinates) {
    assert.equal(polygon.length, 1);
    const ring = polygon[0];
    assert.deepEqual(ring[0], ring[ring.length - 1]);
  }
});

test("buildRegion refuses an empty place list", () => {
  assert.throws(() => buildRegion([]), /No places/);
});

// ---------------------------------------------------------------- build discovery

test("formatBuildDate and candidateBuildDates use UTC, newest first, across month and year ends", () => {
  assert.equal(formatBuildDate(new Date("2026-10-05T01:00:00Z")), "20261005");
  assert.deepEqual(candidateBuildDates(new Date("2027-01-02T23:59:00Z"), 4), ["20270102", "20270101", "20261231", "20261230"]);
  assert.deepEqual(candidateBuildDates(new Date("2028-03-01T00:00:00Z"), 2), ["20280301", "20280229"]);
  assert.throws(() => candidateBuildDates(new Date(), 0), RangeError);
});

test("buildUrl joins base and date", () => {
  assert.equal(buildUrl("20261004"), "https://build.protomaps.com/20261004.pmtiles");
  assert.equal(buildUrl("20261004", "https://mirror.example/"), "https://mirror.example/20261004.pmtiles");
});

function fakeFetch(available, calls = []) {
  return async (url, init) => {
    calls.push({ url, method: init?.method });
    if (available.has(url)) return { ok: true, status: 200 };
    if (url.includes("boom")) throw new Error("network down");
    return { ok: false, status: 404 };
  };
}

test("discoverLatestBuild takes the newest build that answers and stops there", async () => {
  const calls = [];
  const fetch = fakeFetch(new Set(["https://build.protomaps.com/20261004.pmtiles", "https://build.protomaps.com/20261003.pmtiles"]), calls);
  const found = await discoverLatestBuild({ fetch, now: new Date("2026-10-05T09:00:00Z") });
  assert.deepEqual(found, { date: "20261004", url: "https://build.protomaps.com/20261004.pmtiles" });
  assert.deepEqual(
    calls.map((c) => [c.url.slice(-16), c.method]),
    [["20261005.pmtiles", "HEAD"], ["20261004.pmtiles", "HEAD"]],
    "HEAD only, today first, no request after the first success",
  );
});

test("discoverLatestBuild treats network errors as misses and logs them", async () => {
  const logs = [];
  const fetch = async (url) => {
    if (url.endsWith("20261005.pmtiles")) throw new Error("timeout");
    return { ok: url.endsWith("20261004.pmtiles"), status: 404 };
  };
  const found = await discoverLatestBuild({ fetch, now: new Date("2026-10-05T00:00:00Z"), log: (l) => logs.push(l) });
  assert.equal(found.date, "20261004");
  assert.deepEqual(logs, ["20261005: timeout"]);
});

test("discoverLatestBuild gives up after the look-back window with a hint about --source", async () => {
  const calls = [];
  await assert.rejects(
    discoverLatestBuild({ fetch: fakeFetch(new Set(), calls), now: new Date("2026-10-05T00:00:00Z"), lookbackDays: 3 }),
    /No Protomaps build found in the last 3 days.*--source/s,
  );
  assert.equal(calls.length, 3);
});

// ---------------------------------------------------------------- CLI

test("parseArgs defaults", () => {
  assert.deepEqual(parseArgs([]), {
    projection: undefined,
    demo: false,
    radiusKm: 10,
    maxZoom: 14,
    source: undefined,
    build: undefined,
    out: undefined,
    threads: 2,
    pmtilesBin: "pmtiles",
    dryRun: false,
    help: false,
  });
});

test("parseArgs reads flags in both forms", () => {
  const o = parseArgs(["--demo", "--dry-run", "--radius-km", "7.5", "--maxzoom=12", "--source=/tmp/x.pmtiles", "--out", "o.pmtiles", "--threads", "3"]);
  assert.equal(o.demo, true);
  assert.equal(o.dryRun, true);
  assert.equal(o.radiusKm, 7.5);
  assert.equal(o.maxZoom, 12);
  assert.equal(o.source, "/tmp/x.pmtiles");
  assert.equal(o.out, "o.pmtiles");
  assert.equal(o.threads, 3);
  assert.equal(parseArgs(["-h"]).help, true);
  assert.equal(parseArgs(["--build", "20261004"]).build, "20261004");
});

test("parseArgs rejects bad input with UsageError", () => {
  const bad = [
    [["--nope"], /Unknown option/],
    [["--radius-km"], /needs a value/],
    [["--radius-km", "--demo"], /needs a value/],
    [["--radius-km", "abc"], /positive number/],
    [["--radius-km", "-3"], /positive number/],
    [["--radius-km", "500"], /refusing/],
    [["--maxzoom", "16"], /between 0 and 15/],
    [["--maxzoom", "1.5"], /between 0 and 15/],
    [["--threads", "0"], /between 1 and 8/],
    [["--build", "2026-10-04"], /YYYYMMDD/],
    [["--demo", "--projection", "p.json"], /mutually exclusive/],
    [["--source", "x", "--build", "20261004"], /mutually exclusive/],
    [["--demo=1"], /does not take a value/],
  ];
  for (const [argv, pattern] of bad) {
    assert.throws(() => parseArgs(argv), (e) => e instanceof UsageError && pattern.test(e.message), argv.join(" "));
  }
});

test("buildExtractArgs", () => {
  assert.deepEqual(
    buildExtractArgs({ source: "https://b/1.pmtiles", output: "o", regionPath: "r.geojson", maxZoom: 14, threads: 2, dryRun: false }),
    ["extract", "https://b/1.pmtiles", "o", "--region=r.geojson", "--maxzoom=14", "--download-threads=2"],
  );
  assert.equal(buildExtractArgs({ source: "s", output: "o", regionPath: "r", maxZoom: 9, threads: 1, dryRun: true }).at(-1), "--dry-run");
});
