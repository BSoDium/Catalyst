import { useEffect, useMemo, useState } from "react";
import { ActivityGraphView } from "neon-activity-graph/react";
import { toGraphData, type Activity, type HoverInfo } from "~/lib/activity";
import { createSleighBells } from "~/components/sleigh-bells";
import { xmasRod } from "~/lib/xmas-lights";
import { xmasNow } from "~/lib/xmas";

/**
 * The activity picture of the software page: the `neon-activity-graph` package's scene (from npm, developed in https://github.com/BSoDium/Neon-activity-graph, which documents the optics, the neon start-up and the options) with what is the site's own: the page's
 * theme and background, the `?xmas` string of lights and its sleigh bells, the card's numbers, and the development helpers (`?lite`, `?wireframe`, `?neonhold`, the `data-*` figures).
 */
const query = (name: string) => import.meta.env.DEV && new URLSearchParams(window.location.search).has(name);

const isDark = () => {
  const forced = document.documentElement.getAttribute("data-scheme");
  return forced ? forced === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
};

/** The page's theme, followed: its `data-scheme` attribute if it has one, else the system's. */
function useTheme(): "light" | "dark" {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const update = () => setDark(isDark());
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scheme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", update);
    };
  }, []);
  return dark ? "dark" : "light";
}

/** The page's own background, read as the browser resolves it: the ground is that colour (so there is something to refract, and no seam with the page). */
const pageBackground = () => {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;background:var(--background)";
  document.body.appendChild(probe);
  const css = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return css;
};

const debugFlags = () => ({ metrics: import.meta.env.DEV, wireframe: query("wireframe"), neonHold: query("neonhold") });

/** (`?xmas`, dark theme: a faint shake of sleigh bells, started with the picture, stopped with it; the recording is fetched at once, so that it is ready when the start-up begins) */
const bellsStartup = ({ inView }: { inView: () => boolean }) => {
  const bells = createSleighBells({ canPlay: inView });
  bells.load();
  return { start: () => bells.start(), stop: () => bells.stop() };
};

export function ActivityScene({ activity, strips = 1, onReady, onLit, onHover, className }: { activity: Activity; strips?: number; onReady?: () => void; onLit?: (lit: boolean) => void; onHover?: (info: HoverInfo | null) => void; className?: string }) {
  const theme = useTheme();
  const data = useMemo(() => toGraphData(activity), [activity]);
  const [xmas] = useState(xmasNow);
  const [debug] = useState(debugFlags);
  return (
    <ActivityGraphView
      data={data}
      strips={strips}
      theme={theme}
      background={pageBackground}
      lite={query("lite") ? true : "auto"}
      rodColor={xmas ? xmasRod : undefined}
      startup={xmas ? bellsStartup : undefined}
      debug={debug}
      placeholder={false}
      label="Activity over the last year: GitHub contributions and WakaTime coding time, one column a day. Use the arrow keys to move between days."
      onReady={onReady}
      onLit={onLit}
      onHover={onHover && ((i) => onHover(i && { date: i.date, contributions: i.top, hours: i.bottom, outline: i.outline, x: i.x, y: i.y, behind: i.behind }))}
      className={className}
    />
  );
}
