import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { isActivity, layoutActivity, type Activity, type Matrix } from "~/lib/activity";

const ActivityScene = lazy(() => import("~/components/activity-scene").then((m) => ({ default: m.ActivityScene })));

const webgl2 = () => {
  try {
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
  useEffect(() => {
    setGl(webgl2());
    const el = box.current;
    if (!el || !("IntersectionObserver" in window)) return setSeen(true);
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && (setSeen(true), io.disconnect()), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [activity]);
  if (!activity) return null;
  const flat = !gl ? layoutActivity(activity) : null;
  return (
    <section ref={box} data-slot="activity" aria-label="Activity over the last year" className="mt-6 mb-2 max-md:mt-3">
      {flat ? (
        <div role="img" aria-label="Activity over the last year: GitHub contributions and WakaTime coding time, a square a day" className="flex flex-col gap-4">
          <FlatMatrix matrix={flat.wakatime} tone="oklch(0.62 0.2 295)" />
          <FlatMatrix matrix={flat.github} tone="oklch(0.72 0.18 50)" />
        </div>
      ) : (
        <div className="aspect-[4.07/1] w-full">{seen && <Suspense fallback={null}><ActivityScene activity={activity} className="size-full" /></Suspense>}</div>
      )}
      <p className="type-meta mt-2 text-muted-foreground">The last year, a column a day: coding time (violet, below) and GitHub contributions (orange, above); the brighter, the busier</p>
    </section>
  );
}
