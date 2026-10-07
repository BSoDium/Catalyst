import { loadDemoProjection } from "@catalyst/published";
import { toPlaceSummary, type PlaceSummary, type PublishedRoute } from "@catalyst/schemas";
import { loadBorders, loadCoastlines } from "@catalyst/geodata";

export interface Dataset {
  places: PlaceSummary[];
  routes: PublishedRoute[];
}

/** Fixture places and curated routes. No content is invented here. */
export function loadDataset(opts: { stressMarkers?: number } = {}): Dataset {
  const projection = loadDemoProjection();
  const places = projection.places.map(toPlaceSummary);
  if (opts.stressMarkers) places.push(...syntheticMarkers(opts.stressMarkers));
  return { places, routes: projection.routes };
}

/**
 * Benchmark-only stress markers (`?bench=1&markers=N`): deterministic pseudo-random coordinates with neutral
 * placeholder names, used to exercise GL point counts and label collision. Never part of the fixture.
 */
function syntheticMarkers(n: number): PlaceSummary[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, (_, i) => ({
    slug: `stress-${i}`,
    name: `Stress ${i}`,
    coordinates: { lon: rnd() * 360 - 180, lat: Math.asin(rnd() * 2 - 1) * (180 / Math.PI) },
    labelPriority: Math.floor(rnd() * 100),
  }));
}

export async function loadGeodata() {
  const [coastlines, borders] = await Promise.all([loadCoastlines(), loadBorders()]);
  return { coastlines, borders };
}
