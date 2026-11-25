import { lazy, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "~/components/ui";
import { placeholderTiles } from "neon-activity-graph/layout";
import { NeonAttribution } from "neon-activity-graph/react";
import { bounds, CARD_W, grow, overlaps, parseOutline, plan, route, type Rect } from "~/lib/day-card-plan";
import { activityStats, agoText, dayText, GITHUB_URL, hoursText, isActivity, layoutActivity, readableDay, WAKATIME_URL, yearContext, type Activity, type ActivityStat, type DayNote, type HoverInfo, type Matrix } from "~/lib/activity";
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

/**
 * A number that rolls digit by digit, aligned on its last digit (owner, 2026-11-24): only the digits that change roll, and a digit that goes (the leftmost ones: 12 to 9) rolls out in place, so the digits that stay never move.
 * The figures sit at the right of their row, so when the leftmost digit's cell goes at the end of the roll the others stay where they are.
 */
function RollNum({ value, order }: { value: string; order: number }) {
  const [s, setS] = useState({ now: value, nowOrder: order, prev: null as string | null, dir: "up" as "up" | "down" });
  useEffect(() => {
    if (value === s.now) return;
    setS({ now: value, nowOrder: order, prev: s.now, dir: order >= s.nowOrder ? "up" : "down" });
    const t = window.setTimeout(() => setS((x) => ({ ...x, prev: null })), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const { now, prev, dir } = s;
  const n = Math.max(now.length, prev?.length ?? 0);
  return (
    <span className="inline-flex">
      {Array.from({ length: n }, (_, i) => {
        const fromRight = n - 1 - i;
        const a = now[now.length - 1 - fromRight];
        const b = prev === null ? undefined : prev[prev.length - 1 - fromRight];
        if (prev === null || a === b) return <span key={fromRight}>{a}</span>;
        return (
          <span key={fromRight} className="inline-grid">
            {a !== undefined && <span key={a} className={`act-in-${dir}`} style={{ gridArea: "1 / 1" }}>{a}</span>}
            {b !== undefined && <span key={`p${b}`} aria-hidden="true" className={`act-out-${dir}`} style={{ gridArea: "1 / 1" }}>{b}</span>}
          </span>
        );
      })}
    </span>
  );
}

/**
 * The day card's face (owner, 2026-11-23; docs/activity-picture.md, "The day card"): the page's surface, one hairline, square, no shadow, no blur, compact. The date is its title, the weekday and the year quiet metadata under it; when several days lie under
 * the pointer, one pip per day in the top right corner (this one filled) over "Click for next day" ("Tap" after a touch); the contributions above the coding, as in the column, each a swatch the height of the label's capitals sat on its baseline, the label, and the figure in the source's colour over a
 * soft wash of it; one footer line, ALWAYS there (the card's height never changes, so the placement and the connector never jump): the note of a notable day, else "No activity", else how long ago the day was.
 */
export function DayCard({ info, note, touch, now, cardRef }: { info: Pick<HoverInfo, "date" | "contributions" | "hours" | "behind">; note: DayNote | null; touch: boolean; now?: number; cardRef?: React.Ref<HTMLDivElement> }) {
  const hours = hoursText(info.hours);
  const empty = info.contributions === 0 && !hours;
  const [weekday = "", day = "", month = "", year = ""] = readableDay(info.date).split(" ");
  const order = Date.parse(`${info.date}T00:00:00Z`);
  const stacked = !!info.behind && info.behind.count > 1;
  const [figure = "", unit = ""] = hours?.split(" ") ?? [];
  return (
    <div ref={cardRef} className="act-card" data-empty={empty || undefined}>
      <header className="act-card-head">
        <span className="act-card-date"><Roll value={`${day} ${month}`} order={order} /></span>
        <span className="act-card-day type-meta"><Roll value={`${weekday} · ${year}`} order={order} /></span>
        {stacked && info.behind && (
          <>
            {/* the days lying one behind another under the pointer, one pip each, this one filled (a count past ten: "3/14") */}
            <span className="act-card-pips" aria-hidden="true" title={`Day ${info.behind.index + 1} of ${info.behind.count} here`}>
              {info.behind.count <= 10 ? Array.from({ length: info.behind.count }, (_, i) => <span key={i} data-on={i === info.behind!.index || undefined} />) : <span className="type-meta">{info.behind.index + 1}/{info.behind.count}</span>}
            </span>
            <span className="act-card-next">
              <kbd className="act-card-key">{touch ? "Tap" : "Click"}</kbd> for next day
            </span>
          </>
        )}
      </header>
      <dl className="act-card-rows">
        <div className="act-card-row" data-tone="green" data-none={!info.contributions || undefined}>
          <dt className="act-card-label type-meta"><span aria-hidden="true" className="act-card-swatch" />{info.contributions === 1 ? "contribution" : "contributions"}</dt>
          <dd className="act-card-value">
            <RollNum value={info.contributions ? String(info.contributions) : "—"} order={info.contributions} />
          </dd>
        </div>
        <div className="act-card-row" data-tone="blue" data-none={!hours || undefined}>
          <dt className="act-card-label type-meta"><span aria-hidden="true" className="act-card-swatch" />coded</dt>
          <dd className="act-card-value">
            <RollNum value={figure || "—"} order={info.hours} />
            {unit && <span className="act-card-unit"><Roll value={unit} order={info.hours} /></span>}
          </dd>
        </div>
      </dl>
      <footer className="act-card-foot" data-note={note ? "" : undefined} data-tone={note?.tone}>
        {note && <NoteIcon record={note.record} />}
        <Roll value={note?.text ?? (empty ? "No activity" : agoText(info.date, now ?? Date.now()))} order={order} />
      </footer>
      {/* where the connector joins the card, the edge takes the connector's colour and gives it back along the edge (position set by HoverLayer) */}
      <span aria-hidden="true" className="act-card-edge" />
    </div>
  );
}

/** The mark of an achievement: a crown for a record (the best day), an arrow rising past a bar for a top 5 %. */
function NoteIcon({ record }: { record: boolean }) {
  return (
    <svg aria-hidden="true" className="act-card-note-icon" viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      {record ? <path d="M2 11.5h10M2.5 10 1.75 4.5l3.25 2.5L7 2.75 9 7l3.25-2.5L11.5 10z" /> : <path d="M2 12V8.5M6 12V6M10 12V3.5M2.5 5.5 7 1.75l1 .9" />}
    </svg>
  );
}

/** The outline, the connector and the card fade at one rate (`onDay` and `shown` change together except while the pointer is busy): there is never a connector without its outline. */
const FADE = "opacity 0.12s var(--ease-standard)";
/** Too many days in too short a time (a pointer sweeping across the picture): the connector and the card fade away until it slows down, instead of flickering over every column. */
const BUSY_CHANGES = 8;
const BUSY_WINDOW_MS = 400;
/** ... and they must also span this much of the picture (the extent of the days' places, CSS px): a pointer working a small area, even back and forth over many columns, is not sweeping. */
const BUSY_SPAN_PX = 420;
const CALM_MS = 220;
/** How long the pointer can be off the picture before the next day is a new visit (the card then appears in place). */
const FRESH_MS = 700;

/**
 * What the pointer is on: the outline of the day's column, the card, and the connector between them (owner, 2026-11-23). The card (the "datasheet", direction B of the audit: a solid surface, one hairline, no blur, no shadow; the date as its
 * title, the contributions above the coding, each with a swatch and its value over a wash of its colour; one footer line always there, the note of a notable day; the key cap for stacked days: `DayCard`) stays CLOSE to its column but not on it
 * (`plan`, lib/day-card-plan.ts: above it, or at 45 degrees to a side, clear of the page's figures) and glides to its place SLOWLY, so that a sweeping pointer does not drag it along; the connector (a gradient line, from the outline's colour to the card's edge colour), from the outline's edge or
 * protruding corner to the card where it is now, is what moves. A card that the glide leaves over the selected column glides out of its way faster (never a jump). Phones have no card: the legend says the day (`ActivityPanel`).
 */
function HoverLayer({ info, onDay, shown, instant, ctx, touch, view, figures, withCard }: { info: HoverInfo; onDay: boolean; shown: boolean; instant: boolean; ctx: ReturnType<typeof yearContext> | null; touch: boolean; view: { width: number; height: number }; figures: Rect | null; withCard: boolean }) {
  const card = useRef<HTMLDivElement>(null);
  const link = useRef<SVGPathElement>(null);
  const linkHalo = useRef<SVGPathElement>(null);
  const haloGrad = useRef<SVGLinearGradientElement>(null);
  const grad = useRef<SVGLinearGradientElement>(null);
  const uid = useId().replaceAll(":", "");
  const gid = `act-link-${uid}`;
  const mid = `act-mask-${uid}`;
  const cur = useRef({ x: 0, y: 0, init: false, key: "" });
  const note = ctx?.(info.contributions, info.hours) ?? null;
  // (whether the card was showing at the last commit: a card that comes back from hidden (a sweep that has settled, the pointer back from empty ground) is put in its place at once, with no glide to give it an inertia as it appears)
  const wasShown = useRef(false);
  useEffect(() => {
    wasShown.current = shown;
  });
  useLayoutEffect(() => {
    const el = card.current;
    const path = link.current;
    if (!withCard || !el || !path) return;
    const h = el.offsetHeight || 124;
    const p = plan(info.outline, view, figures, h, cur.current.key);
    if (!p) return;
    const c = cur.current;
    c.key = p.key;
    const column = grow(bounds(parseOutline(info.outline)), 10);
    const draw = () => {
      el.style.transform = `translate3d(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px, 0)`;
      const d = route(p.mode, p.from, { x: c.x, y: c.y, w: CARD_W, h });
      path.setAttribute("d", d);
      linkHalo.current?.setAttribute("d", d);
      // (the connector's gradient runs from where it leaves the outline to where it reaches the card)
      const nums = d.replace(/[ML]/g, " ").trim().split(/\s+/).map(Number);
      if (nums.length >= 4) {
        for (const g of [grad.current, haloGrad.current]) {
          g?.setAttribute("x1", String(nums[0]));
          g?.setAttribute("y1", String(nums[1]));
          g?.setAttribute("x2", String(nums[nums.length - 2]));
          g?.setAttribute("y2", String(nums[nums.length - 1]));
        }
      }
      // (the connector's end, on the card's edge, in the card's own coordinates)
      const end = d.split("L").pop()?.split(" ").map(Number);
      if (end && end.length === 2) {
        el.style.setProperty("--ax", `${(end[0]! - c.x).toFixed(1)}px`);
        el.style.setProperty("--ay", `${(end[1]! - c.y).toFixed(1)}px`);
      }
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (instant || !c.init || reduced || !wasShown.current) {
      c.x = p.x;
      c.y = p.y;
      c.init = true;
      draw();
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // (slow, but twice as quick while the card still lies over the selected column: it gets out of the way without a jump)
      const f = 1 - Math.exp(-Math.min(64, now - last) / (overlaps({ x: c.x, y: c.y, w: CARD_W, h }, column) ? 160 : 320));
      last = now;
      c.x += (p.x - c.x) * f;
      c.y += (p.y - c.y) * f;
      if (Math.abs(p.x - c.x) + Math.abs(p.y - c.y) > 0.25) raf = requestAnimationFrame(tick);
      else {
        c.x = p.x;
        c.y = p.y;
      }
      draw();
    };
    draw();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.outline, instant, withCard, view.width, view.height, figures?.x, figures?.y, figures?.w, figures?.h]);
  return (
    <>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible">
        <defs>
          {/* (the halos are seen outside the outline only: the inside of the column is cut out of them) */}
          <mask id={mid} maskUnits="userSpaceOnUse" x="-10000" y="-10000" width="20000" height="20000">
            <rect x="-10000" y="-10000" width="20000" height="20000" fill="#fff" />
            <path d={`M${info.outline.split(" ").join("L")}Z`.replaceAll(",", " ")} fill="#000" />
          </mask>
          {withCard && (
            <>
              {/* the connector's colour, from the outline's to the card's, and its halo, which fades out toward the card as the colour goes into the card's edge */}
              <linearGradient ref={grad} id={gid} gradientUnits="userSpaceOnUse">
                <stop offset="0" style={{ stopColor: "var(--act-link-from)" }} />
                <stop offset="1" style={{ stopColor: "var(--act-link-to)" }} />
              </linearGradient>
              <linearGradient ref={haloGrad} id={`${gid}h`} gradientUnits="userSpaceOnUse">
                <stop offset="0" style={{ stopColor: "var(--act-link-halo)", stopOpacity: 1 }} />
                {/* (gone by the middle: past it the core is no longer white and needs no halo) */}
                <stop offset="0.5" style={{ stopColor: "var(--act-link-halo)", stopOpacity: 0 }} />
              </linearGradient>
            </>
          )}
        </defs>
        {/* Back to front: the connector's halo, the outline's halo, the connector, the outline (so that nothing of the connector or of a halo lies over the selector's line). The light theme's halo is the library's; the dark theme has none. */}
        {withCard && <path ref={linkHalo} className="act-halo" mask={`url(#${mid})`} stroke={`url(#${gid}h)`} fill="none" strokeLinejoin="round" strokeLinecap="butt" style={{ opacity: shown ? 1 : 0, transition: FADE }} />}
        <path className="act-outline-halo act-halo" mask={`url(#${mid})`} d={`M${info.outline.split(" ").join("L")}Z`.replaceAll(",", " ")} fill="none" strokeLinejoin="round" style={{ opacity: onDay ? 1 : 0, transition: FADE }} />
        {withCard && <path ref={link} style={{ opacity: shown ? 1 : 0, transition: FADE }} fill="none" stroke={`url(#${gid})`} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="butt" />}
        <path className="act-outline" d={`M${info.outline.split(" ").join("L")}Z`.replaceAll(",", " ")} fill="color-mix(in srgb, var(--foreground) 7%, transparent)" strokeWidth={1.5} strokeLinejoin="round" style={{ opacity: onDay ? 1 : 0, transition: FADE }} />
      </svg>
      {withCard && (
        <div role="presentation" className="pointer-events-none absolute top-0 left-0 z-20 h-0 w-0" style={{ opacity: shown ? 1 : 0, transition: FADE }}>
          <DayCard cardRef={card} info={info} note={note} touch={touch} />
        </div>
      )}
    </>
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
/**
 * The credit link's looks, as the page's own classes (not the library's injected `<style>`, which the page's Content-Security-Policy (`style-src 'self'`) refuses: unstyled, its arrow drew 130 px wide on the live page): the box and the gap
 * of its inner element, the bold name, the 1.1 em arrow, the faded text colour that brightens, and the underline on hover and focus. The library sets nothing of the link's own box, so these and the placing classes below are all there is.
 */
const CREDIT = "rounded-[4px] text-[11px] leading-none font-medium tracking-[0.04em] no-underline text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current [&_.nag-in]:inline-flex [&_.nag-in]:items-center [&_.nag-in]:gap-[0.25em] [&_.nag-in]:px-[3px] [&_.nag-in]:py-1 [&_b]:font-bold [&_svg]:size-[1.1em] [&_svg]:flex-none hover:[&_.nag-w]:underline hover:[&_.nag-w]:underline-offset-[3px] focus-visible:[&_.nag-w]:underline focus-visible:[&_.nag-w]:underline-offset-[3px]";

export function ActivityPanel({ url, lead = [] }: { url: string | null; lead?: { value: string; label: string }[] }) {
  const { activity, failed } = useActivity(url);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  // the last day shown stays mounted (the card fades and glides instead of vanishing); a card that comes back from nothing appears in place
  const lastHover = useRef<HoverInfo | null>(null);
  if (hover) lastHover.current = hover;
  // A day that comes back within `FRESH_MS` of the last is not a new visit (the card glides to it, as from day to day) instead of appearing in place. The outline, the connector and the card go together with the day (one fade, `FADE`), and
  // also while the pointer is `busy`: when the day changes `BUSY_CHANGES` times within `BUSY_WINDOW_MS` the connector and the card (not the outline: the hovered column stays marked) fade until it has been calm for `CALM_MS` (owner, 2026-11-23: flickering, and in the way).
  const [busy, setBusy] = useState(false);
  const leftAt = useRef<number | null>(null);
  const everShown = useRef(false);
  const changes = useRef<{ t: number; x: number; y: number }[]>([]);
  const calm = useRef(0);
  const fresh = !!hover && (!everShown.current || (leftAt.current !== null && performance.now() - leftAt.current > FRESH_MS));
  const day = hover?.date ?? null;
  useEffect(() => {
    const now = performance.now();
    if (day) {
      everShown.current = true;
      leftAt.current = null;
      const list = changes.current;
      list.push({ t: now, x: hover?.x ?? 0, y: hover?.y ?? 0 });
      while (list.length && now - list[0]!.t > BUSY_WINDOW_MS) list.shift();
      const xs = list.map((q) => q.x);
      const ys = list.map((q) => q.y);
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      if (list.length >= BUSY_CHANGES && span >= BUSY_SPAN_PX) setBusy(true);
      window.clearTimeout(calm.current);
      calm.current = window.setTimeout(() => {
        changes.current = [];
        setBusy(false);
      }, CALM_MS);
    } else leftAt.current ??= now;
  }, [day]);
  useEffect(() => () => window.clearTimeout(calm.current), []);
  const instant = fresh;
  const sceneBox = useRef<HTMLDivElement>(null);
  // (the day card against the year, and whether the last press was a finger: the key cap says Tap then)
  const ctx = useMemo(() => (activity ? yearContext(activity) : null), [activity]);
  const [figures, setFigures] = useState<Rect | null>(null);
  const [view, setView] = useState({ width: 0, height: 0 });
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
      setView((v) => (v.width === r.width && v.height === r.height ? v : { width: r.width, height: r.height }));
      setFigures(fr && fr.width > 0 ? { x: fr.left - r.left, y: fr.top - r.top, w: fr.width, h: fr.height } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scene);
    ro.observe(root);
    return () => ro.disconnect();
  }, [seen, gl, activity, narrow]);
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
        <div ref={sceneBox} className="group/scene relative aspect-[3.97/1] w-full max-md:-mt-[6cqi] max-md:aspect-[0.95/1]">
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
          {lastHover.current && <HoverLayer info={lastHover.current} onDay={!!hover} shown={!!hover && !busy} instant={instant} ctx={ctx} touch={lastHover.current.source === "touch"} view={view} figures={figures} withCard={!narrow} />}
          <p className="sr-only" aria-live="polite">{hover ? dayText(hover) : ""}</p>
        </div>
      )}
      {/* The corners are only empty when the scene is big enough (from 80 rem of page): below that the figures and the legend sit under the picture, so the text never lies over the blocks. From there the page's own figures (software, places) join the year's
          in ONE grid at the top right, from the head's top down into the empty corner of the picture. */}
      <NeonAttribution className={`${CREDIT} absolute right-14 bottom-0 z-10 hidden translate-y-[calc(100%-0.375rem)] min-[56rem]:inline-flex min-[80rem]:bottom-3 min-[80rem]:translate-y-0`} />
      <Figures lead={lead} stats={stats} ready={!!activity} className="max-md:relative max-md:z-10 max-md:order-first max-md:pb-2 md:pointer-events-none md:absolute md:right-14 md:max-[56rem]:left-14 md:top-[calc(-1*clamp(2.5rem,6.4cqi,5.75rem)-0.25rem)]" />
      <div data-slot="activity-legend" className="relative flex flex-col gap-3 px-4 pt-3 md:pt-6 md:px-14 md:max-[56rem]:-mt-[6.5cqi] min-[56rem]:absolute min-[56rem]:bottom-[1%] min-[80rem]:bottom-[10.7%] min-[56rem]:left-14 min-[56rem]:w-[clamp(20rem,34cqi,25rem)] min-[56rem]:p-0">
        {/* On a phone the legend is where the day is read (no card over the picture): the two layers share one cell, the day's over the legend while a day is held. */}
        <div className="grid">
          <div className="flex flex-col gap-3 transition-opacity duration-150" style={{ gridArea: "1 / 1", opacity: narrow && hover ? 0 : 1 }}>
          <div className="flex items-baseline justify-between gap-4">
            <p className="type-meta m-0 text-muted-foreground uppercase">Last <span className="text-foreground">12 months</span></p>
            {/* (the credit link, the library's own: under 56 rem it ends the "Last 12 months" row; from 56 rem it hangs under the picture's bottom right corner, below) */}
            <NeonAttribution className={`${CREDIT} -my-1 -mr-[3px] md:max-[56rem]:translate-y-[2.15rem] min-[56rem]:hidden`} />
          </div>
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
