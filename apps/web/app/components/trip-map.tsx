import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { coverImageProps } from "~/lib/cover-image";
import { findHorizon } from "~/lib/horizon";
import { frameOf, type Frame } from "~/lib/trip-projection";
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
/** The word is sized for a word of this many letters (every word has that size, a longer one is condensed first), and condensed to at most this fraction of its width before it is made smaller. */
const NOMINAL_LETTERS = 8;
const WORD_MIN_CONDENSE = 0.72;
/** The faces the giant word can be set in: the CSS font stack, and for one with a width axis its natural width and its narrowest, in percent (`font-stretch`). */
const FACES: Record<string, { font: string; axis?: { base: number; min: number } }> = {
  grotesque: { font: "var(--font-display)" },
  serif: { font: "var(--font-reading)" },
  old: { font: "var(--font-old)" },
  slab: { font: "var(--font-slab)" },
  condensed: { font: "var(--font-condensed)", axis: { base: 78, min: 62 } },
  script: { font: "var(--font-script)" },
  mono: { font: "var(--font-meta)" },
};
/** A flight longer than this (km) is not what the map is framed on. */
const FAR_FLIGHT_KM = 2500;
const distanceKm = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
};
/** The share of the poster's width a word may take before it is condensed. */
const WORD_SOFT = 0.78;

/** The room over the word for its small label (px). */
const TAG_H = 14;

/** The space round the giant word: the same under it and to its left (owner, #510). */
const WORD_PAD = 16;

type Lines = { positions: Float32Array; offsets: Uint32Array };

/**
 * The lines of a set that touch the poster (its whole box, `w` x `h`, and a degree around it: the land runs on under the word's band and off the edges), as one path.
 * `ring`: the outlines of the land, each closed so that it can be filled.
 */
