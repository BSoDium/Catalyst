import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "~/components/ui";
import { placeholderTiles } from "neon-activity-graph/layout";
import { activityStats, dayText, GITHUB_URL, hoursText, isActivity, layoutActivity, readableDay, WAKATIME_URL, yearContext, type Activity, type ActivityStat, type HoverInfo, type Matrix } from "~/lib/activity";
import { xmasNow } from "~/lib/xmas";

/** A source's colour as text, softened toward the page's own text colour (the figures and words are tinted, not painted). */
const soft = (tone: "green" | "blue", share = 62) => `color-mix(in srgb, var(${tone === "green" ? "--act-green" : "--act-blue"}) ${share}%, var(--foreground))`;
/** The profile links: a soft tint of the source's colour, no outline; the mark and the label take the same tone. */
const LINK = "group/link inline-flex items-baseline gap-1 underline decoration-transparent decoration-1 underline-offset-[0.2em] transition-[text-decoration-color] hover:decoration-current focus-visible:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

const ActivityScene = lazy(() => import("~/components/activity-scene").then((m) => ({ default: m.ActivityScene })));

const webgl2 = () => {
  try {
    // no scene for a visitor who asked to save data, nor where there is no WebGL 2: the flat grids stand in
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return false;
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
};

/** Whether the picture is meant to be there at all: the file's address is configured (production), or this is development (a snapshot). Known on the server too, so the room for it is in the prerendered page and nothing moves when it arrives. */
const enabledFor = (url: string | null) => import.meta.env.DEV || !!url;

/** The activity file: `url`'s in production, the snapshot in development (the branch does not exist until the workflow has run). `failed` when there is none after all: the panel then goes away. */
function useActivity(url: string | null): { activity: Activity | null; failed: boolean } {
  const [state, setState] = useState<{ activity: Activity | null; failed: boolean }>({ activity: null, failed: false });
  useEffect(() => {
    const ctl = new AbortController();
    (async () => {
      const raw = import.meta.env.DEV ? (await import("~/lib/activity.sample.json")).default : url ? await fetch(url, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : null)) : null;
      setState(isActivity(raw) ? { activity: raw, failed: false } : { activity: null, failed: true });
    })().catch(() => {
      if (!ctl.signal.aborted) setState({ activity: null, failed: true });
    });
    return () => ctl.abort();
  }, [url]);
  return state;
}

/** What stands in for the figures until the file is here: the same shapes, so the room is the same (hidden from sight and from screen readers). */
const WAITING_STATS: ActivityStat[] = [
  { value: "0,000", label: "contributions", tone: "plain" },
  { value: "0,000", unit: "h", label: "coded", tone: "plain" },
  { value: "00", unit: "days", label: "longest streak", tone: "plain" },
  { value: "00", unit: "%", label: "days active", tone: "plain" },
];

/** The picture's place-holder: the year's days as faint flat squares on the same slab, seen by the same camera as the scene (`placeholderTiles` of `neon-activity-graph`), pulsing, from the first paint and prerendered. The scene fades in over it, in place. */
function Waiting({ strips, aspect, className }: { strips: number; aspect: number; className: string }) {
  const { viewBox, d } = placeholderTiles(53, strips, aspect);
  return (
    <svg aria-hidden="true" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className={`absolute inset-0 size-full ${className}`}>
      <g className="motion-safe:animate-pulse">
        <path d={d} fill="var(--foreground)" opacity={0.06} />
      </g>
    </svg>
  );
}

/** The flat matrix of the same numbers (no WebGL): a grid of squares, weeks across, the intensity in the colour. */
function FlatMatrix({ matrix, tone }: { matrix: Matrix; tone: string }) {
  return (
    <div className="grid grid-flow-col grid-rows-7 gap-[2px]" style={{ gridTemplateColumns: `repeat(${matrix.weeks}, minmax(0, 1fr))` }}>
      {matrix.cells.map((c) => (
        <span key={c.date} title={c.date} className="aspect-square" style={{ background: c.value > 0 ? `color-mix(in srgb, ${tone} ${Math.round(18 + c.t * 82)}%, transparent)` : "color-mix(in srgb, var(--foreground) 7%, transparent)" }} />
      ))}
    </div>
  );
}

