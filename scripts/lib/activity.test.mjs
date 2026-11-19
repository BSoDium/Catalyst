import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGithubCalendar, parseWakatimeDays } from "./activity.mjs";

describe("parseGithubCalendar", () => {
  const html = `<td data-date="2026-11-02" id="contribution-day-component-0-1" data-level="2" class="x"></td>
<td data-date="2026-11-01" id="contribution-day-component-0-0" data-level="0" class="x"></td>
<tool-tip for="contribution-day-component-0-1" class="sr-only">1,204 contributions on November 2nd.</tool-tip>
<tool-tip for="contribution-day-component-0-0" class="sr-only">No contributions on November 1st.</tool-tip>`;
  it("reads the date, level and count of each cell, oldest first", () => {
    assert.deepEqual(parseGithubCalendar(html), [
      { date: "2026-11-01", count: 0, level: 0 },
      { date: "2026-11-02", count: 1204, level: 2 },
    ]);
  });
});

describe("parseWakatimeDays", () => {
  it("keeps the days with a total, oldest first", () => {
    assert.deepEqual(parseWakatimeDays({ data: { days: [{ date: "2026-11-02", total: 3600 }, { date: "2026-11-01", total: 0 }, { date: "x" }] } }), [
      { date: "2026-11-01", seconds: 0 },
      { date: "2026-11-02", seconds: 3600 },
    ]);
  });
  it("throws when the answer has no days", () => {
    assert.throws(() => parseWakatimeDays({}));
  });
});
