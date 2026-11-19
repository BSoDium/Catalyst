import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { GitHubMark, Icon, WakaTimeMark } from "~/components/ui";
import { activityStats, GITHUB_URL, isActivity, layoutActivity, WAKATIME_URL, type Activity, type Matrix } from "~/lib/activity";

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

/** The activity file: `url`'s in production, the snapshot in development (the branch does not exist until the workflow has run). Null while loading and when there is none: the panel is then not drawn at all. */
function useActivity(url: string | null): Activity | null {
  const [activity, setActivity] = useState<Activity | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    (async () => {
      const raw = import.meta.env.DEV ? (await import("~/lib/activity.sample.json")).default : url ? await fetch(url, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : null)) : null;
      if (isActivity(raw)) setActivity(raw);
    })().catch(() => {});
    return () => ctl.abort();
  }, [url]);
  return activity;
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

/**
 * The software page's picture of the year: GitHub contributions and WakaTime coding time, a block a day (`ActivityScene`, a still isometric scene built up over a few dozen frames). Client-only: the file is fetched when the page
 * opens, the scene (three.js) loads only when the panel scrolls into view, and the room is held (an aspect ratio) so nothing moves when it arrives. Without WebGL the same numbers are two flat grids.
 */
export function ActivityPanel({ url }: { url: string | null }) {
  const activity = useActivity(url);
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
  }, [activity]);
  if (!activity) return null;
  const flat = !gl ? layoutActivity(activity) : null;
  const stats = activityStats(activity);
  // The tilt of the scene leaves its top-right and bottom-left corners empty: the figures take the first and the legend the second (on a narrow page there is no corner, they go under the picture).
  return (
    <section ref={box} data-slot="activity" aria-label="Activity over the last year" className="relative -mx-4 mt-0 mb-2 md:-mx-14">
      {flat ? (
        <div role="img" aria-label="Activity over the last year: GitHub contributions and WakaTime coding time, a square a day" className="flex flex-col gap-4 px-4 md:px-14">
          <FlatMatrix matrix={flat.wakatime} tone="#0078d7" />
          <FlatMatrix matrix={flat.github} tone="#0fbf3e" />
        </div>
      ) : (
        <div className="aspect-[3.97/1] w-full max-md:aspect-[1.7/1]">{seen && <Suspense fallback={null}><ActivityScene activity={activity} strips={narrow ? 3 : 1} className="size-full" /></Suspense>}</div>
      )}
      {/* The corners are only empty when the scene is big enough (from 80 rem of page): below that the figures and the legend sit under the picture, so the text never lies over the blocks. */}
      <dl data-slot="activity-stats" className="grid grid-cols-2 gap-x-8 gap-y-5 px-4 pt-5 md:grid-cols-4 md:px-14 min-[80rem]:pointer-events-none min-[80rem]:absolute min-[80rem]:top-3 min-[80rem]:right-14 min-[80rem]:grid-flow-col min-[80rem]:grid-cols-none min-[80rem]:grid-rows-2 min-[80rem]:gap-x-14 min-[80rem]:gap-y-5 min-[80rem]:p-0 min-[80rem]:text-right [&>*:nth-child(3)]:md:ml-6 min-[80rem]:[&>*:nth-child(3)]:ml-0">
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
        <p className="m-0 font-[family-name:var(--font-display)] text-[1.625rem] leading-[1.1] font-semibold tracking-tight text-nowrap">
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
