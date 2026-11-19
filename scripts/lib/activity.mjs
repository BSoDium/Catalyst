// The activity the software page draws (issue: GitHub contributions + WakaTime coding time, one number per day). Pure parsers, no network here (scripts/fetch-activity.mjs does the fetching).

/**
 * GitHub's public contribution calendar (`https://github.com/users/<login>/contributions`, an HTML fragment that needs no token) as `[{ date, count, level }]`, oldest first.
 * Every cell has `data-date` and `data-level` (0..4) and a tooltip with the count ("2 contributions on November 16th.", "No contributions on ...").
 */
export function parseGithubCalendar(html) {
  const tips = new Map();
  for (const m of html.matchAll(/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>\s*([^<]*?)\s*</g)) {
    const n = /^(\d[\d,]*)\s+contributions?\b/.exec(m[2]);
    tips.set(m[1], n ? Number(n[1].replace(/,/g, "")) : 0);
  }
  const days = [];
  for (const m of html.matchAll(/<td\b[^>]*>/g)) {
    const tag = m[0];
    const date = /\bdata-date="(\d{4}-\d{2}-\d{2})"/.exec(tag)?.[1];
    const level = /\bdata-level="(\d)"/.exec(tag)?.[1];
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    if (!date || level === undefined) continue;
    days.push({ date, count: (id && tips.get(id)) || 0, level: Number(level) });
  }
  return days.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** WakaTime's public days (`/api/v1/users/<uuid>/insights/days/public`, what the public profile page itself loads) as `[{ date, seconds }]`, oldest first. */
export function parseWakatimeDays(json) {
  const days = json?.data?.days;
  if (!Array.isArray(days)) throw new Error("wakatime: no days in the answer");
  return days.filter((d) => typeof d?.date === "string" && Number.isFinite(d?.total)).map((d) => ({ date: d.date, seconds: d.total })).sort((a, b) => (a.date < b.date ? -1 : 1));
}
