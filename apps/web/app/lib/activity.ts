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
