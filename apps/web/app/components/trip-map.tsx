import { useEffect, useMemo, useRef, useState } from "react";
import type { Trip } from "~/lib/journeys";
import { cn } from "~/lib/utils";

/** The strokes of the route, by mode: the same patterns as the maps' lines (solid road, dashed rail, dotted ferry and flight). */
const DASH: Record<string, string | undefined> = { road: undefined, rail: "5 3", ferry: "1.5 3", flight: "1.5 3", walk: "1.5 2", unknown: "5 4" };

/** The poster's size before it is measured (and on the server): the proportion every poster up to `MAX_H` high has, and a width a phone's panel has. */
const W0 = 360;
const ASPECT = 0.83;
/** The poster is never taller than this (CSS px): on a wide panel it stretches in width and not in height (owner, #510). */
const MAX_H = 320;
const PAD = 26;

interface Frame {
  x: (lon: number) => number;
  y: (lat: number) => number;
  lon0: number;
  lon1: number;
  lat0: number;
  lat1: number;
  /** The larger side of the trip's box, degrees: how close the map is (`coastsFor`). */
  span: number;
}

/** An equirectangular frame (longitudes shrunk by cos of the middle latitude) that fits the trip in w x h with PAD around it, centred. */
function frameOf(trip: Trip, w: number, h: number): Frame {
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
  const scale = Math.max(0.0001, Math.min((w - 2 * PAD) / spanX, (h - 2 * PAD) / spanY));
  const offX = (w - spanX * scale) / 2;
  const offY = (h - spanY * scale) / 2;
  return { x: (lon) => offX + (lon - lon0) * k * scale, y: (lat) => h - offY - (lat - lat0) * scale, lon0, lon1, lat0, lat1, span: Math.max(lon1 - lon0, lat1 - lat0) };
}

type Lines = { positions: Float32Array; offsets: Uint32Array };

/** The lines of a set that touch the frame (a window wider than the trip: they run off the edges), as one path. `ring`: only the lines that end where they began, closed so that they can be filled. */
function linesPath(frame: Frame, lines: Lines | null, ring = false): string {
  if (!lines) return "";
  const dx = (frame.lon1 - frame.lon0) * 0.6 + 2;
  const dy = (frame.lat1 - frame.lat0) * 0.6 + 2;
  const out: string[] = [];
  for (let l = 0; l + 1 < lines.offsets.length; l++) {
    const a = lines.offsets[l]!;
    const b = lines.offsets[l + 1]!;
    let inside = false;
    for (let i = a; i < b && !inside; i++) {
      const lon = lines.positions[i * 2]!;
      const lat = lines.positions[i * 2 + 1]!;
      inside = lon > frame.lon0 - dx && lon < frame.lon1 + dx && lat > frame.lat0 - dy && lat < frame.lat1 + dy;
    }
    if (!inside) continue;
    let d = "";
    for (let i = a; i < b; i++) d += `${i === a ? "M" : "L"}${frame.x(lines.positions[i * 2]!).toFixed(1)} ${frame.y(lines.positions[i * 2 + 1]!).toFixed(1)}`;
    if (!ring) out.push(d);
    else if (b - a > 3 && lines.positions[a * 2] === lines.positions[(b - 1) * 2] && lines.positions[a * 2 + 1] === lines.positions[(b - 1) * 2 + 1]) out.push(`${d}Z`);
  }
  return out.join("");
}

/** A trip within this many degrees is a regional one: the finer coastline (50 m) and the country borders are drawn, a bigger one gets the 110 m coastline only. */
const REGIONAL_DEG = 40;

/**
 * The geography behind the route: the coast (the 110 m set for a trip across the world, the 50 m one, which the globe loads when it comes close, for a regional
 * trip: the route is far more precise than the 110 m outline) and, for a regional trip, the country borders. Loaded when the card shows.
 */
function useGeography(regional: boolean) {
  const [geo, setGeo] = useState<{ coast: Lines | null; borders: Lines | null; fine: boolean }>({ coast: null, borders: null, fine: false });
  useEffect(() => {
    let alive = true;
    import("@catalyst/geodata")
      .then(async (g) => {
        const [coast, borders] = await Promise.all([regional ? g.loadDetailedCoastlines() : g.loadCoastlines(), regional ? g.loadBorders() : Promise.resolve(null)]);
        if (alive) setGeo({ coast, borders, fine: regional });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [regional]);
  return geo;
}

/** The box the poster is drawn in, measured (CSS px): the width its container gives it and the height `MAX_H` allows. Before it is measured, and on the server, the phone-panel size. */
function usePosterBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: W0, h: Math.round(W0 * ASPECT) });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w > 0 && h > 0) setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...box };
}

