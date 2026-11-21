import { describe, expect, it } from "vitest";
import { layoutMatrix } from "./layout";

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

