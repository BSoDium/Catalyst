import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { coverImageProps } from "~/lib/cover-image";
import { findHorizon } from "~/lib/horizon";
import type { Trip } from "~/lib/journeys";
import { cn } from "~/lib/utils";

/** The strokes of the route, by mode: the same patterns as the maps' lines (solid road, dashed rail, dotted ferry and flight). */
const DASH: Record<string, string | undefined> = { road: undefined, rail: "5 3", ferry: "1.5 3", flight: "1.5 3", walk: "1.5 2", unknown: "5 4" };

/** How far the photograph runs on below the poster, under the figures, before it has faded out (CSS px). */
const PHOTO_RUN = 150;

/** The photograph's mask: whole down to most of the poster, half at its bottom edge, gone `PHOTO_RUN` px under it (the card's background shows through). */
const fade = (h: number) => `linear-gradient(to bottom, #000 ${Math.round(h * 0.6)}px, rgb(0 0 0 / 0.55) ${h}px, transparent ${h + PHOTO_RUN}px)`;

/**
 * The two filters (`--trip-photo-filter`, `.trip-photo` in app.css; one set for all the posters) that hold a photograph's levels in a band: in the light theme the light end of the range
 * (the ink is dark on it), in the dark theme the dark end. Every channel gets the same slope and intercept, so the colours keep their relations; the contrast of the ink on the darkest or lightest
 * pixel of the band is then at least about 5 : 1, whatever the photograph.
 */
export function TripPhotoFilters() {
  const levels = (slope: number, intercept: number) => (
    <feComponentTransfer>
      <feFuncR type="linear" slope={slope} intercept={intercept} />
      <feFuncG type="linear" slope={slope} intercept={intercept} />
      <feFuncB type="linear" slope={slope} intercept={intercept} />
    </feComponentTransfer>
  );
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" className="pointer-events-none absolute">
      <filter id="trip-range-light" colorInterpolationFilters="sRGB">
        <feColorMatrix type="saturate" values="1.1" />
        {levels(0.36, 0.62)}
      </filter>
      <filter id="trip-range-dark" colorInterpolationFilters="sRGB">
        <feColorMatrix type="saturate" values="1.1" />
        {levels(0.3, 0.04)}
      </filter>
    </svg>
  );
}

/** The poster's size before it is measured (and on the server): the proportion every poster up to `MAX_H` high has, and a width a phone's panel has. */
const W0 = 360;
const ASPECT = 0.83;
/** The poster is never taller than this (CSS px): on a wide panel it stretches in width and not in height (owner, #510). */
const MAX_H = 320;
const PAD = 26;
/** The space round the giant word: the same under it and to its left (owner, #510). */
const WORD_PAD = 16;

interface Frame {
  x: (lon: number) => number;
  y: (lat: number) => number;
  /** The inverse of `x` and `y`: the longitude and latitude at a point of the poster. */
  lonAt: (x: number) => number;
  latAt: (y: number) => number;
  lon0: number;
  lon1: number;
  lat0: number;
  lat1: number;
  /** The larger side of the trip's box, degrees: how close the map is (`coastsFor`). */
  span: number;
}

/** An equirectangular frame (longitudes shrunk by cos of the middle latitude) that fits the trip in the box `bw` x `bh` at (`bx`, `by`) with PAD around it, centred in it. */
function frameOf(trip: Trip, bx: number, by: number, bw: number, bh: number): Frame {
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
  const scale = Math.max(0.0001, Math.min((bw - 2 * PAD) / spanX, (bh - 2 * PAD) / spanY));
  const offX = bx + (bw - spanX * scale) / 2;
  const offY = by + (bh - spanY * scale) / 2;
  return {
    x: (lon) => offX + (lon - lon0) * k * scale,
    y: (lat) => by + bh - (offY - by) - (lat - lat0) * scale,
    lonAt: (x) => lon0 + (x - offX) / (k * scale),
    latAt: (y) => lat0 + (by + bh - (offY - by) - y) / scale,
    lon0,
    lon1,
    lat0,
    lat1,
    span: Math.max(lon1 - lon0, lat1 - lat0),
  };
}

type Lines = { positions: Float32Array; offsets: Uint32Array };

