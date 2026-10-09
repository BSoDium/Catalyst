import { describe, expect, it } from "vitest";
import { collectTags, filterByTag, groupByYear, shouldGroupByYear, parseTagFilter, tagSearch, yearOf } from "./entry-list";

const e = (slug: string, tags: string[], date?: string) => ({ slug, tags, ...(date ? { date } : {}) });

describe("collectTags", () => {
  it("counts entries per tag, most used first then A to Z", () => {
    const tags = collectTags([e("a", ["rail", "bus"]), e("b", ["rail", "peru"]), e("c", ["bus", "rail"]), e("d", [])]);
    expect(tags).toEqual([
      { tag: "rail", count: 3 },
      { tag: "bus", count: 2 },
      { tag: "peru", count: 1 },
    ]);
  });
  it("merges case variants and counts an entry once per tag", () => {
    expect(collectTags([e("a", ["Rail", "rail", " RAIL "]), e("b", ["rail"])])).toEqual([{ tag: "Rail", count: 2 }]);
  });
  it("ignores empty tags", () => {
    expect(collectTags([e("a", ["", "  "])])).toEqual([]);
  });
});

describe("parseTagFilter", () => {
  const known = collectTags([e("a", ["night-trains", "Rail"])]);
  it("returns the tag as the entries spell it", () => {
    expect(parseTagFilter("?tag=rail", known)).toBe("Rail");
    expect(parseTagFilter(new URLSearchParams("tag=NIGHT-TRAINS"), known)).toBe("night-trains");
  });
  it("ignores a missing, unknown or empty tag", () => {
    expect(parseTagFilter("", known)).toBeNull();
    expect(parseTagFilter("?tag=nope", known)).toBeNull();
    expect(parseTagFilter("?tag=", known)).toBeNull();
    expect(parseTagFilter("?tag=%3Cscript%3E", known)).toBeNull();
  });
});

describe("tagSearch", () => {
  it("sets, replaces and clears the tag, keeping other parameters", () => {
    expect(tagSearch("", "rail")).toBe("?tag=rail");
    expect(tagSearch("?tag=bus", "rail")).toBe("?tag=rail");
    expect(tagSearch("?tag=bus&x=1", null)).toBe("?x=1");
    expect(tagSearch("?tag=bus", null)).toBe("");
    expect(tagSearch("", "high altitude")).toBe("?tag=high+altitude");
  });
});

describe("filterByTag", () => {
  const items = [e("a", ["rail"]), e("b", ["Bus"]), e("c", ["bus", "rail"])];
  it("keeps the entries with the tag, in order, case-insensitively", () => {
    expect(filterByTag(items, "BUS").map((i) => i.slug)).toEqual(["b", "c"]);
    expect(filterByTag(items, "none")).toEqual([]);
  });
  it("returns everything for no tag, as a copy", () => {
    const all = filterByTag(items, null);
    expect(all).toEqual(items);
    expect(all).not.toBe(items);
  });
});

describe("yearOf", () => {
  it("reads partial ISO dates only", () => {
    expect(yearOf("2024")).toBe(2024);
    expect(yearOf("2024-06")).toBe(2024);
    expect(yearOf("2024-06-19")).toBe(2024);
    expect(yearOf("June 2024")).toBeNull();
    expect(yearOf("2024-6")).toBeNull();
    expect(yearOf(undefined)).toBeNull();
  });
});

describe("groupByYear", () => {
  it("groups newest year first, newest first inside, undated last", () => {
    const groups = groupByYear([e("a", [], "2022"), e("b", [], "2026-03-14"), e("c", []), e("d", [], "2026-04"), e("e", [], "2022-10"), e("f", [], "garbage")]);
    expect(groups.map((g) => [g.key, g.items.map((i) => i.slug)])).toEqual([
      ["2026", ["d", "b"]],
      ["2022", ["e", "a"]],
      ["undated", ["c", "f"]],
    ]);
    expect(groups.map((g) => g.year)).toEqual([2026, 2022, null]);
  });
  it("is empty for no entries and keeps authored order for equal dates", () => {
    expect(groupByYear([])).toEqual([]);
    expect(groupByYear([e("x", [], "2024"), e("y", [], "2024")])[0]!.items.map((i) => i.slug)).toEqual(["x", "y"]);
  });
});

describe("shouldGroupByYear", () => {
  const group = (n: number, year: number | null = 2000) => ({ key: String(year), year, items: Array.from({ length: n }, () => ({})) });
  it("groups when there are several years with two entries or more on average", () => {
    expect(shouldGroupByYear([group(3, 2026), group(2, 2024)])).toBe(true);
    expect(shouldGroupByYear([group(5, 2026), group(1, 2024), group(2, 2021)])).toBe(true);
  });
  it("does not group a single year, nothing, or a timeline of single entries", () => {
    expect(shouldGroupByYear([])).toBe(false);
    expect(shouldGroupByYear([group(6, 2026)])).toBe(false);
    expect(shouldGroupByYear([group(1, 2026), group(1, 2024), group(1, 2021)])).toBe(false);
    expect(shouldGroupByYear([group(2, 2026), group(1, 2024), group(1, 2021)])).toBe(false);
  });
});
