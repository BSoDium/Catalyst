import { describe, expect, it } from "vitest";
import { ENTRY_KINDS, countEntries, entriesText, groupSub, nodeEntryCounts, placeSub, placesText, subSteps, subText } from "./label-sub";

describe("the entries split by kind", () => {
  it("articles, then artworks, then software (the project kind); singular and plural; zero kinds left out", () => {
    expect(entriesText({ article: 2, artwork: 1, project: 3 })).toBe("2 articles · 1 artwork · 3 software");
    expect(entriesText({ project: 1 })).toBe("1 software");
    expect(entriesText({ artwork: 5, article: 1 })).toBe("1 article · 5 artworks"); // the table's order, not the data's
    expect(entriesText({ article: 0, artwork: 2, project: 0 })).toBe("2 artworks");
  });
  it("nothing linked is no text, never a zero", () => {
    expect(entriesText(undefined)).toBeNull();
    expect(entriesText({})).toBeNull();
    expect(entriesText({ article: 0 })).toBeNull();
  });
  it("a kind the table does not know is ignored until its row is added (poems later)", () => {
    expect(entriesText({ poem: 4 })).toBeNull();
    expect(entriesText({ poem: 4, article: 1 })).toBe("1 article");
    expect(ENTRY_KINDS.map((k) => k.kind)).toEqual(["article", "artwork", "project"]);
    for (const k of ENTRY_KINDS) expect(k.many.length).toBeGreaterThan(0);
  });
});

describe("the second line of a place and of a group", () => {
  it("a place: its country, then its entries", () => {
    expect(subText(placeSub("France", { article: 2, artwork: 1, project: 3 }))).toBe("France · 2 articles · 1 artwork · 3 software");
    expect(subText(placeSub("France", {}))).toBe("France");
    expect(subText(placeSub("France"))).toBe("France");
  });
  it("a place with entries but no known country says only the entries; with neither it has no second line", () => {
    expect(subText(placeSub(null, { article: 1 }))).toBe("1 article");
    expect(placeSub(null, {})).toBeNull();
    expect(placeSub(null)).toBeNull();
  });
  it("a group: its number of places, then the entries below it", () => {
    expect(subText(groupSub(12, { article: 2 }))).toBe("12 places · 2 articles");
    expect(subText(groupSub(12))).toBe("12 places");
    expect(placesText(1)).toBe("1 place");
    expect(subText(groupSub(0))).toBeNull();
  });
  it("the steps the planner may fall back to: whole, the lead alone, nothing; each a different text", () => {
    expect(subSteps(placeSub("France", { article: 2 }))).toEqual(["France · 2 articles", "France", null]);
    expect(subSteps(placeSub("France"))).toEqual(["France", null]);
    expect(subSteps(placeSub(null, { article: 2 }))).toEqual(["2 articles", null]);
    expect(subSteps(null)).toEqual([null]);
  });
});

describe("counting entries", () => {
  it("a list is counted per kind, each (kind, slug) once", () => {
    expect(countEntries([{ kind: "article", slug: "a" }, { kind: "article", slug: "a" }, { kind: "article", slug: "b" }, { kind: "project", slug: "a" }])).toEqual({ article: 2, project: 1 });
    expect(countEntries(undefined)).toEqual({});
  });
  it("a group counts the DISTINCT entries below it: one linked to two of its places counts once", () => {
    // 0 root group, 1 and 2 its places, 3 a place outside, 4 a subgroup of the root with place 5
    const parent = [-1, 0, 0, -1, 0, 4];
    const refs = [
      undefined,
      [{ kind: "article", slug: "x" }, { kind: "artwork", slug: "z" }],
      [{ kind: "article", slug: "x" }, { kind: "article", slug: "y" }],
      [{ kind: "article", slug: "w" }],
      undefined,
      [{ kind: "project", slug: "p" }],
    ];
    const counts = nodeEntryCounts(parent, refs);
    expect(counts[0]).toEqual({ article: 2, artwork: 1, project: 1 });
    expect(counts[1]).toEqual({ article: 1, artwork: 1 });
    expect(counts[2]).toEqual({ article: 2 });
    expect(counts[3]).toEqual({ article: 1 });
    expect(counts[4]).toEqual({ project: 1 });
    expect(counts[5]).toEqual({ project: 1 });
  });
  it("no entry anywhere: empty counts everywhere; a cycle in the parents cannot loop", () => {
    expect(nodeEntryCounts([-1, 0], [undefined, undefined])).toEqual([{}, {}]);
    expect(() => nodeEntryCounts([1, 0], [[{ kind: "article", slug: "a" }], undefined])).not.toThrow();
  });
});
