/**
 * The activity the software page draws: one number per day from two sources (GitHub's contributions, WakaTime's coding time), laid out as the weeks x weekdays matrix GitHub made familiar.
 * Pure (no three.js here): `components/activity-scene.tsx` draws what this lays out. The data is `activity.json` (`scripts/fetch-activity.mjs`).
 */
export interface Activity {
  generatedAt: string;
  github: { date: string; count: number; level: number }[];
  wakatime: { date: string; seconds: number }[];
}

export interface Cell {
  date: string;
  /** The weekday column (0 Monday .. 6 Sunday) and the week row (0 is the oldest). */
  day: number;
  week: number;
  /** The raw number (contributions, or hours of coding). */
  value: number;
  /** 0..1, how intense the day was against the busiest of the year (square root: a quiet day is still seen next to a huge one). */
  t: number;
}

export interface Matrix {
  cells: Cell[];
  weeks: number;
  max: number;
}

const DAY_MS = 86_400_000;
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);
/** Monday-first weekday of an ISO date. */
const weekday = (date: string) => (new Date(utc(date)).getUTCDay() + 6) % 7;

/** The last `weeks` whole weeks ending at `end` (an ISO date; the last week is the one `end` is in), as a matrix; days with no number are 0. */
export function layoutMatrix(days: { date: string; value: number }[], end: string, weeks = 53): Matrix {
  const byDate = new Map(days.map((d) => [d.date, d.value]));
  const lastMonday = utc(end) - weekday(end) * DAY_MS;
  const first = lastMonday - (weeks - 1) * 7 * DAY_MS;
  const cells: Cell[] = [];
  let max = 0;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const ms = first + (w * 7 + d) * DAY_MS;
      if (ms > utc(end)) continue;
      const date = new Date(ms).toISOString().slice(0, 10);
      const value = byDate.get(date) ?? 0;
      max = Math.max(max, value);
      cells.push({ date, day: d, week: w, value, t: 0 });
    }
  }
  for (const c of cells) c.t = max > 0 ? Math.sqrt(c.value / max) : 0;
  return { cells, weeks, max };
}

/** Both matrices of an activity file, ending at the latest day either source has. */
export function layoutActivity(a: Activity): { github: Matrix; wakatime: Matrix; end: string } {
  const end = [a.github.at(-1)?.date, a.wakatime.at(-1)?.date].filter((d): d is string => !!d).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  return {
    end,
    github: layoutMatrix(a.github.map((d) => ({ date: d.date, value: d.count })), end),
    wakatime: layoutMatrix(a.wakatime.map((d) => ({ date: d.date, value: d.seconds / 3600 })), end),
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