/** The giant word's size: the biggest that keeps a heavy, capitalised word of this many letters inside the poster's width (about 0.62 em a letter), never over a third of its height. */
export function wordSize(letters: number, width: number, height: number): number {
  // (never more than a third of the poster's height: on a wide panel the word does not grow with the width)
  return Math.round(Math.min(112, height * 0.34, Math.max(40, (width * 0.96) / (0.62 * Math.max(1, letters)))));
}

/**
 * The trip as a poster (owner's mood board, #510): a flat field, the trip's one word in giant type across the bottom, and above it the route as one thin
 * line (the maps' patterns for rail, ferry and flights) with a square at every stop, the start, the end and the place the panel is about named. Behind the
 * route the land is a faint shape with its coast, and for a regional trip the country borders (`useGeography`). The map and the word never overlap: the word has
 * its own band. The poster's height is at most `MAX_H`: on a wide panel it stretches in width, not in height. Decoration for the eyes: the card's text says all of it.
 */
export function TripPoster({ trip, here, className }: { trip: Trip; here: string; className?: string }) {
  const { ref, w, h } = usePosterBox();
  const word = trip.word.toUpperCase();
  const size = wordSize(word.length, w, h);
  // The word's band under the map: its capital letters' height and a margin; none without a word.
  const band = word ? Math.round(size * 0.74) + 16 : 0;
  const mapH = h - band;
  const frame = useMemo(() => frameOf(trip, w, mapH), [trip, w, mapH]);
  const geo = useGeography(frame.span < REGIONAL_DEG);
  const land = useMemo(() => linesPath(frame, geo.coast, true), [frame, geo.coast]);
  const coast = useMemo(() => linesPath(frame, geo.coast), [frame, geo.coast]);
  const borders = useMemo(() => linesPath(frame, geo.borders), [frame, geo.borders]);
  const current = trip.stopPoints.find((s) => s.slug === here);
  // The named places: the start, the end (one label when they are the same place) and this one.
  const named = [trip.stopPoints[0], trip.stopPoints[trip.stopPoints.length - 1], current]
    .filter((s): s is Trip["stopPoints"][number] => Boolean(s))
    .filter((s, i, all) => all.findIndex((o) => o.slug === s.slug) === i);
  const tone = (share: number) => `color-mix(in srgb, var(--foreground) ${share}%, var(--accent))`;
  return (
    <div ref={ref} data-slot="trip-poster-box" className={cn("w-full bg-accent", className)} style={{ aspectRatio: `1 / ${ASPECT}`, maxHeight: MAX_H }}>
      <svg data-slot="trip-poster" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`Map of the trip, ${trip.from} to ${trip.to}`} className="block overflow-hidden">
        <defs>
          <clipPath id={`trip-poster-clip-${trip.id}`}>
            <rect width={w} height={mapH} />
          </clipPath>
        </defs>
        {word && (
          <text x={-2} y={h - 10} fontSize={size} style={{ fill: tone(16), fontFamily: "var(--font-display)", fontWeight: 800, letterSpacing: "-0.03em" }}>
            {word}
          </text>
        )}
        <g clipPath={`url(#trip-poster-clip-${trip.id})`}>
          {land && <path d={land} style={{ fill: tone(6) }} stroke="none" />}
          {borders && <path d={borders} fill="none" style={{ stroke: tone(22) }} strokeWidth={0.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
          {coast && <path d={coast} fill="none" style={{ stroke: tone(34) }} strokeWidth={1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
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
            const end = x > w * 0.6;
            // (a halo in the field's colour keeps a name readable where the route or a border runs under it)
            return (
              <text key={s.slug} x={end ? x - 9 : x + 9} y={Math.max(12, frame.y(s.lat) - 7)} textAnchor={end ? "end" : "start"} fontSize={10} stroke="var(--accent)" strokeWidth={3} strokeLinejoin="round" style={{ fill: "var(--foreground)", paintOrder: "stroke", fontFamily: "var(--font-meta)", fontWeight: 700, letterSpacing: "0.04em" }}>
                {s.name.toUpperCase()}
              </text>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
