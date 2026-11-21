import type { DayValue, GraphLayer } from "./types";

/** The shape of GitHub's GraphQL `contributionsCollection.contributionCalendar` (what `gh api graphql` returns for it). */
export interface GitHubContributionCalendar {
  weeks: { contributionDays: { date: string; contributionCount: number }[] }[];
}

/** A layer from GitHub's contribution calendar. */
export function fromGitHubCalendar(calendar: GitHubContributionCalendar, label = "Contributions"): GraphLayer {
  const days: DayValue[] = calendar.weeks.flatMap((w) => w.contributionDays.map((d) => ({ date: d.date, value: d.contributionCount })));
  return { label, unit: "contributions", days };
}

/** The shape of WakaTime's `GET /users/current/summaries` answer (the fields used). */
export interface WakaTimeSummaries {
  data: { range: { date: string }; grand_total: { total_seconds: number } }[];
}

/** A layer from WakaTime's summaries, in hours. */
export function fromWakaTimeSummaries(summaries: WakaTimeSummaries, label = "Coding time"): GraphLayer {
  return { label, unit: "h", days: summaries.data.map((d) => ({ date: d.range.date, value: d.grand_total.total_seconds / 3600 })) };
}

/** A layer from anything with a date and a number: `fromRecords(rows, (r) => r.day, (r) => r.count)`. Several rows on one day add up. */
export function fromRecords<T>(rows: readonly T[], date: (row: T) => string, value: (row: T) => number, label?: string, unit?: string): GraphLayer {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(date(r).slice(0, 10), (sums.get(date(r).slice(0, 10)) ?? 0) + value(r));
  return { label, unit, days: [...sums].map(([d, v]) => ({ date: d, value: v })).sort((a, b) => a.date.localeCompare(b.date)) };
}

/** Random-looking but repeatable fake data for demos and tests: `days` days ending at `end`, busier on weekdays, with the odd quiet stretch. */
export function fakeLayer(options: { end?: string; days?: number; seed?: number; scale?: number; label?: string; unit?: string } = {}): GraphLayer {
  const { end = new Date().toISOString().slice(0, 10), days = 371, seed = 1, scale = 12, label, unit } = options;
  let s = seed * 2654435761 >>> 0 || 1;
  const rand = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const out: DayValue[] = [];
  let mood = 1;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endMs - i * 86_400_000);
    // (a slow mood: a few busy weeks, a few quiet ones)
    if (rand() < 0.04) mood = 0.1 + rand() * 1.6;
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const v = rand() < (weekend ? 0.45 : 0.15) ? 0 : Math.round(rand() ** 2 * scale * mood * (weekend ? 0.5 : 1) * 10) / 10;
    out.push({ date: d.toISOString().slice(0, 10), value: v });
  }
  return { label, unit, days: out };
}
