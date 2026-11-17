import { useEffect, useMemo, useState } from "react";
import type { Trip } from "~/lib/journeys";
import { cn } from "~/lib/utils";

/** The strokes of the small map, by mode: the same patterns as the maps' lines (solid road, dashed rail, dotted ferry and flight). */
const DASH: Record<string, string | undefined> = { road: undefined, rail: "5 3", ferry: "1.5 3", flight: "1.5 3", walk: "1.5 2", unknown: "5 4" };

/** The poster's own coordinate space (the SVG scales to the width it is given, keeping this proportion): the map on top and the trip's word in giant type under it. */
const W = 360;
const H = 300;
/** The map takes the poster's height down to here; the word runs under it (the route is drawn over its letters). */
const MAP_H = 262;
const PAD = 26;

interface Frame {
  x: (lon: number) => number;
  y: (lat: number) => number;
  lon0: number;
  lon1: number;
  lat0: number;
  lat1: number;
}

/** An equirectangular frame (longitudes shrunk by cos of the middle latitude) that fits the trip in W x H with PAD around it. */
function frameOf(trip: Trip): Frame {
  const H = MAP_H;
  const lons = trip.legPaths.flatMap((l) => l.points.filter((_, i) => i % 2 === 0)).concat(trip.stopPoints.map((s) => s.lon));
  const lats = trip.legPaths.flatMap((l) => l.points.filter((_, i) => i % 2 === 1)).concat(trip.stopPoints.map((s) => s.lat));
  let lon0 = Math.min(...lons);
  let lon1 = Math.max(...lons);
  let lat0 = Math.min(...lats);
  let lat1 = Math.max(...lats);
  const k = Math.cos((((lat0 + lat1) / 2) * Math.PI) / 180);
  // never a degenerate box: a trip within one city still gets a map of a few kilometres
  const minSpan = 0.08;
  if (lon1 - lon0 < minSpan) { const c = (lon0 + lon1) / 2; lon0 = c - minSpan / 2; lon1 = c + minSpan / 2; }
  if (lat1 - lat0 < minSpan) { const c = (lat0 + lat1) / 2; lat0 = c - minSpan / 2; lat1 = c + minSpan / 2; }
  const spanX = (lon1 - lon0) * k;
  const spanY = lat1 - lat0;
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const offX = (W - spanX * scale) / 2;
  const offY = (H - spanY * scale) / 2;
  return { x: (lon) => offX + (lon - lon0) * k * scale, y: (lat) => H - offY - (lat - lat0) * scale, lon0, lon1, lat0, lat1 };
}

/** The coast lines that touch the frame, as one path (the 110 m set: an overview, not a chart). */
function coastPath(frame: Frame, coast: { positions: Float32Array; offsets: Uint32Array } | null): string {
  if (!coast) return "";
  // a wider window than the trip: the coast runs off the edges of the map
  const dx = (frame.lon1 - frame.lon0) * 0.6 + 2;
  const dy = (frame.lat1 - frame.lat0) * 0.6 + 2;
  const out: string[] = [];
  for (let l = 0; l + 1 < coast.offsets.length; l++) {
    const a = coast.offsets[l]!;
    const b = coast.offsets[l + 1]!;
    let inside = false;
    for (let i = a; i < b && !inside; i++) {
      const lon = coast.positions[i * 2]!;
      const lat = coast.positions[i * 2 + 1]!;
      inside = lon > frame.lon0 - dx && lon < frame.lon1 + dx && lat > frame.lat0 - dy && lat < frame.lat1 + dy;
    }
    if (!inside) continue;
    let d = "";
    for (let i = a; i < b; i++) d += `${i === a ? "M" : "L"}${frame.x(coast.positions[i * 2]!).toFixed(1)} ${frame.y(coast.positions[i * 2 + 1]!).toFixed(1)}`;
    out.push(d);
  }
  return out.join("");
}

