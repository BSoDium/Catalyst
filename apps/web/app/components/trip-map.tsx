import { type CSSProperties, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { coverImageProps } from "~/lib/cover-image";
import { anchorOf, cutoutOf, OCCLUDE, subjectPlace } from "~/lib/cutout";
import { calmPlace, energyOf, lumaOf, meanUnder } from "~/lib/calm";
import { findHorizon } from "~/lib/horizon";
import { frameOf, type Frame } from "~/lib/trip-projection";
import type { Trip } from "~/lib/journeys";
import { cn } from "~/lib/utils";

/** The strokes of the route, by mode: the same patterns as the maps' lines (solid road, dashed rail, dotted ferry and flight). */
/** The ends of a leg's gradient (the globe's trail tokens `--trail-from` and `--trail-to`: blue at the tail, violet at the head, lighter in the dark scheme), mixed with the ink so that it stays quiet whichever the scheme or the photograph. */
const TRAIL_TAIL = "color-mix(in srgb, var(--trail-from) 55%, var(--foreground))";
const TRAIL_HEAD = "color-mix(in srgb, var(--trail-to) 55%, var(--foreground))";

/** The ink of what is drawn on the route (the dots of the stops, their ring, the names): the foreground washed a quarter toward the field, so it is not the loudest thing on the poster (owner, 2026-11-24). The routes themselves are `ROUTE_OPACITY` of theirs. */
/** The least distance (px) between two dots of the stops on a poster. */
const DOT_GAP = 15;
/** The most names on a poster's route. */
const MAX_LABELS = 6;
/** From this many px a degree the borders and coasts are drawn smoothed (a country across the poster). */
const SMOOTH_PX_PER_DEG = 22;
/** The names are a little quieter still than the dots. */
const LABEL_INK = "color-mix(in srgb, var(--foreground) 66%, transparent)";
const MARK_INK = "color-mix(in srgb, var(--foreground) 74%, transparent)";
const ROUTE_OPACITY = 0.8;

const DASH: Record<string, string | undefined> = { road: undefined, rail: "5 3", ferry: "1.5 3", flight: "1.5 3", walk: "1.5 2", unknown: "5 4" };

/** The subject's mask: whole down to the poster's bottom edge (it hides the word completely: a faded subject lets the word through and the layering is lost), then gone `SUBJECT_RUN` px under it. */
const fadeAfter = (h: number) => `linear-gradient(to bottom, #000 ${h}px, transparent ${h + SUBJECT_RUN}px)`;
/** The subject is gone this far under the poster (CSS px): sooner than the photograph, so the figures' ink is clear of it. */
const SUBJECT_RUN = 70;

/** The width of the gap a country border cuts in the land over a photograph (CSS px, it does not scale). */
const BORDER_GAP = 1.1;

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
        {levels(0.42, 0.05)}
      </filter>
      {/* the subject in front of the word: a gentler band, so it stands out of the backdrop (it is not read through: the ink below the poster is clear of it) */}
      <filter id="trip-subject-light" colorInterpolationFilters="sRGB">
        <feColorMatrix type="saturate" values="1" />
        {levels(0.6, 0.38)}
      </filter>
      <filter id="trip-subject-dark" colorInterpolationFilters="sRGB">
        <feColorMatrix type="saturate" values="1" />
        {levels(0.56, 0.04)}
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

/** The space round the giant word: the same under it and to its left (owner, #510). */
const WORD_PAD = 16;

type Lines = { positions: Float32Array; offsets: Uint32Array };

/**
 * The lines of a set that touch the poster (its whole box, `w` x `h`, and a degree around it: the land runs on under the word's band and off the edges), as one path.
 * `ring`: the outlines of the land, each closed so that it can be filled.
 */
function linesPath(frame: Frame, lines: Lines | null, w: number, h: number, ring = false): string {
  // Close up (a country across the poster) the data's straight segments show: the line is drawn as quadratic curves through the middles of its segments, which rounds the corners without moving the line (the data has no finer resolution: this is what is there to do).
  const smooth = frame.pxPerDeg >= SMOOTH_PX_PER_DEG;
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
    // (the ends of the piece being drawn, and whether the line was cut there by the far side of the globe)
    let cur: Array<{ x: number; y: number }> = [];
    let first: { x: number; y: number } | null = null;
    let last: { x: number; y: number } | null = null;
    let startCut = false;
    let endCut = false;
    let afterGap = false;
    const flush = () => {
      if (cur.length === 0) return;
      d += `M${cur[0]!.x.toFixed(1)} ${cur[0]!.y.toFixed(1)}`;
      if (smooth && cur.length > 2) {
        for (let k = 1; k < cur.length - 1; k++) {
          const m = { x: (cur[k]!.x + cur[k + 1]!.x) / 2, y: (cur[k]!.y + cur[k + 1]!.y) / 2 };
          d += `Q${cur[k]!.x.toFixed(1)} ${cur[k]!.y.toFixed(1)} ${m.x.toFixed(1)} ${m.y.toFixed(1)}`;
        }
        d += `L${cur[cur.length - 1]!.x.toFixed(1)} ${cur[cur.length - 1]!.y.toFixed(1)}`;
      } else for (let k = 1; k < cur.length; k++) d += `L${cur[k]!.x.toFixed(1)} ${cur[k]!.y.toFixed(1)}`;
      cur = [];
    };
    const close = () => {
      flush();
      // (every land outline is filled, closed or not: a landmass the data cuts at the antimeridian, Europe, Africa and Asia in one, is an open line whose two ends are on that cut, and closing it runs along the cut)
      if (ring && pen && piece > 3) {
        const disc = frame.disc;
        if (disc && first && last && (startCut || endCut)) {
          // A line that leaves the azimuthal map at its far side comes back to it: the land is closed along the disc's edge (the shorter way round), not across the poster by a chord.
          const onDisc = (q: { x: number; y: number }) => {
            const a = Math.atan2(q.y - disc.y, q.x - disc.x);
            return { a, x: disc.x + disc.r * Math.cos(a), y: disc.y + disc.r * Math.sin(a) };
          };
          const e = onDisc(last);
          const st = onDisc(first);
          let delta = st.a - e.a;
          while (delta > Math.PI) delta -= 2 * Math.PI;
          while (delta < -Math.PI) delta += 2 * Math.PI;
          d += `L${e.x.toFixed(1)} ${e.y.toFixed(1)}A${disc.r.toFixed(1)} ${disc.r.toFixed(1)} 0 0 ${delta > 0 ? 1 : 0} ${st.x.toFixed(1)} ${st.y.toFixed(1)}L${first.x.toFixed(1)} ${first.y.toFixed(1)}Z`;
        } else d += "Z";
      }
      piece = 0;
      first = null;
      last = null;
      startCut = false;
      endCut = false;
    };
    for (let i = a; i < b; i++) {
      const p = frame.at(lines.positions[i * 2]!, lines.positions[i * 2 + 1]!);
      // (a point on the far side of the globe has no place on the poster, and a line over the world map's seam is not drawn across it: the line is broken there)
      if (!p || (i > a && frame.cuts(lines.positions[(i - 1) * 2]!, lines.positions[i * 2]!))) {
        if (!p) endCut = true;
        close();
        pen = false;
        if (!p) {
          afterGap = true;
          continue;
        }
      }
      if (piece === 0) {
        first = p;
        startCut = afterGap;
        afterGap = false;
      }
      last = p;
      cur.push(p);
      pen = true;
      piece++;
    }
    close();
    out.push(d);
    continue;
  }
  return out.join("");
}

