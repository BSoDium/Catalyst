import { afterEach, describe, expect, it } from "vitest";
import { LABEL_H, LABEL_TYPE, MIN_LABEL_CHARS, chipText, expandedLabel, labelText, labelVariants, runFont, runWidth, setTextMeter, type TextMeter } from "./label-text";

/** A meter where every character is 6 px (name) or 5 px (count): easy to reason about. */
const fixed: TextMeter = { width: (t, run) => Array.from(t).length * (run === "name" ? 6 : 5) };
afterEach(() => setTextMeter(null));

describe("label size (CSS px, measured once per string)", () => {
  it("a place's plate is its name plus padX on both sides, one line high", () => {
    setTextMeter(fixed);
    const t = labelText("Paris", null);
    const w = runWidth("Paris", "name");
    expect(t.nameW).toBe(w);
    expect(t.w).toBe(w + 2 * LABEL_TYPE.padX);
    expect(t.h).toBe(LABEL_H);
    expect(LABEL_H).toBe(LABEL_TYPE.lineHeight + 2 * LABEL_TYPE.padY);
    expect(t.chip).toBeNull();
  });
  it("tracking is added per character and the width is rounded up to half a px (a label never measures narrower than it is)", () => {
    setTextMeter(fixed);
    const w = runWidth("Paris", "name");
    expect(w).toBeGreaterThanOrEqual(5 * 6 + 5 * LABEL_TYPE.name.size * LABEL_TYPE.name.tracking);
    expect(w * 2).toBe(Math.round(w * 2));
  });
  it("a group's counter is a separate run after a gap, in its own (smaller, lighter) type; the plate just widens", () => {
    setTextMeter(fixed);
    const t = labelText("Germany", chipText(10));
    expect(t.chipX).toBe(LABEL_TYPE.padX + runWidth("Germany", "name") + LABEL_TYPE.gap);
    expect(t.w).toBe(t.chipX + runWidth("10 entries", "count") + LABEL_TYPE.padX);
    expect(t.h).toBe(labelText("Germany", null).h);
    expect(LABEL_TYPE.count.weight).toBeLessThan(LABEL_TYPE.name.weight);
    expect(LABEL_TYPE.count.size).toBeLessThan(LABEL_TYPE.name.size);
  });
  it("singular and plural", () => {
    expect(chipText(1)).toBe("1 entry");
    expect(chipText(2)).toBe("2 entries");
    expect(chipText(146)).toBe("146 entries");
  });
  it("is thin, readable type: 12 to 14 px, weight 400 to 500 for the name and lighter for the counter, room around the text", () => {
    expect(LABEL_TYPE.name.size).toBeGreaterThanOrEqual(12);
    expect(LABEL_TYPE.name.size).toBeLessThanOrEqual(14);
    expect(LABEL_TYPE.boxGap).toBeGreaterThanOrEqual(6);
    expect(LABEL_TYPE.padX).toBeGreaterThanOrEqual(5);
    expect(LABEL_TYPE.name.weight).toBeLessThanOrEqual(500);
    expect(LABEL_TYPE.count.weight).toBeLessThan(400);
    expect(runFont("name", "system-ui")).toBe(`${LABEL_TYPE.name.weight} ${LABEL_TYPE.name.size}px system-ui`);
  });
  it("without a canvas a deterministic approximation measures (tests, a server): the same string, the same width", () => {
    expect(runWidth("Houston", "name")).toBe(runWidth("Houston", "name"));
    expect(runWidth("Houston", "name")).toBeGreaterThan(runWidth("Hou", "name"));
    expect(runWidth("Wwwwww", "name")).toBe(runWidth("llllll", "name")); // monospace
  });
});

describe("shorter ways of writing a label: the counter first, then an ellipsis, never below MIN_LABEL_CHARS", () => {
  it("a group's whole label comes first, then the name alone, then truncations, each narrower than the one before", () => {
    setTextMeter(fixed);
    const v = labelVariants("Western Europe", chipText(6));
    expect(v[0]).toMatchObject({ name: "Western Europe", chip: "6 entries" });
    expect(v[1]).toMatchObject({ name: "Western Europe", chip: null });
    for (let k = 1; k < v.length; k++) expect(v[k]!.w).toBeLessThan(v[k - 1]!.w);
    expect(v[v.length - 1]!.name.endsWith("…")).toBe(true);
  });
  it("a place has no counter variant", () => {
    setTextMeter(fixed);
    const v = labelVariants("Lisbon", null);
    expect(v[0]!.chip).toBeNull();
    expect(v.length).toBe(1); // six characters or less: never truncated
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
    expect(labelVariants("Marrakesh", null)).toBe(labelVariants("Marrakesh", null));
    const a = labelVariants("Marrakesh", null);
    setTextMeter({ width: () => 40 });
    expect(labelVariants("Marrakesh", null)).not.toBe(a);
  });
});

describe("expanded label (hovered, focused, selected): the name with its country", () => {
  it("'Name, Country' with the counter when it has one, and the name alone without a known country", () => {
    setTextMeter(fixed);
    expect(expandedLabel("Houston", "United States", null).name).toBe("Houston, United States");
    expect(expandedLabel("Houston", null, null).name).toBe("Houston");
    expect(expandedLabel("Europe", null, chipText(12))).toMatchObject({ name: "Europe", chip: "12 entries" });
  });
  it("is wider than the label at rest, never shortened", () => {
    setTextMeter(fixed);
    expect(expandedLabel("Houston", "United States", null).w).toBeGreaterThan(labelVariants("Houston", null)[0]!.w);
  });
});
