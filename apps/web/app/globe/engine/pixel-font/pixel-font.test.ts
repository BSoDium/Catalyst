import { describe, expect, it } from "vitest";
import { FONT_CAP, FONT_DESCENT, FONT_X_HEIGHT, forEachInk, glyphFor, hasOwnGlyph, measureText, pixelAt, usesFallback } from "./pixel-font";
import { PIXEL_FONT_DATA, PIXEL_FONT_EM } from "./pixel-font-data";

/** The ink of a string as ASCII art, rows from the topmost to the lowest, columns from the leftmost. */
function ascii(text: string): string[] {
  const pts: [number, number][] = [];
  forEachInk(text, 0, 20, (x, y) => pts.push([x, y]));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const rows = Array.from({ length: Math.max(...ys) - y0 + 1 }, () => Array(Math.max(...xs) - x0 + 1).fill("."));
  for (const [x, y] of pts) rows[y - y0]![x - x0] = "#";
  return rows.map((r) => r.join(""));
}

describe("the baked font", () => {
  it("is Fusion Pixel 10px: 7 px capitals, 5 px x-height, a 10 px em, on the pixel grid", () => {
    expect(PIXEL_FONT_EM).toBe(10);
    expect(glyphFor("H").top).toBe(FONT_CAP);
    expect(glyphFor("H").rows.length).toBe(FONT_CAP);
    expect(glyphFor("x").top).toBe(FONT_X_HEIGHT);
    expect(glyphFor("x").rows.length).toBe(FONT_X_HEIGHT);
  });
  it("every glyph is a clean bitmap: rows fit the width, integers, no stray bits", () => {
    for (const entry of PIXEL_FONT_DATA.split(";")) {
      const [cp, adv, left, top, w, rows] = entry.split(":");
      const width = +w!;
      expect(Number.isInteger(+adv!) && Number.isInteger(+left!) && Number.isInteger(+top!), cp).toBe(true);
      for (const hex of rows ? rows.split(",") : []) expect(parseInt(hex, 16), cp).toBeLessThan(2 ** width);
    }
  });
  it("one glyph pixel is one cell: the drawing is whole integer cells and nothing else; a stem is one pixel wide", () => {
    forEachInk("Paris Hà Nội", 3, 12, (x, y) => {
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
    });
    expect(ascii("I").length).toBe(FONT_CAP);
    // the stem of an l is a single column
    const l = glyphFor("l");
    const stem = Array.from({ length: l.w }, (_, x) => Array.from({ length: l.rows.length }, (__, y) => pixelAt(l, x, y)).filter(Boolean).length);
    expect(stem.filter((n) => n >= l.rows.length - 2).length).toBe(1);
  });
  it("it is proportional and not condensed: an average letter advances 5 cells, a capital 6, the owner's example is about a hundred cells wide", () => {
    expect(glyphFor("i").adv).toBeLessThan(glyphFor("m").adv);
    expect(glyphFor("e").adv).toBeGreaterThanOrEqual(5);
    expect(glyphFor("H").adv).toBeGreaterThanOrEqual(6);
    expect(measureText("London, United Kingdom").w).toBeGreaterThan(100);
  });
  it("no letter descends below the metrics the label layout reserves", () => {
    for (const ch of "gjpqyçąęÇ,;()Qg") expect(glyphFor(ch).rows.length - glyphFor(ch).top, ch).toBeLessThanOrEqual(FONT_DESCENT);
  });
});

describe("coverage of the owner's names", () => {
  const NAMES = ["Nikšić", "Chișinău", "Sighișoara", "Huế", "Málaga", "Bogotá", "Thessaloniki", "Hà Nội", "Đà Nẵng", "Reykjavík", "Łódź", "Tromsø", "Çanakkale", "Ñandú", "Zürich", "Ho Chi Minh City", "São Paulo", "Ōsaka", "Kraków", "Αθήνα", "Москва", "Київ", "Україна", "Győr", "İstanbul", "Brașov", "Český Krumlov", "Åre", "Curaçao", "Côte d’Ivoire", "St. John's", "Aix-en-Provence", "Bălți", "Gdańsk", "Plzeň", "Szczecin"];
  it("none of them needs the system font", () => {
    for (const name of NAMES) for (const ch of name) expect(usesFallback(ch), `${name}: ${ch}`).toBe(false);
  });
  it("the common Latin diacritics, the apostrophes, the hyphens and the ellipsis are in the font itself", () => {
    for (const ch of "éèêëçãñïüöôøåÉÈÊÇÃÑÏÜÖÔØÅáàâäíìîóòúùûýÿ'’-–—…") expect(hasOwnGlyph(ch), ch).toBe(true);
    for (const ch of "ĂăĆćČčĐđĒēĚěĞğĪīŃńŇňŌōŽžŹźŻżŪū") expect(hasOwnGlyph(ch), ch).toBe(true);
    for (const ch of "ΑΒΓΔΩαβγδω") expect(hasOwnGlyph(ch), ch).toBe(true);
    for (const ch of "АБВГДабвгд") expect(hasOwnGlyph(ch), ch).toBe(true);
  });
  it("the Ukrainian letters the font lacks are built from its Latin look-alikes and mirrors: Київ, Україна, Ґанок", () => {
    for (const ch of "ІіЇїЄєҐґЈјЅѕ") {
      expect(usesFallback(ch), ch).toBe(false);
      expect(glyphFor(ch).rows.length, ch).toBeGreaterThan(0);
    }
    expect(glyphFor("ї").rows).toEqual(glyphFor("ï").rows);
    expect(glyphFor("є").rows).not.toEqual(glyphFor("c").rows); // turned round
    expect(glyphFor("ґ").top).toBe(glyphFor("г").top + 1);
  });
  it("other scripts fall back to the thresholded system font (a box without a DOM), flagged", () => {
    expect(usesFallback("ا")).toBe(true);
    expect(usesFallback("京")).toBe(true);
    const g = glyphFor("ا");
    expect(g.rows.length).toBeGreaterThan(0);
  });
});

