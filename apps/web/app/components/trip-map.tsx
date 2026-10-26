import { useEffect, useMemo, useState } from "react";
import type { Trip } from "~/lib/journeys";
import { cn } from "~/lib/utils";

/** The strokes of the small map, by mode: the same patterns as the maps' lines (solid road, dashed rail, dotted ferry and flight). */
const DASH: Record<string, string | undefined> = { road: undefined, rail: "5 3", ferry: "1.5 3", flight: "1.5 3", walk: "1.5 2", unknown: "5 4" };

/** The map's two sizes (its own coordinate space; the SVG scales): the full card map, and the thumbnail of the trip card. */
const SIZES = { card: { w: 360, h: 168, pad: 14 }, thumb: { w: 176, h: 128, pad: 10 } } as const;
type MapSize = keyof typeof SIZES;

interface Frame {
  x: (lon: number) => number;
  y: (lat: number) => number;
  lon0: number;
  lon1: number;
  lat0: number;
  lat1: number;
}

/** An equirectangular frame (longitudes shrunk by cos of the middle latitude) that fits the trip in W x H with PAD around it. */
function frameOf(trip: Trip, W: number, H: number, PAD: number): Frame {
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

/**
 * The trip on one small map: the coast behind it (loaded when the card shows, the same data the globe uses), the legs from the blue tail of the
 * trip's gradient to its violet head in the patterns the maps draw, every stop a small square and the place the panel is about a ring. Decoration
 * for the eyes: the card's text says all of it.
 */
export function TripMap({ trip, here, size = "card", className }: { trip: Trip; here: string; size?: MapSize; className?: string }) {
  const { w: W, h: H, pad } = SIZES[size];
  const frame = useMemo(() => frameOf(trip, W, H, pad), [trip, W, H, pad]);
  const [coast, setCoast] = useState<{ positions: Float32Array; offsets: Uint32Array } | null>(null);
  useEffect(() => {
    let alive = true;
    import("@catalyst/geodata").then((g) => g.loadCoastlines()).then((c) => alive && setCoast(c)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const land = useMemo(() => coastPath(frame, coast), [frame, coast]);
  const legs = trip.legPaths.length;
  const current = trip.stopPoints.find((s) => s.slug === here);
  return (
    <svg
      data-slot="trip-map"
      viewBox={`0 0 ${W} ${H}`}
      {...(size === "thumb" ? { "aria-hidden": true as const } : { role: "img" as const, "aria-label": `Map of the trip, ${trip.from} to ${trip.to}` })}
      className={cn("block h-auto w-full bg-accent", className)}
    >
      <defs>
        <clipPath id={`trip-map-clip-${trip.id}`}>
          <rect width={W} height={H} />
        </clipPath>
      </defs>
      <g clipPath={`url(#trip-map-clip-${trip.id})`}>
        {land && <path d={land} fill="none" stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
        {trip.legPaths.map((leg, i) => {
          const pts = Array.from({ length: leg.points.length / 2 }, (_, k) => `${frame.x(leg.points[k * 2]!).toFixed(1)},${frame.y(leg.points[k * 2 + 1]!).toFixed(1)}`).join(" ");
          // the gradient runs over the whole trip: tail blue at the first leg, head violet at the last
          const share = legs > 1 ? Math.round((1 - i / (legs - 1)) * 100) : 100;
          return <polyline key={i} points={pts} fill="none" style={{ stroke: `color-mix(in srgb, var(--trail-from) ${share}%, var(--trail-to))` }} strokeWidth={1.75} strokeDasharray={DASH[leg.mode]} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />;
        })}
        {trip.stopPoints.map((s, i) => (
          <rect key={`${s.slug}-${i}`} x={frame.x(s.lon) - 1.75} y={frame.y(s.lat) - 1.75} width={3.5} height={3.5} fill="var(--background)" stroke="var(--trail-from)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {current && (
          <rect x={frame.x(current.lon) - 5} y={frame.y(current.lat) - 5} width={10} height={10} fill="var(--trail-to)" stroke="var(--background)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        )}
      </g>
    </svg>
  );
}
