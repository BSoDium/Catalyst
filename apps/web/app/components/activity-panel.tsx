import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { GitHubMark, Icon, WakaTimeMark } from "~/components/ui";
import { placeholderTiles } from "~/lib/activity-view";
import { activityStats, dayText, GITHUB_URL, isActivity, layoutActivity, readableDay, WAKATIME_URL, type Activity, type ActivityStat, type HoverInfo, type Matrix } from "~/lib/activity";

/** A source's colour as text, softened toward the page's own text colour (the figures and words are tinted, not painted). */
const soft = (tone: "green" | "blue", share = 62) => `color-mix(in srgb, var(${tone === "green" ? "--act-green" : "--act-blue"}) ${share}%, var(--foreground))`;
/** The profile links: a soft tint of the source's colour, no outline; the mark and the label take the same tone. */
const LINK = "inline-flex min-h-9 items-center gap-2 px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current max-md:min-h-11";

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
  const below = info.y < 120;
  const glide = instant ? "none" : "transform 0.22s cubic-bezier(0.2, 0.7, 0.2, 1)";
  const hours = info.hours >= 0.05 ? info.hours.toFixed(1) : "0";
  return (
    <div role="presentation" className="pointer-events-none absolute top-0 left-0 z-10" style={{ transform: `translate3d(${x}px, ${info.y}px, 0)`, transition: glide, opacity: visible ? 1 : 0, transitionProperty: instant ? "opacity" : "transform, opacity", transitionDuration: "0.22s, 0.16s" }}>
      <div
        className="w-64 px-4 py-3.5 backdrop-blur-md"
        style={{
          transform: `translate(-50%, ${below ? "16px" : "calc(-100% - 16px)"})`,
          transition: instant ? "none" : "transform 0.22s cubic-bezier(0.2, 0.7, 0.2, 1)",
          background: "color-mix(in srgb, var(--background) 68%, transparent)",
          // (the shadow is always black: a shadow lighter than the page, in the dark theme, would be a glow)
          boxShadow: "0 14px 44px -12px rgb(0 0 0 / 0.38), 0 2px 10px -4px rgb(0 0 0 / 0.22)",
        }}
      >
        <p className="type-meta m-0 text-muted-foreground uppercase"><Roll value={readableDay(info.date)} order={Date.parse(`${info.date}T00:00:00Z`)} /></p>
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
      </div>
    </div>
  );
}

/**
 * The software page's picture of the year: GitHub contributions and WakaTime coding time, a block a day (`ActivityScene`, a still isometric scene built up over a few dozen frames). Client-only: the file is fetched when the page
 * opens, the scene (three.js) loads only when the panel scrolls into view, and the room is held (an aspect ratio) so nothing moves when it arrives. Without WebGL the same numbers are two flat grids.
 */
