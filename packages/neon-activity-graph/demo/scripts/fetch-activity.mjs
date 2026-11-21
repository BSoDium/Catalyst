#!/usr/bin/env node
// Fetches a person's PUBLIC activity (no token) and writes `activity.json` in the package's data format:
//   { generatedAt, top: { label, unit, days: [{ date, value }] }, bottom: { ... } }
// top = GitHub's contribution calendar, bottom = WakaTime's public days, in hours.
//
//   GITHUB_LOGIN=octocat WAKATIME_USER=<public uuid> node demo/scripts/fetch-activity.mjs out.json
//
// A failed fetch exits non-zero and writes nothing, so the last good file stays in place.
import { writeFile } from "node:fs/promises";

const { GITHUB_LOGIN, WAKATIME_USER } = process.env;
if (!GITHUB_LOGIN || !WAKATIME_USER) throw new Error("set GITHUB_LOGIN and WAKATIME_USER");

/** GitHub's public contribution calendar (an HTML fragment that needs no token), oldest first. Every cell has `data-date` and a tooltip with the count ("2 contributions on November 16th.", "No contributions on ..."). */
export function parseGithubCalendar(html) {
  const tips = new Map();
  for (const m of html.matchAll(/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>\s*([^<]*?)\s*</g)) {
    const n = /^(\d[\d,]*)\s+contributions?\b/.exec(m[2]);
    tips.set(m[1], n ? Number(n[1].replace(/,/g, "")) : 0);
  }
  const days = [];
  for (const m of html.matchAll(/<td\b[^>]*>/g)) {
    const date = /\bdata-date="(\d{4}-\d{2}-\d{2})"/.exec(m[0])?.[1];
    const id = /\bid="([^"]+)"/.exec(m[0])?.[1];
    if (date && /\bdata-level="\d"/.test(m[0])) days.push({ date, value: (id && tips.get(id)) || 0 });
  }
  return days.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** WakaTime's public days (what a public profile page itself loads), in hours, oldest first. */
export function parseWakatimeDays(json) {
  const days = json?.data?.days;
  if (!Array.isArray(days)) throw new Error("wakatime: no days in the answer");
  return days.filter((d) => typeof d?.date === "string" && Number.isFinite(d?.total)).map((d) => ({ date: d.date, value: Math.round((d.total / 3600) * 100) / 100 })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": "neon-activity-graph-demo" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const top = parseGithubCalendar(await (await get(`https://github.com/users/${encodeURIComponent(GITHUB_LOGIN)}/contributions`)).text());
  const bottom = parseWakatimeDays(await (await get(`https://wakatime.com/api/v1/users/${encodeURIComponent(WAKATIME_USER)}/insights/days/public`)).json());
  if (top.length < 300) throw new Error(`github: only ${top.length} days, did the page change?`);
  if (bottom.length < 300) throw new Error(`wakatime: only ${bottom.length} days`);
  const out = process.argv[2] ?? "activity.json";
  await writeFile(out, `${JSON.stringify({ generatedAt: new Date().toISOString(), top: { label: "Contributions", unit: "contributions", days: top }, bottom: { label: "Coding time", unit: "h", days: bottom } })}\n`);
  console.log(`${out}: ${top.length} GitHub days, ${bottom.length} WakaTime days`);
}