function linesPath(frame: Frame, lines: Lines | null, w: number, h: number, ring = false): string {
  if (!lines) return "";
  const margin = 60;
  const out: string[] = [];
  for (let l = 0; l + 1 < lines.offsets.length; l++) {
    const a = lines.offsets[l]!;
    const b = lines.offsets[l + 1]!;
    let inside = false;
    for (let i = a; i < b && !inside; i++) {
      const p = frame.at(lines.positions[i * 2]!, lines.positions[i * 2 + 1]!);
      inside = p !== null && p.x > -margin && p.x < w + margin && p.y > -margin && p.y < h + margin;
    }
    if (!inside) continue;
    let d = "";
    let pen = false;
    let piece = 0;
    const close = () => {
      // (every land outline is filled, closed or not: a landmass the data cuts at the antimeridian, Europe, Africa and Asia in one, is an open line whose two ends are on that cut, and closing it runs along the cut)
      if (ring && pen && piece > 3) d += "Z";
      piece = 0;
    };
    for (let i = a; i < b; i++) {
      const p = frame.at(lines.positions[i * 2]!, lines.positions[i * 2 + 1]!);
      // (a point on the far side of the globe has no place on the poster, and a line over the world map's seam is not drawn across it: the line is broken there)
      if (!p || (i > a && frame.cuts(lines.positions[(i - 1) * 2]!, lines.positions[i * 2]!))) {
        close();
        pen = false;
        if (!p) continue;
      }
      d += `${pen ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      pen = true;
      piece++;
    }
    close();
    out.push(d);
    continue;
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

/** The country borders, for a trip that is close enough for them to matter (`regional`: a trip inside a continent has no other distinction between its countries); none for a trip across the world. */
function useBorders(regional: boolean) {
  const [borders, setBorders] = useState<Lines | null>(null);
  useEffect(() => {
    if (!regional) return;
    let alive = true;
    import("@catalyst/geodata")
      .then((g) => g.loadBorders())
      .then((b) => alive && setBorders(b))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [regional]);
  return regional ? borders : null;
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
export function TripPoster({ trip, here, photo = true, className, wordFace }: { trip: Trip; here: string; photo?: boolean; className?: string; wordFace?: string | null }) {
  const { ref, w, h } = usePosterBox();
  const word = trip.word.toUpperCase();
  // The giant word is set in the lettering style of the trip's `face` (`routes[].face`: chosen per city, #510); `?word=grotesque|serif|old|slab|condensed|script|mono` overrides it for every card, to try the faces. The condensed face has a real width axis: it is condensed by the axis, the others by squeezing the glyphs.
  const face = FACES[wordFace ?? trip.face ?? ""] ?? FACES.grotesque!;
  const wordFont = face.font;
  const minCondense = face.axis ? face.axis.min / face.axis.base : WORD_MIN_CONDENSE;
  // The word has ONE size on a poster, whatever its length, so the cards of a row read as a set. A word too wide for the poster is first CONDENSED (the face has no width axis: the glyphs are squeezed
  // sideways, `WORD_MIN_CONDENSE` at the most), and only a word that would have to be squeezed further is made smaller.
  const nominal = wordSize(NOMINAL_LETTERS, w, h);
  // The width of the word at the nominal size is measured on an invisible copy (always drawn at that size and at the heaviest weight, the widest it gets: the visible one is thinner or heavier with the
  // card's `--g`, see `.trip-slide` in app.css), so what is drawn never feeds back into what is measured.
  const textRef = useRef<SVGTextElement>(null);
  const [measured, setMeasured] = useState({ key: "", length: 0 });
  const key = `${word}|${nominal}|${w}|${wordFace ?? trip.face ?? ""}`;
  const natural = measured.key === key ? measured.length : 0.66 * nominal * word.length;
  // Three steps, in this order: (1) a word that is wider than the SOFT share of the card (`WORD_SOFT`, so that a word does not run across a wide card) is condensed, down to `WORD_MIN_CONDENSE`; (2) if that is not
  // enough it may take more of the card, up to the whole of it, at that condensing; (3) only a word still wider than the card is made smaller.
  const room = w - 2 * WORD_PAD;
  const condense = natural > 0 ? Math.min(1, Math.max(minCondense, (WORD_SOFT * room) / natural)) : 1;
  const over = natural > 0 ? (natural * condense) / room : 0;
  const size = over > 1 ? Math.max(12, Math.floor(nominal / over)) : nominal;
  const drawn = Math.round(natural * (size / nominal) * condense);
  useEffect(() => {
    const el = textRef.current;
    if (!el || !word) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const length = el.getComputedTextLength();
      if (length > 0) setMeasured((m) => (m.key === key && Math.abs(m.length - length) < 0.5 ? m : { key, length }));
    };
    measure();
    void document.fonts?.ready.then(measure);
    return () => {
      alive = false;
    };
  }, [key, word]);
  // The word's band under the route: its capital letters' height and a margin each side; none without a word. The land is not clipped to it.
  const band = word ? Math.round(size * 0.74) + 2 * WORD_PAD + TAG_H : 0;
  // Where the route goes: above the word, across the width; or, when the poster is wide enough that the room to the right of the word can hold the route at the full height, there.
  const wordW = drawn + WORD_PAD;
  const side = word !== "" && w - wordW - 24 >= h * 0.9;
  const box = side ? { x: wordW + 16, y: 0, w: w - wordW - 24, h } : { x: 0, y: 0, w, h: h - band };
  const backdrop = photo ? trip.photo : undefined;
  // The map is framed on the trip's land: a long flight (over `FAR_FLIGHT_KM`) is not what the trip is about, and fitting it in (the way home across an ocean) left the trip itself a squiggle in a corner of an empty map. The flight is still drawn,
  // as far as the poster goes: it leaves the frame as a stub toward where it flies. A trip of nothing but long flights (or with none) is framed on all of it.
  const framed = useMemo(() => {
    const first = (l: Trip["legPaths"][number]) => ({ lon: l.points[0]!, lat: l.points[1]! });
    const last = (l: Trip["legPaths"][number]) => ({ lon: l.points[l.points.length - 2]!, lat: l.points[l.points.length - 1]! });
    const all = trip.legPaths.flatMap((l) => Array.from({ length: l.points.length / 2 }, (_, k) => ({ lon: l.points[k * 2]!, lat: l.points[k * 2 + 1]! }))).concat(trip.stopPoints.map((q) => ({ lon: q.lon, lat: q.lat })));
    const long = (l: Trip["legPaths"][number]) => l.points.length >= 4 && l.mode === "flight";
    // (the places the trip travels between on the ground; a flight is part of the frame only when both its ends are such places: a flight in from home and one back are not)
    const ground = trip.legPaths.filter((l) => l.points.length >= 4 && !long(l)).flatMap((l) => [first(l), last(l)]);
    const onGround = (q: { lon: number; lat: number }) => ground.some((e) => distanceKm(e, q) < 60);
    const kept = trip.legPaths.filter((l) => l.points.length >= 4 && (!long(l) || (onGround(first(l)) && onGround(last(l)) && distanceKm(first(l), last(l)) <= FAR_FLIGHT_KM)));
    if (ground.length === 0) return all;
    if (kept.length === trip.legPaths.length) return all;
    const ends = kept.flatMap((l) => [first(l), last(l)]);
    const near = (q: { lon: number; lat: number }) => ends.some((e) => distanceKm(e, q) < 60);
    const stops = trip.stopPoints.filter((q) => near(q) || q.slug === here).map((q) => ({ lon: q.lon, lat: q.lat }));
    return kept.flatMap((l) => Array.from({ length: l.points.length / 2 }, (_, k) => ({ lon: l.points[k * 2]!, lat: l.points[k * 2 + 1]! }))).concat(stops);
  }, [trip, here]);
  const frame = useMemo(() => frameOf(framed, box.x, box.y, box.w, box.h, PAD, { w, h: backdrop ? h + PHOTO_RUN : h }), [framed, box.x, box.y, box.w, box.h, w, h, backdrop]);
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
  // (the stops are all within the frame, so they all have a place on it)
  const stopAt = (s: { lon: number; lat: number }) => frame.at(s.lon, s.lat) ?? { x: -99, y: -99 };
  const coast = useCoast(frame.span < REGIONAL_DEG);
  const borders = useBorders(frame.span < REGIONAL_DEG);
  // (the borders are the field's colour, the ocean's: a gap in the land, not a line over it)
  const borderPath = useMemo(() => linesPath(frame, borders, w, backdrop ? h + PHOTO_RUN : h), [frame, borders, w, h, backdrop]);
  const land = useMemo(() => linesPath(frame, coast, w, backdrop ? h + PHOTO_RUN : h, true), [frame, coast, w, h, backdrop]);
  // On a world map (a trip across the globe) the land fades with the distance from the trip, so the map does not stop at the edge of the world: it is there where the route is, and the continents dissolve away from it.
  const maskId = `fade${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const landFade = useMemo(() => {
    if (frame.azimuthal) return null;
    const pts = trip.stopPoints.map((q) => frame.at(q.lon, q.lat)).filter((q): q is { x: number; y: number } => q !== null);
    if (!pts.length) return null;
    const cx = pts.reduce((n, q) => n + q.x, 0) / pts.length;
    const cy = pts.reduce((n, q) => n + q.y, 0) / pts.length;
    const inner = Math.max(...pts.map((q) => Math.hypot(q.x - cx, q.y - cy)));
    const r = inner + 0.3 * Math.max(w, h);
    return { cx, cy, r, inner: Math.min(0.9, (0.6 * inner) / r) };
  }, [frame, trip, w, h]);
  const fadeDefs = landFade && (
    <defs>
      <radialGradient id={`${maskId}-g`} gradientUnits="userSpaceOnUse" cx={landFade.cx} cy={landFade.cy} r={landFade.r}>
        <stop offset={0} stopColor="#fff" />
        <stop offset={landFade.inner} stopColor="#fff" />
        <stop offset={1} stopColor="#000" />
      </radialGradient>
      <mask id={`${maskId}-m`} maskUnits="userSpaceOnUse" x={0} y={-PHOTO_RUN} width={w} height={h + 2 * PHOTO_RUN}>
        <rect x={0} y={-PHOTO_RUN} width={w} height={h + 2 * PHOTO_RUN} fill={`url(#${maskId}-g)`} />
      </mask>
    </defs>
  );
  const landMask = landFade ? `url(#${maskId}-m)` : undefined;
  const current = trip.stopPoints.find((s) => s.slug === here);
  // The named places: the start, the end (one label when they are the same place), this one and the highlights (`Trip.highlights`).
  const inBox = (q: { x: number; y: number }) => q.x >= box.x + 4 && q.x <= box.x + box.w - 4 && q.y >= box.y + 8 && q.y <= box.y + box.h - 4;
  // (this place first, then the start and the end, then the highlights; a name that is outside the frame, such as the far end of a flight home, or that would run over one already placed, is left out)
  const candidates = [current, trip.stopPoints[0], trip.stopPoints[trip.stopPoints.length - 1], ...trip.highlights.map((slug) => trip.stopPoints.find((q) => q.slug === slug))]
    .filter((q): q is Trip["stopPoints"][number] => Boolean(q))
    .filter((q, i, all) => all.findIndex((o) => o.slug === q.slug) === i);
  const named: Array<{ s: Trip["stopPoints"][number]; x: number; y: number; end: boolean }> = [];
  const taken: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  for (const q of candidates) {
    const at = stopAt(q);
    if (!inBox(at)) continue;
    const end = at.x > w * 0.6;
    const width = q.name.length * 6.8;
    const x = end ? at.x - 9 : at.x + 9;
    const y = Math.max(12, at.y - 7);
    const rect = end ? { x0: x - width, x1: x } : { x0: x, x1: x + width };
    const clash = taken.some((t) => rect.x0 < t.x1 + 4 && rect.x1 > t.x0 - 4 && y - 10 < t.y1 && y + 3 > t.y0);
    if (clash) continue;
    taken.push({ ...rect, y0: y - 10, y1: y + 3 });
    named.push({ s: q, x, y, end });
  }
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
      {backdrop && land && (
        // The land on a photograph runs as far as the photograph does and fades with it (the same mask), so the map is not cut at the poster's edge while the picture goes on.
        <svg aria-hidden="true" width={w} height={h + PHOTO_RUN} viewBox={`0 0 ${w} ${h + PHOTO_RUN}`} className="pointer-events-none absolute inset-x-0 top-0 block" style={{ maskImage: fade(h), WebkitMaskImage: fade(h) }}>
          {fadeDefs}
          <path d={land} mask={landMask} style={{ fill: "color-mix(in srgb, #fff 16%, transparent)" }} stroke="none" />
          {borderPath && <path d={borderPath} fill="none" stroke="var(--accent)" strokeWidth={1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        </svg>
      )}
      <svg data-slot="trip-poster" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`Map of the trip, ${trip.from} to ${trip.to}`} className="relative block overflow-hidden">
        {!backdrop && fadeDefs}
        {land && !backdrop && <path d={land} mask={landMask} style={{ fill: tone(9) }} stroke="none" />}
        {borderPath && !backdrop && <path d={borderPath} fill="none" stroke="var(--accent)" strokeWidth={1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        {word && (
          <>
          {/* (the word's width is measured on an invisible copy at the heaviest weight, the widest it gets: the visible one is thinner or heavier with the card's `--g`, see `.trip-slide` in app.css) */}
          <text ref={textRef} aria-hidden="true" x={0} y={-1000} fontSize={nominal} style={{ visibility: "hidden", fontFamily: wordFont, fontWeight: 800, letterSpacing: "-0.03em", ...(face.axis ? { fontStretch: `${face.axis.base}%` } : {}) }}>
            {word}
          </text>
          <text data-slot="trip-word" transform={`translate(${WORD_PAD - Math.round(size * 0.05)} ${h - WORD_PAD}) scale(${face.axis ? "1" : condense.toFixed(3)} 1)`} fontSize={size} style={{ fill: backdrop ? "color-mix(in srgb, var(--foreground) calc(12% + 40% * var(--g, 1) * var(--g, 1)), transparent)" : `color-mix(in srgb, var(--foreground) calc(8% + 24% * var(--g, 1) * var(--g, 1)), var(--accent))`, fontFamily: wordFont, letterSpacing: "-0.03em", ...(face.axis ? { fontStretch: `${(face.axis.base * condense).toFixed(1)}%` } : {}) }}>
            {word}
          </text>
          {/* (what the word is: the trip's code name, not the place's name; the poster's own small mono type, quiet and only on the card in front) */}
          <text data-slot="trip-word-tag" aria-hidden="true" x={WORD_PAD} y={h - WORD_PAD - Math.round(size * 0.74) - 8} fontSize={9} style={{ fill: "var(--foreground)", fontFamily: "var(--font-meta)", fontWeight: 500, letterSpacing: "0.14em", fillOpacity: "clamp(0, calc((var(--g, 1) - 0.4) * 1.1), 0.62)" as unknown as number }}>
            TRIP CODE NAME
          </text>
          </>
        )}
        {trip.legPaths.map((leg, i) => {
          const pts = Array.from({ length: leg.points.length / 2 }, (_, k) => frame.at(leg.points[k * 2]!, leg.points[k * 2 + 1]!))
            .filter((q): q is { x: number; y: number } => q !== null)
            .map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`)
            .join(" ");
          return <polyline key={i} points={pts} fill="none" stroke={ink} strokeWidth={backdrop ? 1.75 : 1.5} strokeDasharray={DASH[leg.mode]} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
        })}
        {trip.stopPoints.map((s, i) => {
          const q = stopAt(s);
          return <rect key={`${s.slug}-${i}`} x={q.x - 1.75} y={q.y - 1.75} width={3.5} height={3.5} fill={ink} />;
        })}
        {current && <rect x={stopAt(current).x - 6} y={stopAt(current).y - 6} width={12} height={12} fill="none" stroke={ink} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
        {named.map(({ s, x, y, end }) => (
          // (a halo in the backdrop's colour keeps a name readable where the route or a border runs under it)
          <text key={s.slug} x={x} y={y} textAnchor={end ? "end" : "start"} fontSize={10} stroke={halo} strokeWidth={3} strokeLinejoin="round" style={{ fill: ink, paintOrder: "stroke", fontFamily: "var(--font-meta)", fontWeight: 700, letterSpacing: "0.04em" }}>
            {s.name.toUpperCase()}
          </text>
        ))}
      </svg>
    </div>
  );
}
