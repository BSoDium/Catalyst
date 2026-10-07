import { describe, expect, it } from "vitest";
import { FONT_CAP, FONT_X_HEIGHT, forEachInk, glyphFor, measureText } from "./pixel-font";
import { rowsToRepeat, stretchedHeight } from "./stretch";
import { TINY5_DATA } from "./tiny5-data";

const art = (ch: string): string[] => glyphFor(ch).rows.map((r) => r.toString(2).padStart(glyphFor(ch).w, "0").replace(/0/g, ".").replace(/1/g, "#"));

/** Tiny5's own glyph (before the stretch) as bit rows. */
function raw(ch: string) {
  const cp = ch.codePointAt(0)!.toString(16);
  const e = TINY5_DATA.split(";").find((x) => x.startsWith(`${cp}:`))!;
  const [, adv, left, top, w, rows] = e.split(":");
  return { adv: +adv!, left: +left!, top: +top!, w: +w!, rows: rows ? rows.split(",").map((h) => parseInt(h, 16)) : [] };
}

describe("the taller type", () => {
  it("capitals are 7 rows, lowercase 5, ascenders 7: from Tiny5's 5, 4 and 5", () => {
    expect(stretchedHeight(5)).toBe(7);
    expect(stretchedHeight(4)).toBe(5);
    expect(raw("H").rows).toHaveLength(5);
    expect(glyphFor("H").rows).toHaveLength(FONT_CAP);
    expect(glyphFor("x").rows).toHaveLength(FONT_X_HEIGHT);
    expect(glyphFor("b").rows).toHaveLength(FONT_CAP);
    expect(glyphFor("0").rows).toHaveLength(FONT_CAP);
  });
  it("widths, advances and offsets are Tiny5's: only rows are added", () => {
    for (const ch of "AHbgeimoSwxyÁõ") {
      const r = raw(ch);
      const g = glyphFor(ch);
      expect([g.adv, g.left, g.w], ch).toEqual([r.adv, r.left, r.w]);
      expect(g.rows.length).toBeGreaterThanOrEqual(r.rows.length);
    }
  });
  it("a descender stays as drawn, below the baseline", () => {
    for (const ch of "gjpqy") expect(glyphFor(ch).rows.length - glyphFor(ch).top, ch).toBe(raw(ch).rows.length - raw(ch).top);
  });
  it("the bars of E, B and e stay one cell thick: only rows of stems are repeated", () => {
    expect(art("E")).toEqual(["####", "#...", "#...", "###.", "#...", "#...", "####"]);
    expect(art("H")).toEqual(["#..#", "#..#", "#..#", "####", "#..#", "#..#", "#..#"]);
    // e: the bars (rows 1 and 3 of 4... the curve apex and the crossbar) are not duplicated
    const e = art("e");
    expect(e).toHaveLength(5);
    expect(e.filter((r) => r === "###")).toHaveLength(1);
  });
  it("no blank row is added inside a glyph: the gap of an i stays one row", () => {
    expect(art("i")).toEqual(["#", ".", "#", "#", "#", "#", "#"]);
    expect(art("!").filter((r) => r === ".")).toHaveLength(1);
  });
  it("a letter and its accented form share the body: the same rows are repeated", () => {
    const a = art("A");
    const acute = art("Á");
    expect(acute.slice(acute.length - a.length)).toEqual(a);
    const o = art("o");
    const ouml = art("ö");
    expect(ouml.slice(ouml.length - o.length)).toEqual(o);
  });
  it("the label metrics follow: a capital reaches FONT_CAP rows above the baseline, a name with an i dot as well", () => {
    expect(measureText("Houston").top).toBe(FONT_CAP);
    expect(measureText("Liège").top).toBeGreaterThanOrEqual(FONT_CAP);
    const ys: number[] = [];
    forEachInk("H", 0, 20, (_, y) => ys.push(y));
    expect(Math.min(...ys)).toBe(20 - FONT_CAP);
    expect(Math.max(...ys)).toBe(19);
  });
});

describe("rowsToRepeat", () => {
  it("never picks a bar when a stem row is available, spreads the rows and returns distinct ascending indices", () => {
    // H: stems, stems, bar, stems, stems
    const h = [0b1001, 0b1001, 0b1111, 0b1001, 0b1001];
    const pick = rowsToRepeat(h, 4, 2);
    expect(pick).toHaveLength(2);
    expect(pick).not.toContain(2);
    expect(new Set(pick).size).toBe(2);
    expect([...pick].sort((a, b) => a - b)).toEqual(pick);
  });
  it("nothing to add: nothing returned", () => {
    expect(rowsToRepeat([1, 1, 1], 1, 0)).toEqual([]);
  });
});