/** A value that rolls: when it changes, the old one slides out and blurs while the new one slides in from the other side (up when `order` rises, down when it falls). Both sit in one grid cell, so the width does not jump. */
function Roll({ value, order }: { value: string; order: number }) {
  const [s, setS] = useState({ now: value, nowOrder: order, prev: null as string | null, dir: "up" as "up" | "down" });
  useEffect(() => {
    if (value === s.now) return;
    setS({ now: value, nowOrder: order, prev: s.now, dir: order >= s.nowOrder ? "up" : "down" });
    const t = window.setTimeout(() => setS((x) => ({ ...x, prev: null })), 300);
    return () => window.clearTimeout(t);
    // (only a new value starts a roll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span className="inline-grid">
      <span key={s.now} className={s.prev !== null ? `act-in-${s.dir}` : undefined} style={{ gridArea: "1 / 1" }}>{s.now}</span>
      {s.prev !== null && <span key={`p${s.prev}`} aria-hidden="true" className={`act-out-${s.dir}`} style={{ gridArea: "1 / 1" }}>{s.prev}</span>}
    </span>
  );
}

/** The card's box in the picture's own pixels: it stays where it is put (`dockOf`), and only the connector moves with the pointer. */
export interface Dock {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const CARD_W = 240;

/**
 * Where the day card stands: fixed for the whole visit of the pointer (owner, 2026-11-23: the card stays put, the connector does the moving). On desktop it goes in the free room between the page's head and the figures grid at the top right
 * (its top level with the grid's, its right edge a gap short of it); where there is no such room (the figures sit at the left under 56 rem), over the picture's top right corner. Pure (CSS pixels).
 */
export function dockOf(scene: { width: number }, figures: { left: number; top: number } | null, h: number): Dock {
  const GAP = 24;
  if (figures && figures.left - GAP - CARD_W >= 16) return { x: figures.left - GAP - CARD_W, y: figures.top, w: CARD_W, h };
  return { x: Math.max(8, scene.width - CARD_W - 8), y: 8, w: CARD_W, h };
}

/**
 * The connector from the outline to the card, like the labels of a textbook's schematic (owner, 2026-11-23): it leaves the outline's PROTRUDING corner (the vertex furthest towards the card, so that it never reads as the continuation of
 * an edge of the outline: a tangent), runs 45 degrees towards the card, then flat into its side (or, with the card straight above, 45 degrees a little way and straight up to its foot). Dashed, in the outline's own stroke width and colour. Pure.
 */
export function callout(outline: string, dock: Dock): string {
  const pts = outline.split(" ").map((q) => q.split(",").map(Number) as [number, number]).filter((q) => q.length === 2 && Number.isFinite(q[0]) && Number.isFinite(q[1]));
  if (!pts.length) return "";
  const ay = dock.y + 24; // (the level of the card's date line)
  const centre = pts.reduce((m, q) => [m[0] + q[0] / pts.length, m[1] + q[1] / pts.length], [0, 0]);
  const toward = (side: number, v: number) => pts.reduce((m, q) => (side * q[0] + v * q[1] > side * m[0] + v * m[1] ? q : m));
  if (centre[0] < dock.x || centre[0] > dock.x + dock.w) {
    const side = centre[0] < dock.x ? 1 : -1;
    const v = ay < centre[1] ? -1 : 1;
    const [px, py] = toward(side, v);
    const ax = side === 1 ? dock.x : dock.x + dock.w;
    const D = Math.abs(ax - px);
    const V = Math.abs(ay - py);
    if (D >= V) return `M${px} ${py}L${px + side * V} ${ay}L${ax} ${ay}`;
    return `M${px} ${py}L${px} ${py + v * (V - D)}L${ax} ${ay}`;
  }
  // the card is straight above (or below) the column: 45 degrees a little way towards the middle of the card, then straight to its foot
  const side = centre[0] < dock.x + dock.w / 2 ? 1 : -1;
  const v = dock.y + dock.h < centre[1] ? -1 : 1;
  const [px, py] = toward(side, v);
  const foot = v === -1 ? dock.y + dock.h : dock.y;
  const d = Math.min(16, Math.abs(py - foot));
  return `M${px} ${py}L${px + side * d} ${py + v * d}L${px + side * d} ${foot}`;
}

/**
 * The card of a day (the "datasheet", owner-approved direction B of the 2026-11-23 audit): a solid surface with one hairline, square, no blur and no shadow. It reads like the column it hangs on: the date as its title, the contributions (green) above
 * the coding (blue), each with a swatch of its colour, the value at full strength and a 1 px rule showing the day against the year's best; a note appears only for a notable day, and the key cap for stacked days. It does not move with the pointer
 * (`dockOf`: the connector, drawn with the outline, does); it fades when the pointer leaves and the numbers roll as the day changes. Phones have no card: the legend says the day (`ActivityPanel`).
 */
function DayCard({ info, ctx, visible, dock, onHeight, touch }: { info: HoverInfo; ctx: ReturnType<typeof yearContext> | null; visible: boolean; dock: Dock; onHeight: (h: number) => void; touch: boolean }) {
  const card = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    onHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);
  const hours = hoursText(info.hours);
  const empty = info.contributions === 0 && !hours;
  const k = ctx?.(info.contributions, info.hours) ?? { c: 0, h: 0, note: null };
  const [weekday = "", day = "", month = "", year = ""] = readableDay(info.date).split(" ");
  const order = Date.parse(`${info.date}T00:00:00Z`);
  const stacked = info.behind && info.behind.count > 1;
  return (
    <div role="presentation" className="pointer-events-none absolute top-0 left-0 z-20 h-0 w-0" style={{ opacity: visible ? 1 : 0, transition: "opacity 0.12s var(--ease-standard)" }}>
      <div ref={card} className="act-card" style={{ left: dock.x, top: dock.y }}>
        <header className="act-card-head">
          <span className="act-card-date"><Roll value={`${day} ${month}`} order={order} /></span>
          <span className="type-meta text-muted-foreground uppercase"><Roll value={`${weekday} · ${year}`} order={order} /></span>
        </header>
        {empty ? (
          <p className="act-card-empty type-meta m-0 text-muted-foreground uppercase">No activity</p>
        ) : (
          <dl className="act-card-rows">
            <div className="act-card-row" data-tone="green">
              <span aria-hidden="true" className="act-card-swatch" />
              <dt className="type-meta text-muted-foreground uppercase">{info.contributions === 1 ? "contribution" : "contributions"}</dt>
              <dd className="act-card-value">
                <Roll value={info.contributions ? String(info.contributions) : "—"} order={info.contributions} />
              </dd>
              <span aria-hidden="true" className="act-card-meter" style={{ "--share": k.c } as React.CSSProperties} />
            </div>
            <div className="act-card-row" data-tone="blue">
              <span aria-hidden="true" className="act-card-swatch" />
              <dt className="type-meta text-muted-foreground uppercase">coded</dt>
              <dd className="act-card-value">
                <Roll value={hours ?? "—"} order={info.hours} />
              </dd>
              <span aria-hidden="true" className="act-card-meter" style={{ "--share": k.h } as React.CSSProperties} />
            </div>
          </dl>
        )}
        {(k.note || stacked) && (
          <footer className="act-card-foot type-meta uppercase">
            {k.note && <span style={{ color: "var(--signal-text)" }}>{k.note}</span>}
            {stacked && info.behind && (
              <span className="ml-auto text-muted-foreground">
                {info.behind.index + 1}/{info.behind.count} <kbd className="ds-micro">{touch ? "Tap" : "Click"}</kbd>
              </span>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

/**
 * The figures, in two tiers: the three that matter set large (the page's count, the contributions, the hours coded) and the rest small beneath (the first year, the places, the longest run, the share of active days). The page's own
 * (`lead`: its count, then the rest) are only drawn from 80 rem, where this block takes the head's place; below that the head shows them. The year's wait for the file (they fade in); the page's are there at once.
 */
function Figures({ lead, stats, ready = true, className }: { lead: { value: string; label: string }[]; stats: ActivityStat[]; ready?: boolean; className?: string }) {
  interface Fig {
    key: string;
    value: string;
    label: string;
    unit?: string;
    tone: ActivityStat["tone"];
    own: boolean;
  }
  const own = (l: { value: string; label: string }): Fig => ({ key: `lead-${l.label}`, value: l.value, label: l.label, tone: "plain", own: true });
  const theirs = (st: ActivityStat): Fig => ({ key: st.label, value: st.value, label: st.label, unit: st.unit, tone: st.tone, own: false });
  const primary = [...lead.slice(0, 1).map(own), ...stats.slice(0, 2).map(theirs)];
  const secondary = [...lead.slice(1).map(own), ...stats.slice(2).map(theirs)];
  const cell = (f: Fig, big: boolean) => (
    <div key={f.key} className={`group/cell max-md:last:items-end max-md:last:text-right transition-opacity duration-500 flex flex-col ${big ? "gap-1.5" : "gap-1"} md:items-end ${big ? "md:max-[56rem]:items-start" : ""} ${f.own ? "hidden md:flex" : ""}`}>
      {/* (the year's figures are in their places from the first frame, as faint stand-ins: nothing is missing, and nothing moves when the file arrives) */}
      <dd className={`m-0 flex items-baseline gap-1 transition-opacity duration-500 max-md:group-last/cell:justify-end md:justify-end ${big ? "md:max-[56rem]:justify-start" : ""} ${!f.own && !ready ? "opacity-[0.16]" : ""}`} style={{ color: f.tone === "plain" ? undefined : soft(f.tone, 75) }}>
        <span className={`font-[family-name:var(--font-display)] leading-none font-medium tracking-[-0.03em] tabular-nums ${big ? "text-[1.75rem] md:text-[clamp(1.2rem,2.8cqi,2.75rem)]" : "text-[1.25rem]"}`}>{f.value}</span>
        {f.unit && <span className="type-meta font-normal text-muted-foreground normal-case">{f.unit}</span>}
      </dd>
      <dt className={`type-meta text-muted-foreground uppercase md:max-[56rem]:whitespace-nowrap md:text-right ${big ? "md:max-[56rem]:text-left" : ""}`}>{f.label}</dt>
    </div>
  );
  return (
    <div data-slot="activity-stats" aria-hidden={ready ? undefined : true} className={`flex flex-col gap-5 px-4 pt-6 md:w-max md:gap-4 md:p-0 md:max-[56rem]:w-auto md:max-[56rem]:flex-row md:max-[56rem]:justify-between md:max-[56rem]:gap-x-6 ${className ?? ""}`}>
      <dl className="m-0 flex flex-wrap justify-between gap-x-[clamp(2rem,5cqi,4.5rem)] gap-y-4 md:gap-x-[clamp(1.25rem,5cqi,4.5rem)] md:flex-nowrap md:justify-between md:max-[56rem]:gap-x-[clamp(1.25rem,3.4cqi,2.5rem)]">{primary.map((f) => cell(f, true))}</dl>
      <dl className="m-0 flex flex-wrap justify-between gap-x-6 gap-y-2 md:flex-nowrap md:justify-between md:max-[56rem]:gap-x-[clamp(1.25rem,3.4cqi,2.5rem)]">{secondary.map((f) => cell(f, false))}</dl>
    </div>
  );
}

/**
 * The software page's picture of the year: GitHub contributions and WakaTime coding time, a block a day (`ActivityScene`, a still isometric scene built up over a few dozen frames). Client-only: the file is fetched when the page
 * opens, the scene (three.js) loads only when the panel scrolls into view, and the room is held (an aspect ratio) so nothing moves when it arrives. Without WebGL the same numbers are two flat grids.
 */
export function ActivityPanel({ url, lead = [] }: { url: string | null; lead?: { value: string; label: string }[] }) {
  const { activity, failed } = useActivity(url);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  // the last day shown stays mounted (the card fades and glides instead of vanishing); a card that comes back from nothing appears in place
  const lastHover = useRef<HoverInfo | null>(null);
  const wasShown = useRef(false);
  if (hover) lastHover.current = hover;
  const instant = !!hover && !wasShown.current;
  useEffect(() => {
    wasShown.current = !!hover;
  }, [hover]);
  const sceneBox = useRef<HTMLDivElement>(null);
  // (the day card against the year, and whether the last press was a finger: the key cap says Tap then)
  const ctx = useMemo(() => (activity ? yearContext(activity) : null), [activity]);
  const [touch, setTouch] = useState(false);
  const [cardH, setCardH] = useState(124);
  const [figures, setFigures] = useState<{ left: number; top: number } | null>(null);
  const [sceneW, setSceneW] = useState(0);
  const box = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  const [gl, setGl] = useState(true);
  // a narrow page gets the year in four strips (a squarer slab) instead of one long one
  const [narrow, setNarrow] = useState(false);
  // `?xmas`, an Easter egg (a demo, not on by default): a greeting joins the legend (read after the first paint, so that the page's first render is the same everywhere)
  const [xmas, setXmas] = useState(false);
  // (the dark theme only: it follows the page's scheme, forced by `data-scheme` or the system's)
  const [dark, setDark] = useState(false);
  // (the neon start-up is over: the greeting comes once all the lights are on)
  const [lit, setLit] = useState(false);
  // the greeting's baseline is set on the legend's last line ("WakaTime activity below."): measured with zero-size probes on the two baselines, at every width and whenever the layout or the font changes
  const greeting = useRef<HTMLSpanElement>(null);
  const legend = useRef<HTMLParagraphElement>(null);
  const [drop, setDrop] = useState(0);
  const show = xmas && dark;
  // (the legend is in the picture's corner from 56 rem; below that it is under the picture, or half over its corner, and the greeting is not set on its baseline: it sits in its own corner, on two lines)
  const [corner, setCorner] = useState(false);
  // below 56 rem the greeting sits beside the legend, on the right of its lines, when there is room there (`side`: it is moved down to the legend's last line); else in the picture's corner
  const [side, setSide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 56rem)");
    const read = () => setCorner(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);
  useEffect(() => {
    const g = greeting.current;
    const l = legend.current;
    if (!show || !g || !l) return;
    const baseline = (el: HTMLElement) => {
      const probe = document.createElement("span");
      probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
      el.appendChild(probe);
      const y = probe.getBoundingClientRect().bottom;
      probe.remove();
      return y;
    };
    const measure = () => {
      // (the script's letters do not rest on the font's declared baseline: the ink's own is found with the bottom of letters that sit on it, "rsc", measured on a canvas)
      const cs = getComputedStyle(g);
      const m2 = document.createElement("canvas").getContext("2d");
      let ink = 0;
      if (m2) {
        m2.font = `${cs.fontSize} ${cs.fontFamily}`;
        ink = m2.measureText("rsc").actualBoundingBoxDescent;
      }
      // (absolute, so that two measures in a frame agree: the greeting's baseline without the shift it has now, then the shift that puts it on the legend's)
      const applied = g.parentElement ? new DOMMatrix(getComputedStyle(g.parentElement).transform).m42 : 0;
      const target = baseline(l) - (baseline(g) - applied + ink);
      if (!Number.isFinite(target)) return;
      if (corner) {
        setSide(false);
        setDrop((d) => (Math.abs(target - d) < 0.5 ? d : target));
        return;
      }
      // below 56 rem: beside the legend if the lines it would stand next to end far enough to the left of the greeting; the corner otherwise
      const gr = g.getBoundingClientRect();
      const top = gr.top - applied + target;
      const bottom = gr.bottom - applied + target;
      const range = document.createRange();
      range.selectNodeContents(l);
      let right = 0;
      for (const r of Array.from(range.getClientRects())) if (r.bottom > top && r.top < bottom && r.width > 0) right = Math.max(right, r.right);
      const room = box.current ? box.current.getBoundingClientRect().width * 0.02 : 8;
      const fits = right > 0 && target > 0 && right + 14 + room <= gr.right - gr.width;
      setSide(fits);
      const want = fits ? target : 0;
      setDrop((d) => (Math.abs(want - d) < 0.5 ? d : want));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(l);
    if (box.current) ro.observe(box.current);
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      ro.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [show, corner]);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => {
      const forced = document.documentElement.getAttribute("data-scheme");
      setDark(forced ? forced === "dark" : mq.matches);
    };
    read();
    mq.addEventListener("change", read);
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scheme"] });
    return () => {
      mq.removeEventListener("change", read);
      mo.disconnect();
    };
  }, []);
  useEffect(() => {
    setGl(webgl2());
    if (xmasNow()) {
      // (the globe's calligraphy: not in the stylesheet, so that no page pays for it; the greeting loads it here, and only then shows)
      const face = new FontFace("Imperial Script", "url(/fonts/imperial-script-1.010-latin-400.woff2)", { display: "swap" });
      face.load().then(
        () => {
          document.fonts.add(face);
          setXmas(true);
        },
        () => setXmas(true),
      );
    }
    const mq = window.matchMedia("(max-width: 47.99rem)");
    setNarrow(mq.matches);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    const el = box.current;
    if (!el || !("IntersectionObserver" in window)) return setSeen(true);
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && (setSeen(true), io.disconnect()), { rootMargin: "200px" });
    io.observe(el);
    return () => {
      io.disconnect();
      mq.removeEventListener("change", onChange);
    };
  }, []);
  // where the figures' grid is, from the picture's own corner, and how wide the picture is: the card's place (`dockOf`) follows them
  useEffect(() => {
    const scene = sceneBox.current;
    const root = box.current;
    if (!scene || !root) return;
    const measure = () => {
      const r = scene.getBoundingClientRect();
      const f = root.querySelector<HTMLElement>('[data-slot="activity-stats"]');
      const fr = f && getComputedStyle(f).position === "absolute" ? f.getBoundingClientRect() : null;
      setSceneW(r.width);
      setFigures(fr && fr.width > 0 ? { left: fr.left - r.left, top: fr.top - r.top } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scene);
    ro.observe(root);
    return () => ro.disconnect();
  }, [seen, gl, activity, narrow]);
  const dock = dockOf({ width: sceneW }, figures, cardH);
  if (!enabledFor(url)) return null;
  // (the file is not there after all: the picture goes away, and the page's own figures, which the head hid for the grid, are shown on their own)
  if (failed) return lead.length ? <Figures lead={lead} stats={[]} className="hidden md:grid md:absolute md:top-0 md:right-14" /> : null;
  const flat = !gl && activity ? layoutActivity(activity) : null;
  const stats = activity ? activityStats(activity) : WAITING_STATS;
  // The tilt of the scene leaves its top-right and bottom-left corners empty: the figures take the first and the legend the second (on a narrow page there is no corner, they go under the picture).
  return (
    <section ref={box} data-slot="activity" aria-label="Activity over the last year" className="relative -mx-4 mt-0 mb-2 [overflow-x:clip] max-md:flex max-md:flex-col md:-mx-14 md:mb-4 min-[90rem]:-mb-4">
      {flat ? (
        <div role="img" aria-label="Activity over the last year: GitHub contributions and WakaTime coding time, a square a day" className="flex flex-col gap-4 px-4 md:px-14">
          <FlatMatrix matrix={flat.wakatime} tone="#0078d7" />
          <FlatMatrix matrix={flat.github} tone="#0fbf3e" />
        </div>
      ) : (
        <div ref={sceneBox} onPointerDownCapture={(e) => setTouch(e.pointerType === "touch")} className="group/scene relative aspect-[3.97/1] w-full max-md:-mt-[6cqi] max-md:aspect-[0.95/1]">
          <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-0" : ""}`}>
            <Waiting strips={1} aspect={3.97} className="max-md:hidden" />
            <Waiting strips={4} aspect={0.95} className="hidden max-md:block" />
          </div>
          {seen && activity && (
            <Suspense fallback={null}>
              <ActivityScene activity={activity} strips={narrow ? 4 : 1} onReady={() => setReady(true)} onLit={setLit} onHover={setHover} className="absolute inset-0 outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-[var(--ring)]" />
            </Suspense>
          )}
          {show && (
            <div aria-hidden="true" className="pointer-events-none absolute right-0 bottom-0 z-10 flex items-end justify-end px-[3cqi] pt-[16cqi] min-[56rem]:pt-[9cqi] min-[56rem]:pl-[16cqi] opacity-100 transition-opacity duration-1000 group-hover/scene:opacity-0" style={{ opacity: lit ? undefined : 0, transform: `translateY(${drop}px)`, paddingLeft: corner ? undefined : side ? "2cqi" : "26cqi" }}>
              {/* (the backdrop reaches down past the shifted text, to the picture's own bottom edge, so that no glow shows under it) */}
              <span className="absolute inset-x-0 top-0" style={{ bottom: corner ? `${-(Math.max(0, -drop) + 12)}px` : 0, background: "radial-gradient(ellipse 100% 100% at 100% 100%, color-mix(in oklab, var(--background) 68%, transparent) 0%, color-mix(in oklab, var(--background) 64%, transparent) 20%, color-mix(in oklab, var(--background) 50%, transparent) 42%, color-mix(in oklab, var(--background) 30%, transparent) 62%, color-mix(in oklab, var(--background) 12%, transparent) 80%, color-mix(in oklab, var(--background) 3%, transparent) 92%, transparent 100%)" }} />
              <span ref={greeting} className="relative text-right text-[clamp(2.75rem,13cqi,4.25rem)] leading-[0.95] min-[56rem]:text-[clamp(2.25rem,6cqi,4.25rem)] min-[56rem]:leading-none" style={{ fontFamily: '"Imperial Script", "Snell Roundhand", "Apple Chancery", cursive', color: "#fff", WebkitTextStroke: "0.6px #fff", textShadow: "0 0 0.12em var(--background), 0 0 0.3em var(--background), 0 0 0.6em rgb(255 60 60 / 0.45)" }}>
                Merry<br className="min-[56rem]:hidden" /> Christmas
              </span>
            </div>
          )}
          {lastHover.current && (
            <>
              <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible" style={{ opacity: hover ? 1 : 0, transition: instant ? "none" : "opacity 0.12s" }}>
                {(() => {
                  const d = `M${lastHover.current.outline.split(" ").join("L")}Z`.replaceAll(",", " ");
                  return (
                    <>
                      <path d={d} fill="color-mix(in srgb, var(--foreground) 7%, transparent)" stroke="var(--foreground)" strokeWidth={1.5} strokeLinejoin="round" />
                      {!narrow && <path d={callout(lastHover.current.outline, dock)} fill="none" stroke="var(--foreground)" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="butt" />}
                    </>
                  );
                })()}
              </svg>
              {!narrow && <DayCard info={lastHover.current} ctx={ctx} visible={!!hover} dock={dock} onHeight={setCardH} touch={touch} />}
            </>
          )}
          <p className="sr-only" aria-live="polite">{hover ? dayText(hover) : ""}</p>
        </div>
      )}
      {/* The corners are only empty when the scene is big enough (from 80 rem of page): below that the figures and the legend sit under the picture, so the text never lies over the blocks. From there the page's own figures (software, places) join the year's
          in ONE grid at the top right, from the head's top down into the empty corner of the picture. */}
      <Figures lead={lead} stats={stats} ready={!!activity} className="max-md:relative max-md:z-10 max-md:order-first max-md:pb-2 md:pointer-events-none md:absolute md:right-14 md:max-[56rem]:left-14 md:top-[calc(-1*clamp(2.5rem,6.4cqi,5.75rem)-0.25rem)]" />
      <div data-slot="activity-legend" className="relative flex flex-col gap-3 px-4 pt-3 md:pt-6 md:px-14 md:max-[56rem]:-mt-[6.5cqi] min-[56rem]:absolute min-[56rem]:bottom-[1%] min-[80rem]:bottom-[10.7%] min-[56rem]:left-14 min-[56rem]:w-[clamp(20rem,34cqi,25rem)] min-[56rem]:p-0">
        {/* On a phone the legend is where the day is read (no card over the picture): the two layers share one cell, the day's over the legend while a day is held. */}
        <div className="grid">
          <div className="flex flex-col gap-3 transition-opacity duration-150" style={{ gridArea: "1 / 1", opacity: narrow && hover ? 0 : 1 }}>
          <p className="type-meta m-0 text-muted-foreground uppercase">Last <span className="text-foreground">12 months</span></p>
          {/* In the picture's order: the contributions are the upper block of a day, the coding the lower one. */}
          <p ref={legend} className="m-0 font-[family-name:var(--font-display)] text-[1.625rem] min-[56rem]:text-[clamp(1.25rem,2.3cqi,1.625rem)] leading-[1.1] font-semibold tracking-tight text-balance">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={LINK} style={{ color: soft("green", 75) }}>
              GitHub contributions
              <Icon name="arrow-up-right" size="inline" aria-hidden="true" className="translate-y-[0.05em] self-center opacity-70 transition-opacity group-hover/link:opacity-100" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>{" "}
            above,
            <br className="hidden md:inline" />{" "}
            <a href={WAKATIME_URL} target="_blank" rel="noopener noreferrer" className={LINK} style={{ color: soft("blue", 75) }}>
              WakaTime activity
              <Icon name="arrow-up-right" size="inline" aria-hidden="true" className="translate-y-[0.05em] self-center opacity-70 transition-opacity group-hover/link:opacity-100" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>{" "}
            below.
          </p>
          </div>
          {narrow && lastHover.current && (
            <div aria-hidden="true" className="pointer-events-none flex flex-col gap-3 transition-opacity duration-150" style={{ gridArea: "1 / 1", opacity: hover ? 1 : 0 }}>
              <p className="type-meta m-0 flex gap-[0.6em] uppercase">
                {(() => {
                  const [weekday = "", day = "", month = "", year = ""] = readableDay(lastHover.current.date).split(" ");
                  return (
                    <>
                      <span className="text-foreground">{day} {month}</span>
                      <span className="text-muted-foreground">{weekday} · {year}</span>
                    </>
                  );
                })()}
              </p>
              <p className="m-0 font-[family-name:var(--font-display)] text-[1.625rem] leading-[1.1] font-semibold tracking-tight tabular-nums">
                <span style={{ color: "var(--act-green)" }}>{lastHover.current.contributions || "No"} {lastHover.current.contributions === 1 ? "contribution" : "contributions"}</span> on GitHub,
                <br />
                <span style={{ color: "var(--act-blue)" }}>{hoursText(lastHover.current.hours) ?? "No coding"}</span> {hoursText(lastHover.current.hours) ? "logged " : ""}on WakaTime.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
