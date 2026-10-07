import { describe, expect, it } from "vitest";
import { formatDates } from "./dates";

describe("formatDates", () => {
  it("returns null without dates", () => {
    expect(formatDates(undefined)).toBeNull();
  });
  it("prefers the authored label verbatim", () => {
    expect(formatDates({ label: "Spring 2024", start: "2024-03", end: "2024-05" })).toEqual({
      text: "Spring 2024",
      dateTime: "2024-03",
    });
  });
  it("joins a range as written, without reformatting", () => {
    expect(formatDates({ start: "2024-03", end: "2024-04-12" })).toEqual({ text: "2024-03–2024-04-12", dateTime: "2024-03" });
  });
  it("collapses identical start and end", () => {
    expect(formatDates({ start: "2024", end: "2024" })?.text).toBe("2024");
  });
  it("handles a single bound", () => {
    expect(formatDates({ start: "2023-07" })).toEqual({ text: "2023-07", dateTime: "2023-07" });
    expect(formatDates({ end: "2023-07" })).toEqual({ text: "until 2023-07", dateTime: "2023-07" });
  });
});
