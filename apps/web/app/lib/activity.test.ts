import { describe, expect, it } from "vitest";
import { layoutMatrix } from "./activity";

describe("layoutMatrix", () => {
  it("puts Monday in column 0 and the last week at the end", () => {
    // 2026-11-19 is a Thursday
    const m = layoutMatrix([{ date: "2026-11-19", value: 4 }, { date: "2026-11-16", value: 1 }], "2026-11-19", 3);
    const thu = m.cells.find((c) => c.date === "2026-11-19")!;
    expect(thu).toMatchObject({ day: 3, week: 2, value: 4, t: 1 });
    expect(m.cells.find((c) => c.date === "2026-11-16")).toMatchObject({ day: 0, week: 2 });
    // no cell after the end date: the last week stops on the Thursday
    expect(m.cells.filter((c) => c.week === 2)).toHaveLength(4);
    expect(m.cells).toHaveLength(7 * 2 + 4);
  });
  it("scales by the square root of the busiest day", () => {
    const m = layoutMatrix([{ date: "2026-11-18", value: 1 }, { date: "2026-11-19", value: 4 }], "2026-11-19", 1);
    expect(m.cells.find((c) => c.date === "2026-11-18")!.t).toBeCloseTo(0.5);
  });
  it("is all zero for no data", () => {
    expect(layoutMatrix([], "2026-11-19", 2).cells.every((c) => c.t === 0)).toBe(true);
  });
});

import { isActivity } from "./activity";

describe("isActivity", () => {
  const days = (key: string) => Array.from({ length: 40 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, [key]: i }));
  it("accepts both series with enough days and refuses anything else", () => {
    expect(isActivity({ generatedAt: "x", github: days("count"), wakatime: days("seconds") })).toBe(true);
    expect(isActivity({ generatedAt: "x", github: days("count"), wakatime: [] })).toBe(false);
    expect(isActivity({ generatedAt: "x", github: days("seconds"), wakatime: days("seconds") })).toBe(false);
    expect(isActivity(null)).toBe(false);
  });
});

import { activityStats } from "./activity";

describe("activityStats", () => {
  it("adds the year up and finds the longest run of active days", () => {
    const github = [
      { date: "2026-11-01", count: 3, level: 1 },
      { date: "2026-11-02", count: 0, level: 0 },
      { date: "2026-11-03", count: 5, level: 2 },
      { date: "2026-11-04", count: 0, level: 0 },
    ];
    const wakatime = [
      { date: "2026-11-01", seconds: 3600 },
      { date: "2026-11-02", seconds: 3600 },
      { date: "2026-11-03", seconds: 0 },
      { date: "2026-11-04", seconds: 0 },
    ];
    const s = activityStats({ generatedAt: "x", github, wakatime });
    expect(s[0]).toEqual({ value: "8", label: "contributions", tone: "green" });
    expect(s[1]).toEqual({ value: "2", unit: "h", label: "coded", tone: "blue" });
    expect(s[2]).toEqual({ value: "3", unit: "days", label: "longest streak", tone: "plain" });
    expect(s[3]!.label).toBe("days active");
  });
  it("is empty for an empty file", () => {
    expect(activityStats({ generatedAt: "x", github: [], wakatime: [] })).toEqual([]);
  });
});

import { dayText, readableDay } from "./activity";

describe("day words", () => {
  it("reads a date and a day", () => {
    expect(readableDay("2026-11-19")).toBe("Thu 19 Nov 2026");
    expect(dayText({ date: "2026-11-19", contributions: 1, hours: 3.46 })).toBe("Thu 19 Nov 2026: 1 contribution, 3.5 h coded");
    expect(dayText({ date: "2026-11-19", contributions: 0, hours: 0 })).toContain("no coding");
  });
});