/** The map is this close (px a degree) or closer for the country borders to be drawn. */
const BORDERS_PX_PER_DEG = 8;

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
  const [state, setState] = useState<{ src: string; horizon: number | null; w: number; h: number; energy: Float32Array | null; luma: Float32Array | null; cols: number; rows: number } | null>(null);
  const read = useCallback((img: HTMLImageElement) => {
    if (!img.naturalWidth || !img.naturalHeight || !src) return;
    let horizon: number | null = null;
    let energy: Float32Array | null = null;
    let luma: Float32Array | null = null;
    let eCols = 0;
    let eRows = 0;
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
        // (how much each cell of the small copy changes: where the picture is calm, for the map to fall on)
        energy = energyOf(data, cols, rows);
        luma = lumaOf(data, cols, rows);
        eCols = cols;
        eRows = rows;
      }
    } catch {
      horizon = null;
    }
    setState((prev) => (prev && prev.src === src && prev.horizon === horizon && prev.w === img.naturalWidth ? prev : { src, horizon, w: img.naturalWidth, h: img.naturalHeight, energy, luma, cols: eCols, rows: eRows }));
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
export function TripPoster({ trip, here, photo = true, cutout = true, occlude, className, wordFace }: { trip: Trip; here: string; photo?: boolean; /** The subject of the photograph in front of the word, when it has a cutout (`lib/cutout.ts`); `false` shows the photograph flat, to compare. */ cutout?: boolean; /** The share of the word's height the subject hides (default: the picture's own, else `OCCLUDE`). */ occlude?: number; className?: string; wordFace?: string | null }) {
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
  // Where the route goes: above the word, across the width; or, when the poster is wide enough that the room to the right of the word can hold the route at the full height, there.
  const wordW = drawn + WORD_PAD;
  const side = word !== "" && w - wordW - 24 >= h * 0.9;
  // (above the word the route stops clear of the CODE NAME tag, 26 px over the letters: the start of a trip touched the tag on Moscow's card; the route's markers have a ring of 6 px. the word is quiet, and a strip the height of the whole band left a tall route no room)
  const clear = word ? Math.round(size * 0.74) + WORD_PAD + 26 : 0;
  const box = side ? { x: wordW + 16, y: 0, w: w - wordW - 24, h } : { x: 0, y: 0, w, h: h - clear };
  const backdrop = photo ? trip.photo : undefined;
  // The screen's pixel ratio, read after mounting (the server draws for 1, so the page and the server's agree): a photograph shown larger than its own pixels is softened by as much as it is enlarged.
  const [dpr, setDpr] = useState(1);
  useEffect(() => setDpr(window.devicePixelRatio || 1), []);
  const layer = backdrop && cutout ? cutoutOf(backdrop.src) : undefined;
  // (what the photograph is placed by: its cutout's subject, or, with no cutout drawn, a skyline's edge)
  const anchor = backdrop && cutout ? anchorOf(backdrop.src) : undefined;
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
    if (ground.length === 0) return { pts: all, land: false };
    if (kept.length === trip.legPaths.length) return { pts: all, land: false };
    const ends = kept.flatMap((l) => [first(l), last(l)]);
    const near = (q: { lon: number; lat: number }) => ends.some((e) => distanceKm(e, q) < 60);
    const stops = trip.stopPoints.filter((q) => near(q)).map((q) => ({ lon: q.lon, lat: q.lat }));
    return { pts: kept.flatMap((l) => Array.from({ length: l.points.length / 2 }, (_, k) => ({ lon: l.points[k * 2]!, lat: l.points[k * 2 + 1]! }))).concat(stops), land: true };
  }, [trip]);
  // (a trip framed on its land gets room round it: the continent runs on past the route on every side, so the route is in the map and the map is not a crop of it)
  const pad = framed.land ? Math.min(PAD + Math.round(0.05 * Math.min(box.w, box.h)), Math.round(0.14 * Math.min(box.w, box.h))) : PAD;
  const frame = useMemo(() => frameOf(framed.pts, box.x, box.y, box.w, box.h, pad, { w, h: backdrop ? h + PHOTO_RUN : h }), [framed, box.x, box.y, box.w, box.h, pad, w, h, backdrop]);
  const horizon = useHorizon(backdrop?.src);
  // The photograph placed so that its horizon is at the poster's bottom edge: scaled up as far as it takes to fill the layer above and below that line, never less than the cover size.
  const placed = (() => {
    const hz = horizon.horizon;
    if (!backdrop || !hz) return null;
    const run = h + PHOTO_RUN;
    // With a cutout: the photograph is placed so that its subject's top edge (the skyline, the rail of the boat) falls a share of the letters' height above their foot: the subject hides the bottom of the word, and only that, not where the map is calmest.
    if (anchor) return subjectPlace(anchor, { w: hz.w, h: hz.h }, { w, run }, { x: WORD_PAD + Math.min(drawn, 0.6 * w) / 2, y: h - WORD_PAD - (occlude ?? anchor.occlude ?? OCCLUDE) * 0.74 * size });
    // First the calmest place: the photograph where the map falls on its sky or its plain parts (`lib/calm.ts`), whatever it shows.
    if (hz.energy) {
      const calm = calmPlace(hz.energy, hz.cols, hz.rows, { w: hz.w, h: hz.h }, { w, run }, box);
      if (calm) return { width: calm.width, height: calm.height, left: calm.left, top: calm.top } as const;
    }
    // Else the horizon where the picture has one: the seam between the poster and the figures.
    if (hz.horizon === null) return null;
    const f = hz.horizon;
    const k = Math.max(w / hz.w, h / (f * hz.h), PHOTO_RUN / ((1 - f) * hz.h), run / hz.h);
    return { width: k * hz.w, height: k * hz.h, left: (w - k * hz.w) / 2, top: h - f * k * hz.h } as const;
  })();
  // The photograph enlarged beyond its own pixels (device pixels per source pixel above 1) is blurred by about what the enlargement lacks, so it looks like a shallow depth of field and not like squares (owner, 2026-11-24).
  const softness = placed && backdrop ? Math.min(6, Math.max(0, (placed.width * dpr) / (backdrop.width ?? placed.width) - 0.9) * 1.6) / dpr : 0;
  const softened = (filter: string) => (softness > 0.05 ? `${filter} blur(${softness.toFixed(2)}px)` : undefined);
  // A busy picture is quieter: the more detail there is in the part of it that shows (the mean energy of the layer: 0.03 is a sky and a plain skyline, 0.06 a crowd and a colourful street), the more it is faded into the card's ground, down to half (owner, 2026-11-19: Moscow's was too busy for the content).
  const photoOpacity = (() => {
    const hz = horizon.horizon;
    const busy = placed && hz?.energy ? meanUnder(hz.energy, hz.cols, hz.rows, placed, { x: 0, y: 0, w, h: h + PHOTO_RUN }) : null;
    return busy === null ? 1 : 1 - 0.5 * Math.min(1, Math.max(0, (busy - 0.03) / 0.035));
  })();
  // How much the land lightens the photograph, in percent of white: the brighter the part of the picture under the map, the more (16 at most); over a dark sky (Buenos Aires' storm) only a few, or the continents stand out of it.
  const landShare = (() => {
    const hz = horizon.horizon;
    const m = placed && hz?.luma ? meanUnder(hz.luma, hz.cols, hz.rows, placed, box) : null;
    return m === null ? 16 : Math.round(Math.min(16, Math.max(4, 3 + 22 * m)));
  })();
  // (the stops are all within the frame, so they all have a place on it)
  const stopAt = (s: { lon: number; lat: number }) => frame.at(s.lon, s.lat) ?? { x: -99, y: -99 };
  const coast = useCoast(frame.span < REGIONAL_DEG);
  // (the country borders are for a map that is close enough to read them: at a continent's distance they are a net over the land, `BORDERS_PX_PER_DEG`)
  const borders = useBorders(frame.span < REGIONAL_DEG && frame.pxPerDeg >= BORDERS_PX_PER_DEG);
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
  // The route as lines of the poster (px), for the land's fade on a photograph: the land is there round the route, and dissolves with the distance from it.
  const legLines = useMemo(
    () =>
      trip.legPaths
        .map((leg) => Array.from({ length: leg.points.length / 2 }, (_, k) => frame.at(leg.points[k * 2]!, leg.points[k * 2 + 1]!)).filter((q): q is { x: number; y: number } => q !== null).map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" "))
        .filter((pts) => pts.includes(" ")),
    [trip, frame],
  );
  const near = Math.min(w, h);
  const current = trip.stopPoints.find((s) => s.slug === here);
  // The named places: the start, the end (one label when they are the same place), this one and the highlights (`Trip.highlights`).
  const inBox = (q: { x: number; y: number }) => q.x >= box.x + 4 && q.x <= box.x + box.w - 4 && q.y >= box.y + 8 && q.y <= box.y + box.h - 4;
  // (this place first, then the start and the end, then the highlights; a name that is outside the frame, such as the far end of a flight home, or that would run over one already placed, is left out)
  // When the trip's first or last stop is outside the map (the map is framed on the stretch by land: the flight in and the flight home are left out), the map's own ends are named instead: the first and the last stop that are on it. Otherwise such a trip has no name on it at all.
  const onMap = trip.stopPoints.filter((q) => inBox(stopAt(q)));
  const candidates = [current, trip.stopPoints[0], trip.stopPoints[trip.stopPoints.length - 1], onMap[0], onMap[onMap.length - 1], ...trip.highlights.map((slug) => trip.stopPoints.find((q) => q.slug === slug)), ...[0.25, 0.5, 0.75, 0.375, 0.625].map((t) => onMap[Math.round(t * (onMap.length - 1))])]
    .filter((q): q is Trip["stopPoints"][number] => Boolean(q))
    .filter((q, i, all) => all.findIndex((o) => o.slug === q.slug) === i);
  const named: Array<{ s: Trip["stopPoints"][number]; x: number; y: number; end: boolean }> = [];
  const taken: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  // The code name and its tag are in the poster's foot: a label is never over them (it goes beside its stop on the other side, or below it, or is left out)
  const keepOut = word ? { x0: WORD_PAD - 2, x1: WORD_PAD + drawn + 4, y0: h - WORD_PAD - Math.round(size * 0.74) - 18, y1: h } : null;
  for (const q of candidates) {
    if (named.length >= MAX_LABELS) break;
    const at = stopAt(q);
    if (!inBox(at)) continue;
    const toEnd = at.x > w * 0.6;
    const width = q.name.length * 6.8;
    let placedLabel: { x: number; y: number; end: boolean; rect: { x0: number; x1: number; y0: number; y1: number } } | null = null;
    for (const [flipSide, below] of [[false, false], [false, true], [true, false], [true, true]] as const) {
      const end = flipSide ? !toEnd : toEnd;
      const x = end ? at.x - 9 : at.x + 9;
      const y = Math.max(12, below ? at.y + 17 : at.y - 7);
      const rect = { x0: end ? x - width : x, x1: end ? x : x + width, y0: y - 10, y1: y + 3 };
      const clash = taken.some((t) => rect.x0 < t.x1 + 4 && rect.x1 > t.x0 - 4 && rect.y0 < t.y1 && rect.y1 > t.y0);
      const onWord = keepOut !== null && rect.x0 < keepOut.x1 && rect.x1 > keepOut.x0 && rect.y0 < keepOut.y1 && rect.y1 > keepOut.y0;
      if (clash || onWord || rect.x0 < 2 || rect.x1 > w - 2) continue;
      placedLabel = { x, y, end, rect };
      break;
    }
    if (!placedLabel) continue;
    taken.push(placedLabel.rect);
    named.push({ s: q, x: placedLabel.x, y: placedLabel.y, end: placedLabel.end });
  }
  // The dots of the stops: on a trip with many, a dot is drawn only where it is `DOT_GAP` px from the ones already drawn (the start, the end, this place and the named ones always are), so the line is not lost under a string of dots.
  const dots = (() => {
    const must = new Set([current?.slug, trip.stopPoints[0]?.slug, trip.stopPoints[trip.stopPoints.length - 1]?.slug, ...named.map((n) => n.s.slug)]);
    const placed: Array<{ x: number; y: number }> = [];
    const keep = new Set<number>();
    trip.stopPoints.forEach((s, i) => {
      if (must.has(s.slug)) {
        keep.add(i);
        placed.push(stopAt(s));
      }
    });
    trip.stopPoints.forEach((s, i) => {
      if (keep.has(i)) return;
      const q = stopAt(s);
      if (placed.every((o) => Math.hypot(o.x - q.x, o.y - q.y) >= DOT_GAP)) {
        keep.add(i);
        placed.push(q);
      }
    });
    return keep;
  })();
  const tone = (share: number) => `color-mix(in srgb, var(--foreground) ${share}%, var(--accent))`;
  // The same ink on the field's colour with or without a photograph: the photograph is veiled in the FIELD's colour (light in the light theme, dark in the dark one), so it sits close to the card's background instead of standing out of it.
  // The word and its tag: in the poster's own drawing, or, when the photograph has a cutout (`layer`), in a drawing of their own under the cutout, so the subject stands in front of the word.
  const wordNodes = word ? (
    <>
      {/* (the word's width is measured on an invisible copy at the heaviest weight, the widest it gets: the visible one is thinner or heavier with the card's `--g`, see `.trip-slide` in app.css) */}
    <text ref={textRef} aria-hidden="true" x={0} y={-1000} fontSize={nominal} style={{ visibility: "hidden", fontFamily: wordFont, fontWeight: 800, letterSpacing: "-0.03em", ...(face.axis ? { fontStretch: `${face.axis.base}%` } : {}) }}>
      {word}
    </text>
    <text data-slot="trip-word" transform={`translate(${WORD_PAD - Math.round(size * 0.05)} ${h - WORD_PAD}) scale(${face.axis ? "1" : condense.toFixed(3)} 1)`} fontSize={size} style={{ ...(backdrop ? { fill: "var(--foreground)", opacity: "calc(0.12 + 0.4 * var(--g, 1) * var(--g, 1))" as unknown as number } : {}), ...(backdrop ? {} : { fill: `color-mix(in srgb, var(--foreground) calc(8% + 24% * var(--g, 1) * var(--g, 1)), var(--accent))` }), fontFamily: wordFont, letterSpacing: "-0.03em", ...(face.axis ? { fontStretch: `${(face.axis.base * condense).toFixed(1)}%` } : {}) }}>
      {word}
    </text>
    {/* (what the word is: the trip's code name, not the place's name; the poster's own small mono type, quiet and only on the card in front) */}
    <text data-slot="trip-word-tag" aria-hidden="true" x={WORD_PAD} y={h - WORD_PAD - Math.round(size * 0.74) - 9} fontSize={11} style={{ fill: "var(--foreground)", fontFamily: "var(--font-meta)", fontWeight: 500, letterSpacing: "0.14em", fillOpacity: "clamp(0, calc((var(--g, 1) - 0.4) * 1.1), 0.62)" as unknown as number }}>
      CODE NAME
    </text>
    </>
  ) : null;
  const halo = "var(--accent)";
  // The route, its stops and its names: over the subject on a poster with none, BEHIND it where there is a cutout (the map and the path are part of the backdrop: owner, 2026-11-24).
  const routeNodes = (
    <>
    {trip.legPaths.map((leg, i) => {
      const at = Array.from({ length: leg.points.length / 2 }, (_, k) => frame.at(leg.points[k * 2]!, leg.points[k * 2 + 1]!)).filter((q): q is { x: number; y: number } => q !== null);
      const pts = at.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ");
      // The globe's trail: along each leg, from its origin to its destination, one gradient from blue to violet, here washed toward the ink so the poster stays quiet (owner, 2026-11-24).
      const first = at[0];
      const last = at[at.length - 1];
      const graded = first !== undefined && last !== undefined && Math.hypot(last.x - first.x, last.y - first.y) > 2;
      return (
        <g key={i}>
          {graded && (
            <linearGradient id={`${maskId}-t${i}`} gradientUnits="userSpaceOnUse" x1={first.x} y1={first.y} x2={last.x} y2={last.y}>
              <stop offset={0} style={{ stopColor: TRAIL_TAIL }} />
              <stop offset={1} style={{ stopColor: TRAIL_HEAD }} />
            </linearGradient>
          )}
          <polyline points={pts} fill="none" stroke={graded ? `url(#${maskId}-t${i})` : MARK_INK} strokeOpacity={ROUTE_OPACITY} strokeWidth={backdrop ? 1.6 : 1.4} strokeDasharray={DASH[leg.mode]} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </g>
      );
    })}
    {trip.stopPoints.map((s, i) => {
      if (!dots.has(i)) return null;
      const q = stopAt(s);
      return <rect key={`${s.slug}-${i}`} x={q.x - 1.75} y={q.y - 1.75} width={3.5} height={3.5} fill={MARK_INK} />;
    })}
    {/* The names sit on a soft glow in the backdrop's colour (it darkens the picture in the dark scheme, lightens it in the light one) instead of an outline: readable over the route or a border, with no edge to it (owner, 2026-11-24). */}
    <radialGradient id={`${maskId}-glow`}>
      <stop offset={0} style={{ stopColor: halo, stopOpacity: 0.62 }} />
      <stop offset={0.5} style={{ stopColor: halo, stopOpacity: 0.4 }} />
      <stop offset={1} style={{ stopColor: halo, stopOpacity: 0 }} />
    </radialGradient>
    {named.map(({ s, x, y, end }) => {
      const width = s.name.length * 6.8;
      return <ellipse key={`${s.slug}-glow`} cx={end ? x - width / 2 : x + width / 2} cy={y - 3.5} rx={width / 2 + 18} ry={14} fill={`url(#${maskId}-glow)`} />;
    })}
    {named.map(({ s, x, y, end }) => (
      <text key={s.slug} x={x} y={y} textAnchor={end ? "end" : "start"} fontSize={10} style={{ fill: LABEL_INK, fontFamily: "var(--font-meta)", fontWeight: 600, letterSpacing: "0.04em" }}>
        {s.name.toUpperCase()}
      </text>
    ))}
    </>
  );
  return (
    <div ref={ref} data-slot="trip-poster-box" data-photo={backdrop ? "" : undefined} className={cn("relative w-full", backdrop ? "" : "bg-accent", className)} style={{ aspectRatio: `1 / ${ASPECT}`, maxHeight: MAX_H }}>
      {backdrop && (
        // The photograph runs on under the figures below the poster (`PHOTO_RUN`) and fades into the card's background there (`maskImage`), so it ends in no edge: its dynamic range
        // is held in a band the ink reads on in either theme (`TripPhotoFilters`), not dimmed by a veil. Where it has a horizon, the picture is placed so that the horizon is the seam
        // between the poster and the figures (the poster's bottom edge): sky and map above it, the ground under it.
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10" style={{ height: h + PHOTO_RUN, maskImage: fade(h), WebkitMaskImage: fade(h), opacity: photoOpacity, willChange: "transform" }}>
          <img
            {...coverImageProps(backdrop, `${w}px`)}
            alt=""
            decoding="async"
            onLoad={(e) => horizon.read(e.currentTarget)}
            ref={horizon.ref}
            className={cn("trip-photo", placed ? "absolute max-w-none" : "size-full object-cover")}
            style={placed ? { width: placed.width, height: placed.height, left: placed.left, top: placed.top, filter: softened("var(--trip-photo-filter)") } : undefined}
          />
        </div>
      )}
      {backdrop && (
        // The word is drawn between the photograph and its cutout (the subject in front of it): where there is no cutout, over the photograph as always, in the poster's own drawing.
        layer && (
          <>
            <svg aria-hidden="true" data-slot="trip-word-layer" width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="pointer-events-none absolute inset-x-0 top-0 block overflow-hidden">
              {wordNodes}
              {routeNodes}
            </svg>
            {/* (the cutout is placed and filtered exactly as the photograph, the same picture with its background made transparent; it is not faded, so it hides the word completely where it covers it) */}
            <div aria-hidden="true" data-slot="trip-cutout" className="pointer-events-none absolute inset-x-0 top-0" style={{ height: h + PHOTO_RUN, maskImage: layer.blend ? fade(h) : fadeAfter(h), WebkitMaskImage: layer.blend ? fade(h) : fadeAfter(h), willChange: "transform" }}>
              <img
                src={layer.src}
                alt=""
                decoding="async"
                className={cn("trip-subject", placed ? "absolute max-w-none" : "size-full object-cover")}
                style={placed ? { width: placed.width, height: placed.height, left: placed.left, top: placed.top, filter: softened("var(--trip-subject-filter)") } : undefined}
              />
            </div>
          </>
        )
      )}
      {backdrop && land && (
        // The land on a photograph runs as far as the photograph does and fades with it (the same mask), so the map is not cut at the poster's edge while the picture goes on.
        <svg aria-hidden="true" width={w} height={h + PHOTO_RUN} viewBox={`0 0 ${w} ${h + PHOTO_RUN}`} className="pointer-events-none absolute inset-x-0 top-0 block" style={{ maskImage: fade(h), WebkitMaskImage: fade(h) }}>
          {fadeDefs}
          {/* The borders are gaps in the land, not lines over it (owner, 2026-11-24): the land's mask is its fade (or whole) with the borders cut out of it, so the photograph shows through them, whatever the photograph is. */}
          <defs>
            {/* On a photograph the land is only round the route (owner, 2026-11-24: "we only need to see the continent around the road"): the mask is black, the route stroked white and blurred, so the land dissolves softly with the distance from the path; then the borders are cut out of it. A poster with no photograph keeps the land more widely (it has nothing else to show). */}
            <filter id={`${maskId}-f`} filterUnits="userSpaceOnUse" x={-near} y={-PHOTO_RUN - near} width={w + 2 * near} height={h + 2 * PHOTO_RUN + 2 * near}>
              <feGaussianBlur stdDeviation={0.13 * near} />
            </filter>
            <mask id={`${maskId}-l`} maskUnits="userSpaceOnUse" x={0} y={-PHOTO_RUN} width={w} height={h + 2 * PHOTO_RUN}>
              <rect x={0} y={-PHOTO_RUN} width={w} height={h + 2 * PHOTO_RUN} fill="#000" />
              <g filter={`url(#${maskId}-f)`} fill="none" stroke="#fff" strokeWidth={0.36 * near} strokeLinecap="round" strokeLinejoin="round">
                {legLines.map((pts, i) => (
                  <polyline key={i} points={pts} />
                ))}
              </g>
              {borderPath && <path d={borderPath} fill="none" stroke="#000" strokeWidth={BORDER_GAP} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            </mask>
          </defs>
          <path d={land} mask={`url(#${maskId}-l)`} className="trip-land" style={{ "--trip-land-dark-share": `${landShare}%` } as CSSProperties} stroke="none" />
        </svg>
      )}
      <svg data-slot="trip-poster" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`Map of the trip, ${trip.from} to ${trip.to}`} className="relative block overflow-hidden">
        {!backdrop && fadeDefs}
        {land && !backdrop && <path d={land} mask={landMask} style={{ fill: tone(9) }} stroke="none" />}
        {borderPath && !backdrop && <path d={borderPath} fill="none" stroke="var(--accent)" strokeWidth={1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        {!layer && wordNodes}
        {!layer && routeNodes}
      </svg>
    </div>
  );
}