describe("the Latin letters the font lacks are composed in its style", () => {
  const COMPOSED = "šŠśŚřŘťŤďĎľĽŝŜĉĝĥĵşŞţŢșȘțȚģķļņŗąĄęĘįĮųŲůŮőŐűŰłŁıİœŒĳĲ";
  it("every one has a bitmap and none uses the system font", () => {
    for (const ch of COMPOSED) {
      if (hasOwnGlyph(ch)) continue;
      expect(glyphFor(ch).rows.length, ch).toBeGreaterThan(0);
      expect(usesFallback(ch), ch).toBe(false);
    }
  });
  it("a caron, an acute, a ring or a double acute is cut out of a donor letter and put above the letter: the body stays", () => {
    const s = glyphFor("s");
    const sh = glyphFor("š");
    expect(sh.top).toBeGreaterThan(s.top);
    expect(sh.rows.slice(sh.rows.length - s.rows.length)).toEqual(s.rows); // the body is the plain s
    expect(glyphFor("ů").top).toBeGreaterThan(glyphFor("u").top);
    expect(glyphFor("ő").top).toBeGreaterThan(glyphFor("o").top);
    // same-width letters get the donor's mark at the same columns: the caron of š is the caron of č
    const c = glyphFor("č");
    const cp = glyphFor("c");
    expect(sh.rows.slice(0, sh.rows.length - s.rows.length)).toEqual(c.rows.slice(0, c.rows.length - cp.rows.length));
  });
  it("a cedilla or comma below, and an ogonek, hang under the baseline and keep the body: ş ș ţ ț ą ę", () => {
    for (const [composed, plain] of [["ş", "s"], ["ș", "s"], ["ţ", "t"], ["ț", "t"], ["ą", "a"], ["ę", "e"]] as const) {
      const c = glyphFor(composed);
      const p = glyphFor(plain);
      expect(c.rows.length - c.top, composed).toBeGreaterThan(0);
      expect(c.rows.length - c.top, composed).toBeLessThanOrEqual(FONT_DESCENT);
      expect(c.top, composed).toBe(p.top);
    }
  });
  it("ı is the i without its dot; İ is the I with a dot a row above the cap", () => {
    expect(glyphFor("ı").top).toBe(FONT_X_HEIGHT);
    expect(glyphFor("ı").rows).toEqual(glyphFor("i").rows.slice(glyphFor("i").top - FONT_X_HEIGHT));
    expect(glyphFor("İ").top).toBeGreaterThan(FONT_CAP);
  });
  it("ł and Ł keep the height of l and L, with a stroke through them", () => {
    expect(glyphFor("ł").top).toBe(glyphFor("l").top);
    expect(glyphFor("Ł").top).toBe(FONT_CAP);
    expect(ascii("ł").join("")).not.toBe(ascii("l").join(""));
  });
  it("ď, ť and ľ carry a stroke to the right of the letter, a blank column away", () => {
    for (const [c, plain] of [["ď", "d"], ["ť", "t"], ["ľ", "l"]] as const) {
      expect(glyphFor(c).w, c).toBeGreaterThan(glyphFor(plain).w);
      expect(glyphFor(c).adv, c).toBeGreaterThan(glyphFor(plain).adv);
    }
  });
  it("œ is the o and the e touching: one column narrower than the two letters", () => {
    expect(glyphFor("œ").adv).toBe(glyphFor("o").adv + glyphFor("e").adv - 1);
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
    expect(measureText("gjy").bottom).toBe(FONT_DESCENT);
    expect(measureText("x").top).toBe(FONT_CAP);
    expect(measureText("Paris").w).toBeGreaterThan(measureText("Pari").w);
  });
  it("measureText is the drawn extent", () => {
    for (const text of ["Paris", "Hà Nội", "Ho Chi Minh City", "Nikšić", "I", "", "Chișinău, Moldova"]) {
      const xs: number[] = [];
      forEachInk(text, 0, 20, (x) => xs.push(x));
      expect(measureText(text).w, text).toBe(xs.length ? Math.max(...xs) + 1 : 0);
    }
  });
  it("one weight: there is no bold, and a cell is emitted once so a translucent string is evenly translucent", () => {
    for (const text of ["Paris", "Hà Nội", "Tromsø", "Ho Chi Minh City", "Chișinău"]) {
      const seen = new Set<string>();
      forEachInk(text, 0, 20, (x, y) => {
        const k = `${x},${y}`;
        expect(seen.has(k), `${text} ${k}`).toBe(false);
        seen.add(k);
      });
    }
  });
  it("the ellipsis is the font's own glyph, dots on at most two rows", () => {
    expect(hasOwnGlyph("…")).toBe(true);
    expect(glyphFor("…").rows.length).toBeLessThanOrEqual(2);
  });
});
