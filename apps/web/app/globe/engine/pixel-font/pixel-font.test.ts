import { describe, expect, it } from "vitest";
import { FONT_CAP, FONT_X_HEIGHT, emboldened, forEachInk, glyphFor, glyphWeight, hasOwnGlyph, measureText, pixelAt, usesFallback } from "./pixel-font";
import { TINY5_DATA } from "./tiny5-data";

/** The ink of a string as ASCII art, rows from the topmost to the lowest, columns from the leftmost. */
function ascii(text: string, bold = false): string[] {
  const pts: [number, number][] = [];
  forEachInk(text, 0, 20, (x, y) => pts.push([x, y]), bold);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const rows = Array.from({ length: Math.max(...ys) - y0 + 1 }, () => Array(Math.max(...xs) - x0 + 1).fill("."));
  for (const [x, y] of pts) rows[y - y0]![x - x0] = "#";
  return rows.map((r) => r.join(""));
}

describe("the baked font", () => {
  it("is Tiny5 made taller: 7 px capitals, 5 px x-height, on the pixel grid", () => {
    expect(glyphFor("H").top).toBe(FONT_CAP);
    expect(glyphFor("H").rows.length).toBe(FONT_CAP);
    expect(glyphFor("x").top).toBe(FONT_X_HEIGHT);
    expect(glyphFor("x").rows.length).toBe(FONT_X_HEIGHT);
  });
  it("every glyph is a clean bitmap: rows fit the width, integers, no stray bits", () => {
    for (const entry of TINY5_DATA.split(";")) {
      const [cp, adv, left, top, w, rows] = entry.split(":");
      const width = +w!;
      expect(Number.isInteger(+adv!) && Number.isInteger(+left!) && Number.isInteger(+top!), cp).toBe(true);
      for (const hex of rows ? rows.split(",") : []) expect(parseInt(hex, 16), cp).toBeLessThan(2 ** width);
    }
  });
  it("one glyph pixel is one cell: the drawing is whole integer cells and nothing else", () => {
    forEachInk("Paris Hà Nội", 3, 12, (x, y) => {
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
    });
    expect(ascii("l")).toEqual(Array(7).fill("#")); // a stem is exactly one pixel wide, as tall as a capital
    expect(ascii("I").every((r) => r.length <= 3)).toBe(true);
  });
});

describe("coverage of the owner's names", () => {
  const NAMES = ["Nikšić", "Chișinău", "Sighișoara", "Huế", "Málaga", "Bogotá", "Thessaloniki", "Hà Nội", "Đà Nẵng", "Reykjavík", "Łódź", "Tromsø", "Çanakkale", "Ñandú", "Zürich", "Ho Chi Minh City", "São Paulo", "Ōsaka", "Kraków", "Αθήνα", "Москва", "Київ"];
  it("none of them needs the system font", () => {
    for (const name of NAMES) for (const ch of name) expect(usesFallback(ch), `${name}: ${ch}`).toBe(false);
  });
  it("Latin Extended-A and B, Greek and Cyrillic are in the font itself", () => {
    for (const ch of "ĀāĂăĄąĆćČčĐđĒēĚěĞğİıŁłŃńŇňŌōŐőŒœŘřŚśŞşŠšŢţŤťŰűŹźŻżŽžȘșȚț") expect(hasOwnGlyph(ch), ch).toBe(true);
    for (const ch of "ΑΒΓΔΩαβγδω") expect(hasOwnGlyph(ch), ch).toBe(true);
    for (const ch of "АБВГДабвгд") expect(hasOwnGlyph(ch), ch).toBe(true);
  });
  it("other scripts fall back to the thresholded system font (a box without a DOM), flagged", () => {
    expect(usesFallback("ا")).toBe(true);
    expect(usesFallback("京")).toBe(true);
    const g = glyphFor("ا");
    expect(g.rows.length).toBeGreaterThan(0);
  });
});

