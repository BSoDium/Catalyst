#!/usr/bin/env node
// Builds ONE places.pmtiles for the fallback tile server: a box around every published place,
// cut out of the latest Protomaps daily build with a single `pmtiles extract`.
//
//   pnpm tiles:plan       # dry run: estimated tiles and size, downloads nothing
//   pnpm tiles:extract    # the real extract (a few MB to a few hundred MB of range requests)
//
// Needs the pmtiles CLI (brew install pmtiles, or https://github.com/protomaps/go-pmtiles/releases).
// Data: (c) OpenStreetMap contributors, ODbL; basemap by Protomaps. Protomaps asks not to hotlink
// their builds: run this when the places change, not on a schedule. See docs/self-hosting.md.

import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HELP,
  UsageError,
  buildExtractArgs,
  buildRegion,
  buildUrl,
  discoverLatestBuild,
  parseArgs,
  placesFromProjection,
} from "./lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLISHED = resolve(repoRoot, "packages/published/data/projection.json");
const DEMO = resolve(repoRoot, "packages/published/fixtures/demo.json");
const DEFAULT_OUT = resolve(repoRoot, "deploy/data/tiles/places.pmtiles");

function run(bin, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(bin, args, { stdio: "inherit" });
    child.on("error", (error) => {
      reject(
        error.code === "ENOENT"
          ? new Error(`"${bin}" not found. Install the pmtiles CLI: brew install pmtiles (or https://github.com/protomaps/go-pmtiles/releases)`)
          : error,
      );
    });
    child.on("close", (code) => (code === 0 ? resolveRun() : reject(new Error(`${bin} exited with code ${code}`))));
  });
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${HELP}`);
      return 2;
    }
    throw error;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }

  const projectionPath = options.demo ? DEMO : resolve(options.projection ?? PUBLISHED);
  const places = placesFromProjection(JSON.parse(await readFile(projectionPath, "utf8")));
  if (places.length === 0) {
    console.error(
      `${projectionPath} has no places yet, so there is nothing to extract.\n` +
        "Publish a place first, or try the placeholder fixture with --demo.",
    );
    return 1;
  }

  const out = resolve(options.out ?? DEFAULT_OUT);
  const region = buildRegion(places, options.radiusKm);
  const regionPath = resolve(dirname(out), "places.region.geojson");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(regionPath, `${JSON.stringify(region)}\n`);
  console.log(
    `${places.length} places, ${options.radiusKm * 2} km boxes (+/-${options.radiusKm} km), ${region.coordinates.length} polygons -> ${regionPath}`,
  );

  let source = options.source;
  if (!source) {
    if (options.build) {
      source = buildUrl(options.build);
    } else {
      const found = await discoverLatestBuild({ log: (line) => console.log(`  build lookup ${line}`) });
      console.log(`Latest Protomaps build: ${found.date}`);
      source = found.url;
    }
  }
  console.log(`Source: ${source}`);

  // Extract next to the target and rename on success: a half-written file is never served, and
  // the rename is atomic for the tiles container, which mounts the directory.
  const partial = `${out}.partial`;
  const args = buildExtractArgs({
    source,
    output: partial,
    regionPath,
    maxZoom: options.maxZoom,
    threads: options.threads,
    dryRun: options.dryRun,
  });
  console.log(`$ ${options.pmtilesBin} ${args.join(" ")}\n`);
  try {
    await run(options.pmtilesBin, args);
    if (options.dryRun) {
      console.log("\nDry run: nothing was downloaded. Run `pnpm tiles:extract` to create the file.");
      return 0;
    }
    await rename(partial, out);
  } finally {
    await rm(partial, { force: true });
  }
  console.log(`\nWrote ${out}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
