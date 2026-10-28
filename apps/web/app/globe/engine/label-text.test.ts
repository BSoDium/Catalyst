import { afterEach, describe, expect, it } from "vitest";
import { LABEL_H_ONE, LABEL_H_TWO, LABEL_TYPE, MIN_LABEL_CHARS, chipText, labelText, labelVariants, runFont, runWidth, setTextMeter, type TextMeter } from "./label-text";
import { groupSub, placeSub, subText } from "./label-sub";

/** A meter where every character is 6 px (name) or 5 px (sub): easy to reason about. */
const fixed: TextMeter = { width: (t, run) => Array.from(t).length * (run === "name" ? 6 : 5) };
afterEach(() => setTextMeter(null));

describe("label size (CSS px, measured once per string)", () => {
  it("a one-line plate is the name plus padX on both sides, one name line plus padY above and below", () => {
    setTextMeter(fixed);
    const t = labelText("Paris", null);
    const w = runWidth("Paris", "name");
    expect(t.nameW).toBe(w);
    expect(t.w).toBe(w + 2 * LABEL_TYPE.padX);
    expect(t.h).toBe(LABEL_H_ONE);
    expect(LABEL_H_ONE).toBe(LABEL_TYPE.name.lineHeight + 2 * LABEL_TYPE.padY);
    expect(t.sub).toBeNull();
    expect(t.subW).toBe(0);
  });
  it("tracking is added per character and the width is rounded up to half a px (a label never measures narrower than it is)", () => {
    setTextMeter(fixed);
    const w = runWidth("Paris", "name");
    expect(w).toBeGreaterThanOrEqual(5 * 6 + 5 * LABEL_TYPE.name.size * LABEL_TYPE.name.tracking);
    expect(w * 2).toBe(Math.round(w * 2));
  });
  it("a second line makes the plate two lines high and as wide as the wider line", () => {
    setTextMeter(fixed);
    const short = labelText("Metropolitan Germany", "10 places"); // name wider than its second line
    expect(short.h).toBe(LABEL_H_TWO);
    expect(LABEL_H_TWO).toBe(LABEL_H_ONE + LABEL_TYPE.sub.lineHeight);
    expect(short.w).toBe(runWidth("Metropolitan Germany", "name") + 2 * LABEL_TYPE.padX);
    const long = labelText("Lyon", "France · 2 articles · 1 artwork · 3 software"); // second line wider than its name
    expect(long.w).toBe(runWidth("France · 2 articles · 1 artwork · 3 software", "sub") + 2 * LABEL_TYPE.padX);
    expect(long.w).toBeGreaterThan(labelText("Lyon", null).w);
    expect(long.subW).toBeGreaterThan(long.nameW);
  });
  it("the type: the name about 14 px and weight 500 to 600, the second line about 11 px, regular or lighter; 3 px from the box, the plate's padding outside the box's edge so the text is on it", () => {
    expect(LABEL_TYPE.name.size).toBe(14);
    expect(LABEL_TYPE.name.weight).toBeGreaterThanOrEqual(500);
    expect(LABEL_TYPE.name.weight).toBeLessThanOrEqual(600);
    expect(LABEL_TYPE.sub.size).toBe(11);
    expect(LABEL_TYPE.sub.weight).toBeLessThanOrEqual(400);
    expect(LABEL_TYPE.sub.size).toBeLessThan(LABEL_TYPE.name.size);
    expect(LABEL_TYPE.boxGap).toBe(3);
    // the text is flush with the box's edge: the plate's padding hangs outside it by exactly that padding (and a plate beside its box, its top padding)
    expect(LABEL_TYPE.bleed).toBe(LABEL_TYPE.padX);
    expect(LABEL_TYPE.bleedY).toBe(LABEL_TYPE.padY);
    expect(LABEL_TYPE.padX).toBeGreaterThanOrEqual(5);
    // the plate has a sharp edge (2026-10-28): no feather token any more
    expect("feather" in LABEL_TYPE).toBe(false);
    expect(runFont("name", "system-ui")).toBe(`${LABEL_TYPE.name.weight} ${LABEL_TYPE.name.size}px system-ui`);
    expect(runFont("sub", "system-ui")).toBe(`${LABEL_TYPE.sub.weight} ${LABEL_TYPE.sub.size}px system-ui`);
  });
  it("the pixel text of the map keeps its own chip text", () => {
    expect(chipText(1)).toBe("1 entry");
    expect(chipText(2)).toBe("2 entries");
  });
  it("without a canvas a deterministic approximation measures (tests, a server): the same string, the same width", () => {
    expect(runWidth("Houston", "name")).toBe(runWidth("Houston", "name"));
    expect(runWidth("Houston", "name")).toBeGreaterThan(runWidth("Hou", "name"));
    expect(runWidth("Wwwwww", "name")).toBe(runWidth("llllll", "name")); // monospace
    expect(runWidth("Houston", "name")).toBeGreaterThan(runWidth("Houston", "sub"));
  });
});