/**
 * The lines of a set that touch the poster (its whole box, `w` x `h`, and a degree around it: the land runs on under the word's band and off the edges), as one path.
 * `ring`: only the lines that end where they began, closed so that they can be filled.
 */
function linesPath(frame: Frame, lines: Lines | null, w: number, h: number, ring = false): string {
  if (!lines) return "";
  const west = frame.lonAt(0) - 1;
  const east = frame.lonAt(w) + 1;
  const north = frame.latAt(0) + 1;
  const south = frame.latAt(h) - 1;
  const out: string[] = [];
  for (let l = 0; l + 1 < lines.offsets.length; l++) {
    const a = lines.offsets[l]!;
    const b = lines.offsets[l + 1]!;
    let inside = false;
    for (let i = a; i < b && !inside; i++) {
      const lon = lines.positions[i * 2]!;
      const lat = lines.positions[i * 2 + 1]!;
      inside = lon > west && lon < east && lat > south && lat < north;
    }
    if (!inside) continue;
    let d = "";
    for (let i = a; i < b; i++) d += `${i === a ? "M" : "L"}${frame.x(lines.positions[i * 2]!).toFixed(1)} ${frame.y(lines.positions[i * 2 + 1]!).toFixed(1)}`;
    if (!ring) out.push(d);
    else if (b - a > 3 && lines.positions[a * 2] === lines.positions[(b - 1) * 2] && lines.positions[a * 2 + 1] === lines.positions[(b - 1) * 2 + 1]) out.push(`${d}Z`);
  }
  return out.join("");
}

/** A trip within this many degrees is a regional one: the finer coastline (50 m) is used for its land, a bigger one gets the 110 m coastline. */
const REGIONAL_DEG = 40;

/**
 * The land behind the route (the 110 m coastline for a trip across the world, the 50 m one, which the globe loads when it comes close, for a regional trip: the route is far more
 * precise than the 110 m outline), drawn as surfaces without outlines or borders. Loaded when the card shows.
 */
