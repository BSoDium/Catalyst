import { describe, expect, it } from "vitest";
import { formatDates, formatEntryDate } from "./dates";

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

describe("formatEntryDate", () => {
  it("only swaps the separator of a partial ISO date, never completing it", () => {
    expect(formatEntryDate("2024-04-02")).toEqual({ text: "2024.04.02", dateTime: "2024-04-02" });
    expect(formatEntryDate("2022-11")).toEqual({ text: "2022.11", dateTime: "2022-11" });
    expect(formatEntryDate("2024")).toEqual({ text: "2024", dateTime: "2024" });
  });
  it("gives null for nothing or for something that is not a partial ISO date", () => {
    expect(formatEntryDate(undefined)).toBeNull();
    expect(formatEntryDate("")).toBeNull();
    expect(formatEntryDate("April 2024")).toBeNull();
    expect(formatEntryDate("2024-4-2")).toBeNull();
  });
});
