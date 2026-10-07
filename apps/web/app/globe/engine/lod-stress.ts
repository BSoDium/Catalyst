import type { GlobeGroup, GlobePlace } from "../types";

/**
 * A deterministic synthetic hierarchy of about `count` nodes (6 continents, each with countries of 4 places), for the
 * performance checks only (`?globe-debug&lod-stress=N`): the demo projection has too few nodes to time the semantic zoom.
 */
export function stressHierarchy(count: number): { places: GlobePlace[]; groups: GlobeGroup[] } {
  const perCountry = 5; // the country itself and its 4 places
  const countries = Math.max(1, Math.ceil((count - 6) / (6 * perCountry)));
  const groups: GlobeGroup[] = [];
  const places: GlobePlace[] = [];
  for (let c = 0; c < 6; c++) {
    const lat = -45 + c * 18;
    const lon = -160 + c * 62;
    groups.push({ slug: `s-c${c}`, name: `Continent ${c}`, kind: "continent", lat, lon, viewRadiusKm: 2600, labelPriority: 90 });
    for (let k = 0; k < countries; k++) {
      const cl = lat + (((k * 7) % 11) - 5) * 2.2;
      const co = lon + (((k * 5) % 13) - 6) * 3.1;
      groups.push({ slug: `s-c${c}k${k}`, name: `Country ${c}.${k}`, kind: "country", parent: `s-c${c}`, lat: cl, lon: co, viewRadiusKm: 300, labelPriority: 70 });
      for (let q = 0; q < 4; q++) {
        places.push({
          slug: `s-c${c}k${k}q${q}`,
          name: `Place ${c}.${k}.${q}`,
          lat: cl + ((q % 2) - 0.5) * 2.4,
          lon: co + (Math.floor(q / 2) - 0.5) * 3.2,
          labelPriority: 30 + q * 5,
          groupSlug: `s-c${c}k${k}`,
        });
      }
    }
  }
  return { places, groups };
}

/**
 * Three hand-made cases for the cluster checks (`?globe-debug&lod-cases`): a country with 10 places about 110 km apart (one box that
 * opens on zoom), a lone place on another continent (a dot at every zoom), and a country with two far apart places (two dots,
 * never a box). Coordinates are in the Atlantic and Africa, away from the demo places.
 */
export function casesHierarchy(): { places: GlobePlace[]; groups: GlobeGroup[] } {
  const groups: GlobeGroup[] = [
    { slug: "case-crowd", name: "Crowd", kind: "country", lat: 9.5, lon: 13.2, viewRadiusKm: 250, labelPriority: 70 },
    { slug: "case-pair", name: "Pair", kind: "country", lat: -5, lon: 30, viewRadiusKm: 1500, labelPriority: 70 },
    { slug: "case-solo-group", name: "Solo group", kind: "country", lat: 40, lon: -45, viewRadiusKm: 50, labelPriority: 70 },
  ];
  const places: GlobePlace[] = [];
  for (let k = 0; k < 10; k++) places.push({ slug: `crowd-${k}`, name: `Crowd ${k + 1}`, lat: 8 + (k % 4) * 1, lon: 12 + Math.floor(k / 4) * 1.2, labelPriority: 40, groupSlug: "case-crowd" });
  places.push({ slug: "pair-a", name: "Pair A", lat: -5, lon: 18, labelPriority: 40, groupSlug: "case-pair" });
  places.push({ slug: "pair-b", name: "Pair B", lat: -5, lon: 42, labelPriority: 40, groupSlug: "case-pair" });
  places.push({ slug: "lone", name: "Lone", lat: 40, lon: -45, labelPriority: 40, groupSlug: "case-solo-group" });
  return { places, groups };
}