describe("Vietnamese letters the font does not have are composed in its style", () => {
  const VIETNAMESE = "ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹơưĂÂÊÔƠƯẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ";
  it("every one has a bitmap and none uses the system font", () => {
    for (const ch of VIETNAMESE) {
      if (hasOwnGlyph(ch)) continue;
      const g = glyphFor(ch);
      expect(g.rows.length, ch).toBeGreaterThan(0);
      expect(usesFallback(ch), ch).toBe(false);
    }
  });
  it("a stacked mark sits above the circumflex: ế is taller than ê and the letter body is ê's", () => {
    const e = glyphFor("ê");
    const eh = glyphFor("ế");
    expect(eh.top).toBeGreaterThan(e.top);
    // the lower rows of ế are the rows of ê
    const lower = eh.rows.slice(eh.rows.length - e.rows.length);
    expect(lower).toEqual(e.rows);
  });
  it("a horn is one pixel to the right of the letter at its top: ơ is o plus a pixel, one pixel wider", () => {
    const o = glyphFor("o");
    const oh = glyphFor("ơ");
    expect(oh.w).toBe(o.w + 1);
    expect(oh.adv).toBe(o.adv + 1);
    let extra = 0;
    for (let y = 0; y < oh.rows.length; y++) for (let x = 0; x < oh.w; x++) if (pixelAt(oh, x, y) && x === oh.w - 1) extra++;
    expect(extra).toBe(1);
  });
  it("the dot below sits under the baseline, with a row of room", () => {
    const a = glyphFor("a");
    const aj = glyphFor("ạ");
    expect(aj.rows.length - aj.top).toBe(2);
    expect(aj.top).toBe(a.top);
  });
  it("Huế and Nội measure like their letters, taller than a plain word", () => {
    expect(measureText("Hue").top).toBe(FONT_CAP);
    expect(measureText("Huế").top).toBeGreaterThan(measureText("Hue").top);
    expect(measureText("Hà Nội").w).toBeGreaterThan(measureText("Ha Noi").w - 1);
  });
});

describe("metrics", () => {
  it("width is the ink extent; descenders add rows below the baseline; a line is at least cap high", () => {
    expect(measureText("").w).toBe(0);
    expect(measureText("HHH").bottom).toBe(0);
    expect(measureText("gjy").bottom).toBeGreaterThan(0);
    expect(measureText("x").top).toBe(FONT_CAP);
    expect(measureText("Paris").w).toBeGreaterThan(measureText("Pari").w);
  });
});

describe("the bold weight: a 1-cell horizontal double strike of the one Tiny5 face", () => {
  it("every ink pixel also lights the cell to its right, unless that closes a one-pixel gap: stems are 2 px, counters stay open", () => {
    expect(ascii("l", true)).toEqual(Array(7).fill("##"));
    expect(ascii("H", true).length).toBe(ascii("H").length);
    for (const ch of "nouaeHmw") {
      const regular = glyphFor(ch);
      const bold = emboldened(regular);
      for (let y = 0; y < regular.rows.length; y++)
        for (let x = 0; x <= regular.w; x++) {
          const here = pixelAt(regular, x, y);
          const left = pixelAt(regular, x - 1, y);
          const closesGap = !here && pixelAt(regular, x + 1, y);
          expect(pixelAt(bold, x, y), `${ch} ${x},${y}`).toBe(here || (left && !closesGap));
        }
    }
    // the point of the rule: the counter of an o survives
    const o = ascii("o", true);
    expect(o.some((row) => /#\.#/.test(row))).toBe(true);
  });
  it("metrics stay consistent: one column wider and advance + 1 per glyph; measureText(bold) is the drawn extent", () => {
    for (const ch of "AHiltgŁø京") {
      const r = glyphFor(ch);
      const b = glyphWeight(ch, true);
      expect(b.adv, ch).toBe(r.adv + 1);
      expect(b.w, ch).toBe(r.rows.length ? r.w + 1 : 0);
      expect(b.top, ch).toBe(r.top);
    }
    for (const text of ["Paris", "Hà Nội", "Ho Chi Minh City", "Nikšić", "I", ""]) {
      const xs: number[] = [];
      forEachInk(text, 0, 20, (x) => xs.push(x), true);
      expect(measureText(text, true).w, text).toBe(xs.length ? Math.max(...xs) + 1 : 0);
      expect(measureText(text, true).top).toBe(measureText(text).top);
      expect(measureText(text, true).bottom).toBe(measureText(text).bottom);
      if (text.length > 1) expect(measureText(text, true).w, text).toBeGreaterThan(measureText(text).w);
    }
  });
  it("a cell is emitted once, so a translucent bold string is evenly translucent", () => {
    for (const text of ["Paris", "Hà Nội", "Tromsø", "Ho Chi Minh City"]) {
      const seen = new Set<string>();
      forEachInk(text, 0, 20, (x, y) => {
        const k = `${x},${y}`;
        expect(seen.has(k), `${text} ${k}`).toBe(false);
        seen.add(k);
      }, true);
    }
  });
  it("the regular weight is unchanged by the bold cache", () => {
    glyphWeight("a", true);
    expect(glyphFor("a").rows).toEqual(glyphWeight("a", false).rows);
    expect(ascii("l")).toEqual(Array(7).fill("#"));
  });
});
