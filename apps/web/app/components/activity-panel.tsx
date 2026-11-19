import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { activityStats, isActivity, layoutActivity, type Activity, type Matrix } from "~/lib/activity";

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
      <dl data-slot="activity-stats" className="grid grid-cols-2 gap-x-8 gap-y-4 px-4 pt-4 md:pointer-events-none md:absolute md:top-3 md:right-14 md:grid-cols-2 md:gap-x-9 md:gap-y-4 md:p-0 md:text-right">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-1.5 md:items-end">
            <dd className="m-0 font-[family-name:var(--font-display)] text-[1.625rem] leading-none font-medium tracking-tight tabular-nums">{s.value}</dd>
            <dt className="type-meta text-muted-foreground uppercase">{s.label}</dt>
          </div>
        ))}
      </dl>
      <div data-slot="activity-legend" className="px-4 pt-4 md:absolute md:bottom-0 md:left-14 md:max-w-[22rem] md:p-0">
        <p className="m-0 text-pretty font-[family-name:var(--font-reading)] text-base leading-snug text-foreground md:text-lg">A year of work, a day to a column: the hours I coded below, my GitHub contributions on top. The brighter the block, the busier the day.</p>
        <p className="type-meta mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 uppercase text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5" style={{ background: "#1a8cff" }} />coding time</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5" style={{ background: "#0fbf3e" }} />GitHub</span>
        </p>
      </div>
    </section>
  );
}
