/**
 * The activity the software page draws: one number per day from two sources (GitHub's contributions, WakaTime's coding time), laid out as the weeks x weekdays matrix GitHub made familiar.
 * Pure (no three.js here): `components/activity-scene.tsx` draws it with the `neon-activity-graph` package (from npm, developed in https://github.com/BSoDium/Neon-activity-graph). The data is `activity.json` (`scripts/fetch-activity.mjs`).
 */
import { layoutGraph, type GraphData, type Matrix } from "neon-activity-graph/layout";

export type { Matrix };

export interface Activity {
  generatedAt: string;
  github: { date: string; count: number; level: number }[];
  wakatime: { date: string; seconds: number }[];
}

/** Both matrices of an activity file, ending at the latest day either source has. */
export function layoutActivity(a: Activity): { github: Matrix; wakatime: Matrix; end: string } {
  const { top, bottom, end } = layoutGraph(toGraphData(a));
  return { end, github: top, wakatime: bottom };
}

/** The file as the graph library takes it: GitHub's contributions are the top layer, WakaTime's coding time (in hours) the bottom one. */
export function toGraphData(a: Activity): GraphData {
  return {
    top: { label: "contributions", days: a.github.map((d) => ({ date: d.date, value: d.count })) },
    bottom: { label: "coded", unit: "h", days: a.wakatime.map((d) => ({ date: d.date, value: d.seconds / 3600 })) },
  };
}

/** The file as far as the page needs it: both series, each with enough days; anything else is not drawn. */
export function isActivity(v: unknown): v is Activity {
  const a = v as Activity | null;
  const ok = (xs: unknown, key: string) => Array.isArray(xs) && xs.length > 30 && xs.every((d) => typeof d?.date === "string" && Number.isFinite(d[key]));
  return !!a && typeof a === "object" && typeof a.generatedAt === "string" && ok(a.github, "count") && ok(a.wakatime, "seconds");
}

export interface ActivityStat {
  value: string;
  /** The unit, set small and quiet after the value ("h", "days", "%"). */
  unit?: string;
  label: string;
  /** Which source the figure belongs to (its colour), or none: the figures of the rhythm are plain. */
  tone: "green" | "blue" | "plain";
}

/** The owner's profiles on the two sources (what the picture is made of). */
export const GITHUB_URL = "https://github.com/BSoDium";
export const WAKATIME_URL = "https://wakatime.com/@BSoDium";

const DAY = 86_400_000;
const num = (n: number) => Math.round(n).toLocaleString("en");

/**
 * The figures of the year printed beside the picture: contributions, hours coded, the longest run of days with some activity in either source, and the share of days with any. The year is the 365 days ending at the latest day
 * of the file. Pure.
 */
export function activityStats(a: Activity): ActivityStat[] {
  const end = [a.github.at(-1)?.date, a.wakatime.at(-1)?.date].filter((d): d is string => !!d).sort().at(-1);
  if (!end) return [];
  const from = Date.parse(`${end}T00:00:00Z`) - 364 * DAY;
  const inYear = (d: { date: string }) => Date.parse(`${d.date}T00:00:00Z`) >= from;
  const github = a.github.filter(inYear);
  const waka = a.wakatime.filter(inYear);
  const contributions = github.reduce((s, d) => s + d.count, 0);
  const hours = waka.reduce((s, d) => s + d.seconds, 0) / 3600;
  const active = new Set<string>([...github.filter((d) => d.count > 0).map((d) => d.date), ...waka.filter((d) => d.seconds > 0).map((d) => d.date)]);
  let streak = 0;
  let run = 0;
  for (let t = from; t <= Date.parse(`${end}T00:00:00Z`); t += DAY) {
    run = active.has(new Date(t).toISOString().slice(0, 10)) ? run + 1 : 0;
    streak = Math.max(streak, run);
  }
  return [
    { value: num(contributions), label: "contributions", tone: "green" },
    { value: num(hours), unit: "h", label: "coded", tone: "blue" },
    { value: String(streak), unit: "days", label: "longest streak", tone: "plain" },
    { value: String(Math.round((active.size / 365) * 100)), unit: "%", label: "days active", tone: "plain" },
  ];
}

/** What the picture says about the day under the pointer (or the key): its numbers, the outline of its column on the picture and a point to hang the card on (CSS pixels of the picture). */
export interface HoverInfo {
  date: string;
  contributions: number;
  hours: number;
  /** SVG `points` of the column's silhouette. */
  outline: string;
  x: number;
  y: number;
  /** When several days are under the pointer, one behind another: which of them this is (0 the nearest) and how many there are. */
  behind?: { index: number; count: number };
}

/** The hours of a day as the card says them: "10 h", "2.5 h", "25 min", or null when there were none (no ".0": whole hours are whole). */
export function hoursText(h: number): string | null {
  if (!(h >= 0.05)) return null;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  const t = h.toFixed(1);
  return `${t.endsWith(".0") ? t.slice(0, -2) : t} h`;
}

/** Where a day stands in the file's year: its share of the best day's value, per source (0..1), and a note when it is notable (the best day of a source, or in the top 5 % of its active days). Pure. */
export function yearContext(a: Activity): (contributions: number, hours: number) => { c: number; h: number; note: string | null } {
  const gh = a.github.map((d) => d.count);
  const wk = a.wakatime.map((d) => d.seconds / 3600);
  const maxC = Math.max(1, ...gh);
  const maxH = Math.max(0.1, ...wk);
  const activeC = gh.filter((x) => x > 0).length;
  const activeH = wk.filter((x) => x >= 0.05).length;
  // (how many days did at least as much: ties count against a day, so a year of identical days has no top 5 %)
  const rank = (xs: number[], v: number) => xs.filter((x) => x >= v).length;
  return (contributions, hours) => {
    const rc = contributions > 0 ? rank(gh, contributions) : null;
    const rh = hours >= 0.05 ? rank(wk, hours) : null;
    const note =
      rc === 1 ? "Most contributions in a day" : rh === 1 ? "Longest day of coding" : rc !== null && rc <= Math.max(1, Math.round(activeC * 0.05)) ? "Top 5 % for contributions" : rh !== null && rh <= Math.max(1, Math.round(activeH * 0.05)) ? "Top 5 % for coding" : null;
    return { c: Math.min(1, contributions / maxC), h: Math.min(1, hours / maxH), note };
  };
}

/** "Thu 19 Nov 2026" for an ISO date, read in UTC (the date has no time of day). */
export function readableDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The words for a day, for a card and for a screen reader. */
export function dayText(h: Pick<HoverInfo, "date" | "contributions" | "hours">): string {
  const c = `${h.contributions} contribution${h.contributions === 1 ? "" : "s"}`;
  const t = h.hours >= 0.05 ? `${h.hours.toFixed(1)} h coded` : "no coding";
  return `${readableDay(h.date)}: ${c}, ${t}`;
}