/** The giant word's size: the biggest that keeps a heavy, capitalised word of this many letters inside the poster's width (about 0.62 em a letter), from a size that is still a headline to one that does not overflow. */
export function wordSize(letters: number): number {
  return Math.round(Math.min(112, Math.max(46, (W * 0.96) / (0.62 * Math.max(1, letters)))));
}

/**
 * The trip as a poster (owner's mood board, #510): a flat field, the trip's one word in giant type across the bottom, and over it the route as one thin
 * line (the maps' patterns for rail, ferry and flights) with a square at every stop, the start, the end and the place the panel is about named. The coast
 * is drawn faintly behind the line (loaded when the card shows, the same data the globe uses). Decoration for the eyes: the card's text says all of it.
 */
export function TripPoster({ trip, here, className }: { trip: Trip; here: string; className?: string }) {
  const frame = useMemo(() => frameOf(trip), [trip]);
  const [coast, setCoast] = useState<{ positions: Float32Array; offsets: Uint32Array } | null>(null);
  useEffect(() => {
    let alive = true;
    import("@catalyst/geodata").then((g) => g.loadCoastlines()).then((c) => alive && setCoast(c)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const land = useMemo(() => coastPath(frame, coast), [frame, coast]);
  const word = trip.word.toUpperCase();
  const size = wordSize(word.length);
  const current = trip.stopPoints.find((s) => s.slug === here);
  // The named places: the start, the end (one label when they are the same place) and this one.
  const named = [trip.stopPoints[0], trip.stopPoints[trip.stopPoints.length - 1], current]
    .filter((s): s is Trip["stopPoints"][number] => Boolean(s))
    .filter((s, i, all) => all.findIndex((o) => o.slug === s.slug) === i);
  return (
    <svg data-slot="trip-poster" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Map of the trip, ${trip.from} to ${trip.to}`} className={cn("block h-auto w-full overflow-hidden bg-accent", className)}>
      <defs>
        <clipPath id={`trip-poster-clip-${trip.id}`}>
          <rect width={W} height={H} />
        </clipPath>
      </defs>
      <g clipPath={`url(#trip-poster-clip-${trip.id})`}>
        {word && (
          <text x={-2} y={H - 10} fontSize={size} style={{ fill: "color-mix(in srgb, var(--foreground) 16%, var(--accent))", fontFamily: "var(--font-display)", fontWeight: 800, letterSpacing: "-0.03em" }}>
            {word}
          </text>
        )}
        {land && <path d={land} fill="none" style={{ stroke: "color-mix(in srgb, var(--foreground) 30%, var(--accent))" }} strokeWidth={1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
        {trip.legPaths.map((leg, i) => {
          const pts = Array.from({ length: leg.points.length / 2 }, (_, k) => `${frame.x(leg.points[k * 2]!).toFixed(1)},${frame.y(leg.points[k * 2 + 1]!).toFixed(1)}`).join(" ");
          return <polyline key={i} points={pts} fill="none" stroke="var(--foreground)" strokeWidth={1.5} strokeDasharray={DASH[leg.mode]} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />;
        })}
        {trip.stopPoints.map((s, i) => (
          <rect key={`${s.slug}-${i}`} x={frame.x(s.lon) - 1.75} y={frame.y(s.lat) - 1.75} width={3.5} height={3.5} fill="var(--foreground)" />
        ))}
        {current && <rect x={frame.x(current.lon) - 6} y={frame.y(current.lat) - 6} width={12} height={12} fill="none" stroke="var(--foreground)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
        {named.map((s) => {
          const x = frame.x(s.lon);
          const end = x > W * 0.6;
          return (
            <text key={s.slug} x={end ? x - 9 : x + 9} y={frame.y(s.lat) - 7} textAnchor={end ? "end" : "start"} fontSize={10} style={{ fill: "var(--foreground)", fontFamily: "var(--font-meta)", fontWeight: 700, letterSpacing: "0.04em" }}>
              {s.name.toUpperCase()}
            </text>
          );
        })}
      </g>
    </svg>
  );
}
