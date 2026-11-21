import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "~/components/ui";
import { placeholderTiles } from "~/lib/activity-view";
import { activityStats, dayText, GITHUB_URL, isActivity, layoutActivity, readableDay, WAKATIME_URL, type Activity, type ActivityStat, type HoverInfo, type Matrix } from "~/lib/activity";

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

/** The picture's place-holder: the year's days as faint flat squares on the same slab, seen by the same camera as the scene (`lib/activity-view.ts`), pulsing, from the first paint and prerendered. The scene fades in over it, in place. */
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
 * The card of a day, hung on its column. It stays mounted and glides from one day to the next (and fades when the pointer leaves, snapping to the day where it comes back), over a blurred, translucent ground with a soft shadow and
 * no outline; its numbers are set like the page's figures (large value, small unit) and roll into each other as the day changes.
 */
function DayCard({ info, visible, instant, width }: { info: HoverInfo; visible: boolean; instant: boolean; width: number }) {
  const half = 128;
  const x = width ? Math.min(Math.max(info.x, half + 8), width - half - 8) : info.x;
  const y = info.y;
  const below = y < 120;
  const hours = info.hours >= 0.05 ? info.hours.toFixed(1) : "0";
  // The card follows its target with a damped glide (it eases toward it, a fraction of the way each frame), not a fixed transition from jump to jump: a pointer sweeping over many days
  // moves it in one smooth line. It appears in place when it comes from nothing, and does not move at all with reduced motion.
  const outer = useRef<HTMLDivElement>(null);
  const cur = useRef({ x, y, init: false });
  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const c = cur.current;
    const put = () => {
      el.style.transform = `translate3d(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px, 0)`;
    };
    if (instant || !c.init || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      c.x = x;
      c.y = y;
      c.init = true;
      put();
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const k = 1 - Math.exp(-Math.min(64, now - last) / 120);
      last = now;
      c.x += (x - c.x) * k;
      c.y += (y - c.y) * k;
      if (Math.abs(x - c.x) + Math.abs(y - c.y) > 0.25) raf = requestAnimationFrame(tick);
      else {
        c.x = x;
        c.y = y;
      }
      put();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [x, y, instant]);
  return (
    <div ref={outer} role="presentation" className="pointer-events-none absolute top-0 left-0 z-10" style={{ opacity: visible ? 1 : 0, transition: "opacity 0.16s" }}>
      <div
        className="w-64 px-4 py-3.5 backdrop-blur-md"
        style={{
          transform: `translate(-50%, ${below ? "16px" : "calc(-100% - 16px)"})`,
          transition: instant ? "none" : "transform 0.3s cubic-bezier(0.2, 0.7, 0.2, 1)",
          background: "color-mix(in srgb, var(--background) 68%, transparent)",
          // a glassy edge: a faint line all round, a little brighter on top where the light catches it (the shadow is always black: lighter than the page, in the dark theme, it would be a glow)
          boxShadow:
            "inset 0 0 0 1px color-mix(in srgb, var(--foreground) 11%, transparent), inset 0 1px 0 color-mix(in srgb, var(--foreground) 14%, transparent), 0 14px 44px -12px rgb(0 0 0 / 0.38), 0 2px 10px -4px rgb(0 0 0 / 0.22)",
        }}
      >
        {/* The day and the month are what the eye looks for: they are in the page's text colour, the weekday and the year (the frame around them) in the muted one. */}
        <p className="type-meta m-0 flex gap-[0.6em] uppercase">
          {(() => {
            const [weekday = "", day = "", month = "", year = ""] = readableDay(info.date).split(" ");
            const order = Date.parse(`${info.date}T00:00:00Z`);
            return (
              <>
                <span className="text-muted-foreground"><Roll value={weekday} order={order} /></span>
                <span className="text-foreground"><Roll value={`${day} ${month}`} order={order} /></span>
                <span className="text-muted-foreground"><Roll value={year} order={order} /></span>
              </>
            );
          })()}
        </p>
        <div className="mt-2.5 grid grid-cols-2 gap-x-6">
          <div className="flex flex-col gap-1" style={{ color: soft("green", 70) }}>
            <span className="flex items-baseline gap-1 font-[family-name:var(--font-display)] text-[2rem] leading-none font-semibold tracking-tight tabular-nums">
              <Roll value={String(info.contributions)} order={info.contributions} />
            </span>
            <span className="type-meta text-muted-foreground uppercase">{info.contributions === 1 ? "contribution" : "contributions"}</span>
          </div>
          <div className="flex flex-col gap-1" style={{ color: soft("blue", 70) }}>
            <span className="flex items-baseline gap-1 font-[family-name:var(--font-display)] text-[2rem] leading-none font-semibold tracking-tight tabular-nums">
              <Roll value={hours} order={Number(hours)} />
              <span className="type-meta font-normal text-muted-foreground normal-case">h</span>
            </span>
            <span className="type-meta text-muted-foreground uppercase">coded</span>
          </div>
        </div>
        {/* (days stand behind one another: how many are under the pointer, and how to reach the next) */}
        {info.behind && info.behind.count > 1 && (
          <p className="type-meta m-0 mt-3 text-muted-foreground uppercase">
            {info.behind.index + 1} of {info.behind.count} <span aria-hidden="true">·</span> click for next
          </p>
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
  const box = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  const [gl, setGl] = useState(true);
  // a narrow page gets the year in four strips (a squarer slab) instead of one long one
  const [narrow, setNarrow] = useState(false);
  // `?xmas`, an Easter egg (a demo, not on by default): a greeting joins the legend (read after the first paint, so that the page's first render is the same everywhere)
  const [xmas, setXmas] = useState(false);
  useEffect(() => {
    setGl(webgl2());
    if (new URLSearchParams(window.location.search).has("xmas")) {
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
  if (!enabledFor(url)) return null;
  // (the file is not there after all: the picture goes away, and the page's own figures, which the head hid for the grid, are shown on their own)
  if (failed) return lead.length ? <Figures lead={lead} stats={[]} className="hidden md:grid md:absolute md:top-0 md:right-14" /> : null;
  const flat = !gl && activity ? layoutActivity(activity) : null;
  const stats = activity ? activityStats(activity) : WAITING_STATS;
  // The tilt of the scene leaves its top-right and bottom-left corners empty: the figures take the first and the legend the second (on a narrow page there is no corner, they go under the picture).
  return (
    <section ref={box} data-slot="activity" aria-label="Activity over the last year" className="relative -mx-4 mt-0 mb-2 max-md:flex max-md:flex-col md:-mx-14 md:mb-4 min-[90rem]:-mb-4">
      {flat ? (
        <div role="img" aria-label="Activity over the last year: GitHub contributions and WakaTime coding time, a square a day" className="flex flex-col gap-4 px-4 md:px-14">
          <FlatMatrix matrix={flat.wakatime} tone="#0078d7" />
          <FlatMatrix matrix={flat.github} tone="#0fbf3e" />
        </div>
      ) : (
        <div ref={sceneBox} className="group/scene relative aspect-[3.97/1] w-full max-md:aspect-[0.95/1]">
          <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-0" : ""}`}>
            <Waiting strips={1} aspect={3.97} className="max-md:hidden" />
            <Waiting strips={4} aspect={0.95} className="hidden max-md:block" />
          </div>
          {seen && activity && (
            <Suspense fallback={null}>
              <ActivityScene activity={activity} strips={narrow ? 4 : 1} onReady={() => setReady(true)} onHover={setHover} className="absolute inset-0 outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-[var(--ring)]" />
            </Suspense>
          )}
          {xmas && (
            <div aria-hidden="true" className="pointer-events-none absolute right-0 bottom-0 z-10 flex items-end justify-end px-[4cqi] pt-[6cqi] pb-[1.5cqi] opacity-100 transition-opacity duration-500 group-hover/scene:opacity-0" style={{ background: "radial-gradient(ellipse at 100% 100%, color-mix(in oklab, var(--background) 85%, transparent), transparent 72%)" }}>
              <span className="text-[clamp(2.25rem,6cqi,4.25rem)] leading-none" style={{ fontFamily: '"Imperial Script", "Snell Roundhand", "Apple Chancery", cursive', color: "#ff5a5a", WebkitTextStroke: "0.6px #ff5a5a", textShadow: "0 0 0.5em rgb(255 60 60 / 0.35)" }}>
                Merry Christmas
              </span>
            </div>
          )}
          {lastHover.current && (
            <>
              <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible" style={{ opacity: hover ? 1 : 0, transition: instant ? "none" : "opacity 0.12s" }}>
                {(() => {
                  const d = `M${lastHover.current.outline.split(" ").join("L")}Z`.replaceAll(",", " ");
                  return <path d={d} fill="color-mix(in srgb, var(--foreground) 7%, transparent)" stroke="var(--foreground)" strokeWidth={1.5} strokeLinejoin="round" />;
                })()}
              </svg>
              <DayCard info={lastHover.current} visible={!!hover} instant={instant} width={sceneBox.current?.clientWidth ?? 0} />
            </>
          )}
          <p className="sr-only" aria-live="polite">{hover ? dayText(hover) : ""}</p>
        </div>
      )}
      {/* The corners are only empty when the scene is big enough (from 80 rem of page): below that the figures and the legend sit under the picture, so the text never lies over the blocks. From there the page's own figures (software, places) join the year's
          in ONE grid at the top right, from the head's top down into the empty corner of the picture. */}
      <Figures lead={lead} stats={stats} ready={!!activity} className="max-md:order-first max-md:pb-2 md:pointer-events-none md:absolute md:right-14 md:max-[56rem]:left-14 md:top-[calc(-1*clamp(2.5rem,6.4cqi,5.75rem)-0.25rem)]" />
      <div data-slot="activity-legend" className="relative flex flex-col gap-3 px-4 pt-3 md:pt-6 md:px-14 md:max-[56rem]:-mt-[6.5cqi] min-[56rem]:absolute min-[56rem]:bottom-[1%] min-[80rem]:bottom-[10.7%] min-[56rem]:left-14 min-[56rem]:w-[clamp(20rem,34cqi,25rem)] min-[56rem]:p-0">
        <p className="type-meta m-0 text-muted-foreground uppercase">Last <span className="text-foreground">12 months</span></p>
        {/* In the picture's order: the contributions are the upper block of a day, the coding the lower one. */}
        <p className="m-0 font-[family-name:var(--font-display)] text-[1.625rem] min-[56rem]:text-[clamp(1.25rem,2.3cqi,1.625rem)] leading-[1.1] font-semibold tracking-tight text-balance">
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
    </section>
  );
}