function useCoast(regional: boolean) {
  const [coast, setCoast] = useState<Lines | null>(null);
  useEffect(() => {
    let alive = true;
    import("@catalyst/geodata")
      .then((g) => (regional ? g.loadDetailedCoastlines() : g.loadCoastlines()))
      .then((c) => alive && setCoast(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [regional]);
  return coast;
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

/** The size (px) of the small copy of a photograph that the horizon is looked for in: its width, and its height as far as the proportion goes (at most `HORIZON_ROWS` rows). */
const HORIZON_COLS = 40;
const HORIZON_ROWS = 120;

/**
 * Where the horizon of the photograph is (a share of its height from the top, or null: none, or not readable), looked for once it has loaded in a small copy of it drawn on a canvas.
 * The photograph is the site's own file (same origin), so the canvas can be read; if it cannot, there is no horizon and the photograph is placed as it is.
 */
function useHorizon(src: string | undefined) {
  const [state, setState] = useState<{ src: string; horizon: number | null; w: number; h: number } | null>(null);
  const read = useCallback((img: HTMLImageElement) => {
    if (!img.naturalWidth || !img.naturalHeight || !src) return;
    let horizon: number | null = null;
    try {
      const cols = HORIZON_COLS;
      const rows = Math.min(HORIZON_ROWS, Math.max(12, Math.round((cols * img.naturalHeight) / img.naturalWidth)));
      const canvas = document.createElement("canvas");
      canvas.width = cols;
      canvas.height = rows;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(img, 0, 0, cols, rows);
        const { data } = ctx.getImageData(0, 0, cols, rows);
        const colours: Array<[number, number, number]> = [];
        for (let y = 0; y < rows; y++) {
          let r = 0;
          let g = 0;
          let b = 0;
          for (let x = 0; x < cols; x++) {
            const i = (y * cols + x) * 4;
            r += data[i]!;
            g += data[i + 1]!;
            b += data[i + 2]!;
          }
          colours.push([r / cols / 255, g / cols / 255, b / cols / 255]);
        }
        horizon = findHorizon(colours);
      }
    } catch {
      horizon = null;
    }
    setState((prev) => (prev && prev.src === src && prev.horizon === horizon && prev.w === img.naturalWidth ? prev : { src, horizon, w: img.naturalWidth, h: img.naturalHeight }));
  }, [src]);
  // (the picture may have loaded before React attached `onLoad`)
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (ref.current?.complete) read(ref.current);
  }, [read]);
  return { horizon: state && state.src === src ? state : null, read, ref };
}

/**
 * The trip as a poster (owner's mood board, #510): a flat field with the trip's one word in giant type nested in its bottom-left corner, the route above the word as
 * one thin line (the maps' patterns for rail, ferry and flights) with a square at every stop and the start, the end and the place the panel is about named. The land
 * behind it (a faint surface, without outline, `useCoast`) runs on under the word: only the route keeps clear of it. With a
 * photograph of the trip (`trip.photo`) the photo is the backdrop, its dynamic range held in a band the ink reads on (`TripPhotoFilters`), the photograph running on under the figures and fading into the card's background, the land on top of it as a translucent surface in the field's colour (it lightens the photograph in the light theme and darkens it in the dark one) without outlines, and the route and the word as on the flat field. The height is at
 * most `MAX_H`: on a wide panel the poster stretches in width, not in height. Decoration for the eyes: the card's text says all of it.
 */
export function TripPoster({ trip, here, photo = true, className }: { trip: Trip; here: string; photo?: boolean; className?: string }) {
  const { ref, w, h } = usePosterBox();
  const word = trip.word.toUpperCase();
  const base = wordSize(word.length, w, h);
  // The word is measured once it is drawn (its font is not the one the size was worked out for): if it is wider than the poster leaves it, it is made smaller to fit.
  const textRef = useRef<SVGTextElement>(null);
  const [fit, setFit] = useState({ key: "", scale: 1, length: 0 });
  const key = `${word}|${base}|${w}`;
  const scale = fit.key === key ? fit.scale : 1;
  const size = Math.round(base * scale);
  useEffect(() => {
    const el = textRef.current;
    if (!el || !word) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const length = el.getComputedTextLength();
      const room = w - 2 * WORD_PAD;
      if (length <= 0) return;
      const next = Math.min(1, (scale * room) / length);
      setFit((f) => (f.key === key && Math.abs(f.scale - next) < 0.005 ? f : { key, scale: next, length: length * (next / scale) }));
    };
    measure();
    void document.fonts?.ready.then(measure);
    return () => {
      alive = false;
    };
  }, [key, word, w, scale]);
  // The word's band under the route: its capital letters' height and a margin each side; none without a word. The land is not clipped to it.
  const band = word ? Math.round(size * 0.74) + 2 * WORD_PAD : 0;
  // Where the route goes: above the word, across the width; or, when the poster is wide enough that the room to the right of the word can hold the route at the full height, there.
  const wordW = (fit.key === key ? Math.round(fit.length) : Math.round(0.66 * size * word.length)) + WORD_PAD;
  const side = word !== "" && w - wordW - 24 >= h * 0.9;
  const box = side ? { x: wordW + 16, y: 0, w: w - wordW - 24, h } : { x: 0, y: 0, w, h: h - band };
  const frame = useMemo(() => frameOf(trip, box.x, box.y, box.w, box.h), [trip, box.x, box.y, box.w, box.h]);
  const backdrop = photo ? trip.photo : undefined;
  const horizon = useHorizon(backdrop?.src);
  // The photograph placed so that its horizon is at the poster's bottom edge: scaled up as far as it takes to fill the layer above and below that line, never less than the cover size.
  const placed = (() => {
    const hz = horizon.horizon;
    if (!backdrop || !hz || hz.horizon === null) return null;
    const f = hz.horizon;
    const run = h + PHOTO_RUN;
    const k = Math.max(w / hz.w, h / (f * hz.h), PHOTO_RUN / ((1 - f) * hz.h), run / hz.h);
    return { width: k * hz.w, height: k * hz.h, left: (w - k * hz.w) / 2, top: h - f * k * hz.h } as const;
  })();
  const coast = useCoast(frame.span < REGIONAL_DEG);
  const land = useMemo(() => linesPath(frame, coast, w, h, true), [frame, coast, w, h]);
  const current = trip.stopPoints.find((s) => s.slug === here);
  // The named places: the start, the end (one label when they are the same place), this one and the highlights (`Trip.highlights`).
  const named = [trip.stopPoints[0], trip.stopPoints[trip.stopPoints.length - 1], current, ...trip.highlights.map((slug) => trip.stopPoints.find((s) => s.slug === slug))]
    .filter((s): s is Trip["stopPoints"][number] => Boolean(s))
    .filter((s, i, all) => all.findIndex((o) => o.slug === s.slug) === i);
  const tone = (share: number) => `color-mix(in srgb, var(--foreground) ${share}%, var(--accent))`;
  // The same ink on the field's colour with or without a photograph: the photograph is veiled in the FIELD's colour (light in the light theme, dark in the dark one), so it sits close to the card's background instead of standing out of it.
  const ink = "var(--foreground)";
  const halo = "var(--accent)";
  return (
    <div ref={ref} data-slot="trip-poster-box" data-photo={backdrop ? "" : undefined} className={cn("relative w-full", backdrop ? "" : "bg-accent", className)} style={{ aspectRatio: `1 / ${ASPECT}`, maxHeight: MAX_H }}>
      {backdrop && (
        // The photograph runs on under the figures below the poster (`PHOTO_RUN`) and fades into the card's background there (`maskImage`), so it ends in no edge: its dynamic range
        // is held in a band the ink reads on in either theme (`TripPhotoFilters`), not dimmed by a veil. Where it has a horizon, the picture is placed so that the horizon is the seam
        // between the poster and the figures (the poster's bottom edge): sky and map above it, the ground under it.
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10" style={{ height: h + PHOTO_RUN, maskImage: fade(h), WebkitMaskImage: fade(h) }}>
          <img
            {...coverImageProps(backdrop, `${w}px`)}
            alt=""
            decoding="async"
            onLoad={(e) => horizon.read(e.currentTarget)}
            ref={horizon.ref}
            className={cn("trip-photo", placed ? "absolute max-w-none" : "size-full object-cover")}
            style={placed ?? undefined}
          />
        </div>
      )}
      <svg data-slot="trip-poster" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`Map of the trip, ${trip.from} to ${trip.to}`} className="relative block overflow-hidden">
        {land && <path d={land} style={{ fill: backdrop ? "color-mix(in srgb, var(--accent) 38%, transparent)" : tone(9) }} stroke="none" />}
        {word && (
          <text ref={textRef} x={WORD_PAD - Math.round(size * 0.05)} y={h - WORD_PAD} fontSize={size} style={{ fill: backdrop ? "color-mix(in srgb, var(--foreground) 36%, transparent)" : tone(22), fontFamily: "var(--font-display)", fontWeight: 800, letterSpacing: "-0.03em" }}>
            {word}
          </text>
        )}
        {trip.legPaths.map((leg, i) => {
          const pts = Array.from({ length: leg.points.length / 2 }, (_, k) => `${frame.x(leg.points[k * 2]!).toFixed(1)},${frame.y(leg.points[k * 2 + 1]!).toFixed(1)}`).join(" ");
          return <polyline key={i} points={pts} fill="none" stroke={ink} strokeWidth={backdrop ? 1.75 : 1.5} strokeDasharray={DASH[leg.mode]} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
        })}
        {trip.stopPoints.map((s, i) => (
          <rect key={`${s.slug}-${i}`} x={frame.x(s.lon) - 1.75} y={frame.y(s.lat) - 1.75} width={3.5} height={3.5} fill={ink} />
        ))}
        {current && <rect x={frame.x(current.lon) - 6} y={frame.y(current.lat) - 6} width={12} height={12} fill="none" stroke={ink} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
        {named.map((s) => {
          const x = frame.x(s.lon);
          const end = x > w * 0.6;
          // (a halo in the backdrop's colour keeps a name readable where the route or a border runs under it)
          return (
            <text key={s.slug} x={end ? x - 9 : x + 9} y={Math.max(12, frame.y(s.lat) - 7)} textAnchor={end ? "end" : "start"} fontSize={10} stroke={halo} strokeWidth={3} strokeLinejoin="round" style={{ fill: ink, paintOrder: "stroke", fontFamily: "var(--font-meta)", fontWeight: 700, letterSpacing: "0.04em" }}>
              {s.name.toUpperCase()}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
