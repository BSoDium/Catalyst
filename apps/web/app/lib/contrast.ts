/**
 * WCAG 2 contrast on sRGB colours, for the design tokens' tests and the dev styleguide's live readout. Pure.
 * Understands `#rgb`, `#rrggbb`, `rgb(r g b)`, `rgb(r, g, b)` and their `/ a` or `rgba` forms (what `getComputedStyle` returns).
 */
export type Rgba = readonly [number, number, number, number];

export function parseColor(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(v);
  if (fn) {
    const alpha = fn[4] === undefined ? 1 : fn[5] ? Number(fn[4]) / 100 : Number(fn[4]);
    return [Number(fn[1]), Number(fn[2]), Number(fn[3]), Math.min(1, Math.max(0, alpha))];
  }
  return null;
}

/** `top` composited over an opaque `under`, as the browser does. */
export function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
}

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function luminance(c: Rgba): number {
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** Contrast ratio (1 to 21). A translucent `fg` is composited over `bg`; `bg` must be opaque. */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const f = fg[3] < 1 ? over(fg, bg) : fg;
  const a = luminance(f);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
