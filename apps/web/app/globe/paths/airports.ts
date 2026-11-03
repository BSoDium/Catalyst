/**
 * The airports of the flights (pure, unit tested). A flight that names the airport of a stop is drawn between the airports, not between the
 * places' points: its arc starts and ends at the airport, which the map marks with a small dot, a location in the city and not a place. An end with
 * an airport is not cropped at the stop's box (the airport is where the flight ends, in the city's box or just outside it).
 */
import type { GlobeAirport, GlobeLeg, GlobeRoute } from "../types";

interface Point {
  lat: number;
  lon: number;
}

/** The two ends of a leg as it is drawn: the points the arc joins and whether each end is cut at its stop's box. */
export interface LegEnds {
  from: Point;
  to: Point;
  cropFrom: boolean;
  cropTo: boolean;
}

/** The ends of a leg between stops `a` and `b`: a flight with an airport at an end goes to it and is not cropped there; everything else is as it was. */
export function legEnds(a: Point, b: Point, spec?: Pick<GlobeLeg, "mode" | "fromAirport" | "toAirport"> | null): LegEnds {
  const flight = spec?.mode === "flight";
  const from = flight ? spec?.fromAirport : undefined;
  const to = flight ? spec?.toAirport : undefined;
  return { from: from ?? a, to: to ?? b, cropFrom: !from, cropTo: !to };
}

/** The airports to mark: each one once (the same airport serves many legs), in the order of the routes. */
export function airportsOf(routes: readonly GlobeRoute[]): GlobeAirport[] {
  const seen = new Set<string>();
  const out: GlobeAirport[] = [];
  for (const route of routes) {
    for (const leg of route.legs ?? []) {
      if (leg?.mode !== "flight") continue;
      for (const ap of [leg.fromAirport, leg.toAirport]) {
        if (!ap) continue;
        const key = `${ap.lat.toFixed(4)},${ap.lon.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(ap);
      }
    }
  }
  return out;
}
