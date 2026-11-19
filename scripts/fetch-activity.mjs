#!/usr/bin/env node
// Fetches the owner's public activity (no token): GitHub's contribution calendar and WakaTime's public days, and writes `activity.json` (`node scripts/fetch-activity.mjs <out>`).
// The scheduled workflow runs it and publishes the file to the `data` branch, so the page shows fresh numbers without a deploy. A failed fetch exits non-zero and writes nothing: the last good file stays.
import { writeFile } from "node:fs/promises";
import { parseGithubCalendar, parseWakatimeDays } from "./lib/activity.mjs";

const GITHUB_LOGIN = "BSoDium";
const WAKATIME_USER = "0025b5dc-508a-41b5-ac23-f122137a2995";

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": "catalyst-activity-fetch" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res;
}

const github = parseGithubCalendar(await (await get(`https://github.com/users/${GITHUB_LOGIN}/contributions`)).text());
const wakatime = parseWakatimeDays(await (await get(`https://wakatime.com/api/v1/users/${WAKATIME_USER}/insights/days/public`)).json());
if (github.length < 300) throw new Error(`github: only ${github.length} days, the page changed?`);
if (wakatime.length < 300) throw new Error(`wakatime: only ${wakatime.length} days`);

const out = process.argv[2] ?? "activity.json";
await writeFile(out, `${JSON.stringify({ generatedAt: new Date().toISOString(), github, wakatime })}\n`);
console.log(`${out}: ${github.length} GitHub days, ${wakatime.length} WakaTime days`);