describe("shorter ways of writing a label: the entries first, then the second line's height, then an ellipsis that keeps the second line, never below MIN_LABEL_CHARS", () => {
  const whole = placeSub("France", { article: 2, artwork: 1 });
  it("a place with a country and entries: whole, one line (the whole name, the same width, a line lower), then truncations that keep the country before they lose it", () => {
    setTextMeter(fixed);
    const v = labelVariants("Extraordinarily long place name", whole);
    expect(v[0]).toMatchObject({ name: "Extraordinarily long place name", sub: "France · 2 articles · 1 artwork", h: LABEL_H_TWO });
    // the name is wider than every second line: dropping the entries alone would change nothing (same plate), so that step is skipped
    expect(v[1]).toMatchObject({ name: "Extraordinarily long place name", sub: null, h: LABEL_H_ONE });
    expect(v[0]!.w).toBe(v[1]!.w); // the second line's height is what the first step frees
    // no variant is beaten by an earlier one in both width and height (a variant at least as wide AND as high as one before it is never kept)
    for (let k = 1; k < v.length; k++) for (let j = 0; j < k; j++) expect(v[j]!.w <= v[k]!.w && v[j]!.h <= v[k]!.h).toBe(false);
    // the whole name goes on one line before it is truncated at all: the second line is the last thing the whole name gives up
    const firstCut = v.findIndex((x) => x.name.endsWith("…"));
    expect(v.slice(0, firstCut).every((x) => x.name === "Extraordinarily long place name")).toBe(true);
    expect(v.slice(firstCut).every((x) => x.name.endsWith("…"))).toBe(true);
    // a truncated name keeps its second line (the country, its entries gone first) at every length where the plate is no wider for it, before it loses it
    const cuts = v.slice(firstCut);
    expect(cuts[0]).toMatchObject({ sub: "France", h: LABEL_H_TWO });
    for (const names of new Set(cuts.map((x) => x.name))) {
      const same = cuts.filter((x) => x.name === names);
      if (same.length > 1) {
        expect(same[0]!.sub).toBe("France");
        expect(same[1]!.sub).toBeNull();
        expect(same[1]!.w).toBe(same[0]!.w);
      }
    }
    expect(v[v.length - 1]!.name.endsWith("…")).toBe(true);
  });
  it("a shortened name never loses its second line while the plate is narrower with it: the one-line way of a name comes right after the way with the line", () => {
    setTextMeter(fixed);
    const v = labelVariants("Barcelona del Vallès", placeSub("Spain"));
    const cuts = v.filter((x) => x.name.endsWith("…"));
    expect(cuts.length).toBeGreaterThan(4);
    expect(cuts[0]!.sub).toBe("Spain");
    // every truncated name that has a one-line way also has the two-line way, before it
    for (const x of cuts.filter((c) => c.sub === null)) {
      const twin = v.findIndex((c) => c.name === x.name && c.sub === "Spain");
      expect(twin).toBeGreaterThan(-1);
      expect(twin).toBeLessThan(v.indexOf(x));
    }
  });
  it("when the second line is wider than the shortened name it adds nothing: the truncations that follow are one line", () => {
    setTextMeter(fixed);
    const v = labelVariants("Extraordinary", placeSub("A very long second line that is wider than the name"));
    expect(v[0]!.sub).not.toBeNull();
    expect(v[1]).toMatchObject({ name: "Extraordinary", sub: null });
    const rest = v.slice(2);
    expect(rest.length).toBeGreaterThan(2);
    expect(rest.every((x) => x.sub === null && x.name.endsWith("…"))).toBe(true);
  });
  it("a short name over a long second line: the second line's parts go first and each step really narrows the plate", () => {
    setTextMeter(fixed);
    const v = labelVariants("Lyon", placeSub("France", { article: 2, artwork: 1, project: 3 }));
    expect(v.map((x) => x.sub)).toEqual(["France · 2 articles · 1 artwork · 3 software", "France", null]);
    expect(v[1]!.w).toBeLessThan(v[0]!.w);
  });
  it("a group: its places and entries, then its places alone, then the name alone", () => {
    setTextMeter(fixed);
    const v = labelVariants("Western Europe", groupSub(6, { article: 1 }));
    expect(v.map((x) => x.sub).slice(0, 3)).toEqual(["6 places · 1 article", "6 places", null]);
    expect(subText(groupSub(6, { article: 1 }))).toBe("6 places · 1 article");
  });
  it("a place with no country and no entries is one line and a short name is never truncated", () => {
    setTextMeter(fixed);
    const v = labelVariants("Lisbon", null);
    expect(v[0]!.sub).toBeNull();
    expect(v[0]!.h).toBe(LABEL_H_ONE);
    expect(v.length).toBe(1);
  });
  it("a second line that adds nothing to the plate (the name is wider) still has its own variant, a line shorter", () => {
    setTextMeter(fixed);
    const v = labelVariants("Lisbon", placeSub("Portugal"));
    expect(v.map((x) => [x.sub, x.h])).toEqual([["Portugal", LABEL_H_TWO], [null, LABEL_H_ONE]]);
  });
  it("truncation keeps at least MIN_LABEL_CHARS characters, the ellipsis included", () => {
    setTextMeter(fixed);
    const v = labelVariants("Extraordinarily long place name", null);
    expect(v.length).toBeGreaterThan(3);
    for (const x of v) expect(Array.from(x.name).length).toBeGreaterThanOrEqual(MIN_LABEL_CHARS);
    expect(Array.from(v[v.length - 1]!.name).length).toBe(MIN_LABEL_CHARS);
  });
  it("a name is cut before a trailing comma or space: 'London,' never ends a truncation", () => {
    setTextMeter(fixed);
    for (const x of labelVariants("London, Ontario Province", null)) expect(x.name).not.toMatch(/[\s,]…$/);
  });
  it("a truncation is always narrower than the whole name even when the ellipsis is a wide glyph", () => {
    setTextMeter({ width: (t) => Array.from(t).reduce((s, c) => s + (c === "…" ? 14 : 6), 0) });
    const v = labelVariants("Abcdefghij", null);
    for (let k = 1; k < v.length; k++) expect(v[k]!.w).toBeLessThan(v[0]!.w);
  });
  it("cached: the same list for the same text until the meter changes", () => {
    setTextMeter(fixed);
    expect(labelVariants("Northgate", null)).toBe(labelVariants("Northgate", null));
    const a = labelVariants("Northgate", null);
    setTextMeter({ width: () => 40 });
    expect(labelVariants("Northgate", null)).not.toBe(a);
  });
});
