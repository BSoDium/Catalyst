/**
 * The airports of the flights (pure, unit tested). A flight that names the airport of a stop is drawn between the airports, not between the
 * places' points: its arc starts and ends at the airport, which the map marks with a small dot, a location in the city and not a place. An end with
 * an airport is not cropped at the stop's box (the airport is where the flight ends, in the city's box).
 *
 * An airport counts only when it lies INSIDE the box of its stop (owner, 2026-11-03: an arc that ends outside the city looked wrong): a city whose airport
 * is outside its box (or has no box) is drawn as it was, the arc ending at the box. No path from the airport to the city is invented.
 */
import type { GlobeAirport, GlobeLeg, GlobeRoute } from "../types";

interface Point {
  lat: number;
  lon: number;
}

/** `[west, south, east, north]`, degrees: a stop's box. */
export type StopBox = readonly [number, number, number, number];

/** The stops' boxes of a leg (the one the leg leaves from, the one it arrives at): what decides whether an airport is in its city. */
export interface LegBoxes {
  from?: StopBox | null;
  to?: StopBox | null;
}

const within = (ap: Point, box: StopBox | null | undefined): boolean => !!box && ap.lon >= box[0] && ap.lon <= box[2] && ap.lat >= box[1] && ap.lat <= box[3];

/** The two ends of a leg as it is drawn: the points the arc joins and whether each end is cut at its stop's box. */
export interface LegEnds {
  from: Point;
  to: Point;
  cropFrom: boolean;
  cropTo: boolean;
}

/** The ends of a leg between stops `a` and `b`: a flight with an airport inside the stop's box at an end goes to it and is not cropped there; everything else is as it was. */
export function legEnds(a: Point, b: Point, spec?: Pick<GlobeLeg, "mode" | "fromAirport" | "toAirport"> | null, boxes?: LegBoxes): LegEnds {
  const flight = spec?.mode === "flight";
  const from = flight && spec?.fromAirport && within(spec.fromAirport, boxes?.from) ? spec.fromAirport : undefined;
  const to = flight && spec?.toAirport && within(spec.toAirport, boxes?.to) ? spec.toAirport : undefined;
  return { from: from ?? a, to: to ?? b, cropFrom: !from, cropTo: !to };
}

/** The airports to mark: each one once (the same airport serves many legs), in the order of the routes, and only those inside the box of their stop (`legEnds`). */
export function airportsOf(routes: readonly GlobeRoute[]): GlobeAirport[] {
  const seen = new Set<string>();
  const out: GlobeAirport[] = [];
  for (const route of routes) {
    (route.legs ?? []).forEach((leg, i) => {
      if (leg?.mode !== "flight") return;
      const ends = legEnds(route.points[i]!, route.points[i + 1]!, leg, { from: route.boxes?.[i], to: route.boxes?.[i + 1] });
      for (const ap of [ends.from === route.points[i] ? undefined : leg.fromAirport, ends.to === route.points[i + 1] ? undefined : leg.toAirport]) {
        if (!ap) continue;
        const key = `${ap.lat.toFixed(4)},${ap.lon.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(ap);
      }
    });
  }
  return out;
}