export function ActivityPanel({ url }: { url: string | null }) {
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
  // a narrow page gets the year in three strips (a squarer slab) instead of one long one
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    setGl(webgl2());
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
  if (!enabledFor(url) || failed) return null;
  const flat = !gl && activity ? layoutActivity(activity) : null;
  const stats = activity ? activityStats(activity) : WAITING_STATS;
  // The tilt of the scene leaves its top-right and bottom-left corners empty: the figures take the first and the legend the second (on a narrow page there is no corner, they go under the picture).
  return (
    <section ref={box} data-slot="activity" aria-label="Activity over the last year" className="relative -mx-4 mt-0 mb-2 md:-mx-14">
      {flat ? (
        <div role="img" aria-label="Activity over the last year: GitHub contributions and WakaTime coding time, a square a day" className="flex flex-col gap-4 px-4 md:px-14">
          <FlatMatrix matrix={flat.wakatime} tone="#0078d7" />
          <FlatMatrix matrix={flat.github} tone="#0fbf3e" />
        </div>
      ) : (
        <div ref={sceneBox} className="relative aspect-[3.97/1] w-full max-md:aspect-[1.7/1]">
          <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-0" : ""}`}>
            <Waiting strips={1} aspect={3.97} className="max-md:hidden" />
            <Waiting strips={3} aspect={1.7} className="hidden max-md:block" />
          </div>
          {seen && activity && (
            <Suspense fallback={null}>
              <ActivityScene activity={activity} strips={narrow ? 3 : 1} onReady={() => setReady(true)} onHover={setHover} className="absolute inset-0 outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-[var(--ring)]" />
            </Suspense>
          )}
          {lastHover.current && (
            <>
              <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible" style={{ opacity: hover ? 1 : 0, transition: "opacity 0.16s" }}>
                {(() => {
                  const d = `M${lastHover.current.outline.split(" ").join("L")}Z`.replaceAll(",", " ");
                  return <path d={d} style={{ d: `path("${d}")`, transition: instant ? "none" : "d 0.22s cubic-bezier(0.2, 0.7, 0.2, 1)" }} fill="color-mix(in srgb, var(--foreground) 7%, transparent)" stroke="var(--foreground)" strokeWidth={1.5} strokeLinejoin="round" />;
                })()}
              </svg>
              <DayCard info={lastHover.current} visible={!!hover} instant={instant} width={sceneBox.current?.clientWidth ?? 0} />
            </>
          )}
          <p className="sr-only" aria-live="polite">{hover ? dayText(hover) : ""}</p>
        </div>
      )}
      {/* The corners are only empty when the scene is big enough (from 80 rem of page): below that the figures and the legend sit under the picture, so the text never lies over the blocks. */}
      <dl data-slot="activity-stats" aria-hidden={activity ? undefined : true} className={`transition-opacity duration-500 ${activity ? "" : "opacity-0"} grid grid-cols-2 gap-x-8 gap-y-5 px-4 pt-5 md:grid-cols-4 md:px-14 min-[80rem]:pointer-events-none min-[80rem]:absolute min-[80rem]:top-3 min-[80rem]:right-14 min-[80rem]:grid-flow-col min-[80rem]:grid-cols-none min-[80rem]:grid-rows-2 min-[80rem]:gap-x-14 min-[80rem]:gap-y-5 min-[80rem]:p-0 min-[80rem]:text-right [&>*:nth-child(3)]:md:ml-6 min-[80rem]:[&>*:nth-child(3)]:ml-0`}>
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-1.5 min-[80rem]:items-end">
            <dd className="m-0 flex items-baseline gap-1 min-[80rem]:justify-end" style={{ color: s.tone === "plain" ? undefined : soft(s.tone) }}>
              <span className="font-[family-name:var(--font-display)] text-[1.875rem] leading-none font-semibold tracking-tight tabular-nums">{s.value}</span>
              {s.unit && <span className="type-meta font-normal text-muted-foreground normal-case">{s.unit}</span>}
            </dd>
            <dt className="type-meta text-muted-foreground uppercase">{s.label}</dt>
          </div>
        ))}
      </dl>
      <div data-slot="activity-legend" className="flex flex-col gap-3 px-4 pt-5 md:px-14 min-[80rem]:absolute min-[80rem]:bottom-0 min-[80rem]:left-14 min-[80rem]:w-[25rem] min-[80rem]:p-0">
        <p className="type-meta m-0 text-muted-foreground uppercase">Last 12 months</p>
        <p className="m-0 font-[family-name:var(--font-display)] text-[1.625rem] leading-[1.1] font-semibold tracking-tight text-balance min-[80rem]:text-nowrap">
          <span style={{ color: soft("blue", 75) }}>Coding</span> below, <span style={{ color: soft("green", 75) }}>contributions</span> above.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a href={WAKATIME_URL} target="_blank" rel="noopener noreferrer" className={LINK} style={{ color: soft("blue", 80), background: "color-mix(in srgb, var(--act-blue) 13%, transparent)" }}>
            <WakaTimeMark />
            Coding activity
            <Icon name="arrow-up-right" size="inline" aria-hidden="true" />
            <span className="sr-only">on WakaTime (opens in a new tab)</span>
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={LINK} style={{ color: soft("green", 80), background: "color-mix(in srgb, var(--act-green) 13%, transparent)" }}>
            <GitHubMark />
            GitHub contributions
            <Icon name="arrow-up-right" size="inline" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
      </div>
    </section>
  );
}
