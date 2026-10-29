import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GRID, MARK, markPath, markSvg } from "../../../scripts/brand/mark.mjs";
import { SITE_NAME } from "~/lib/site";
import { LogoMark, LogoWordmark, MARK_PATH } from "./logo-mark";

describe("the mark", () => {
  it("is a 16 x 16 one-bit grid of two overlapping shapes, a square and a disc, with the overlap knocked out", () => {
    expect(GRID).toBe(16);
    expect(MARK).toHaveLength(16);
    for (const row of MARK) expect(row).toMatch(/^[#.]{16}$/);
    const ink = (x: number, y: number) => MARK[y]![x] === "#";
    // the square is the top-left 10 x 10 (its corner is ink), the disc fills the bottom-right (it reaches the last row and column)
    expect(ink(0, 0)).toBe(true);
    expect(ink(9, 0)).toBe(true);
    expect(ink(0, 9)).toBe(true);
    expect(MARK.some((row) => row[15] === "#")).toBe(true);
    expect(MARK[15]!.includes("#")).toBe(true);
    // the overlap is empty, and only there: inside the square and inside the disc nothing is ink
    expect(ink(6, 6)).toBe(false);
    expect(ink(7, 7)).toBe(false);
    // symmetric about the main diagonal (a square and a disc on the same axis)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(ink(x, y), `(${x}, ${y})`).toBe(ink(y, x));
    // solid shapes: no isolated cell, no checker (a mark that reads at 16 px)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (!ink(x, y)) continue;
        const neighbours = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([nx, ny]) => nx! >= 0 && ny! >= 0 && nx! < 16 && ny! < 16 && ink(nx!, ny!)).length;
        expect(neighbours, `(${x}, ${y})`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("is the component's path and the standalone mark's, so the two never drift apart", () => {
    expect(MARK_PATH).toBe(markPath());
    expect(markSvg({ px: 32, fill: "#000" })).toContain(`d="${MARK_PATH}"`);
  });

  it("has integer coordinates only (square pixels, no curves)", () => {
    expect(MARK_PATH).toMatch(/^[MhvzM0-9 \-]+$/);
    expect(MARK_PATH).not.toMatch(/[cCsSqQtTaAlL.]/);
  });
});

describe("LogoMark", () => {
  it("is decorative by default and follows the text colour", () => {
    const html = renderToStaticMarkup(createElement(LogoMark));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain('viewBox="0 0 16 16"');
    expect(html).toContain('shape-rendering="crispEdges"');
    expect(html).toContain('width="32"');
    expect(html).not.toContain("role=");
  });
  it("takes a name when it stands alone", () => {
    const html = renderToStaticMarkup(createElement(LogoMark, { size: 64, title: SITE_NAME }));
    expect(html).toContain('role="img"');
    expect(html).toContain(`aria-label="${SITE_NAME}"`);
    expect(html).not.toContain("aria-hidden");
  });
});

describe("LogoWordmark", () => {
  it("is the mark and the site's name as text, side by side", () => {
    const html = renderToStaticMarkup(createElement(LogoWordmark));
    expect(html).toContain(`>${SITE_NAME}</span>`);
    expect(html).toContain('viewBox="0 0 16 16"');
    expect(html).toContain("font-semibold");
    // the mark is decorative next to the name that says it
    expect(html).toContain('aria-hidden="true"');
  });
});
