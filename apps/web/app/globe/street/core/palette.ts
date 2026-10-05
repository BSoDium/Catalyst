/**
 * THE palette table of the street map: one list of named levels derived from the page's CSS tokens, and the mapping
 * from the pass's class codes to those levels. Nothing else in the street code knows how many levels there are.
 *
 *   levels (dark -> light is not implied; index 0 is always the page colour, the last ramp level the ink):
 *     bg      the page colour (`--background`)
 *     ramp-k  intermediate greys, `mix(bg, ink, k / (N - 1))`            (none while N = 2)
 *     ink     the foreground (`--foreground`)
 *     muted   the outline / rail / graticule colour (`--globe-limb`)
 *
 * Today N = 2: bg and ink, plus the muted line colour, and fills are a dither lattice between bg and ink (the tone is
 * quantised to `TONE_STEPS` and compared with the Bayer lattice in the pass). A richer palette raises `PALETTE_LEVELS`
 * (up to `MAX_LEVELS`) and routes tones to ramp levels by editing `CODE_LEVEL` / the pass's tone stage; the LINE rules
 * (1 art-pixel floor, centre sampling, no antialiased grey, stair removal) never look at levels: lines are class codes
 * `thin` / `solid` and always draw in the ink level.
 */
import { CODE } from "./art-line";
import type { Rgb } from "./pixel-types";

/** Levels in the ramp between bg and ink, inclusive. 2 = strict 1-bit (plus the muted line colour). */
export const PALETTE_LEVELS = 2;
/** Capacity of the shader's palette array. */
export const MAX_LEVELS = 10;
/** Tone (fill) quantisation of the lattice: the pass compares `round(tone * TONE_STEPS)` with the 64-cell Bayer matrix. */
export const TONE_STEPS = 16;

export type LevelRole = "bg" | "ramp" | "ink" | "muted";
export interface PaletteLevel {
  name: string;
  role: LevelRole;
  /** 0 = page colour, 1 = ink (ramp levels); the muted level is its own colour. */
  mix: number;
}

/** The ordered level names for a ramp of `n` levels (n >= 2): bg, ramp-1 ... ramp-(n-2), ink, then muted. */
export function paletteLevels(n: number = PALETTE_LEVELS): PaletteLevel[] {
  const count = Math.min(MAX_LEVELS - 1, Math.max(2, Math.round(n)));
  const out: PaletteLevel[] = [{ name: "bg", role: "bg", mix: 0 }];
  for (let k = 1; k < count - 1; k++) out.push({ name: `ramp-${k}`, role: "ramp", mix: k / (count - 1) });
  out.push({ name: "ink", role: "ink", mix: 1 }, { name: "muted", role: "muted", mix: 1 });
  return out;
}

export interface PaletteTheme {
  background: Rgb;
  ink: Rgb;
  outline: Rgb;
}

export interface Palette {
  levels: PaletteLevel[];
  /** One colour per level, in level order. */
  rgb: Rgb[];
  /** Level index drawn for each class code (`CODE`), length 8. */
  codeLevel: number[];
  toneSteps: number;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function buildPalette(theme: PaletteTheme, n: number = PALETTE_LEVELS): Palette {
  const levels = paletteLevels(n);
  const rgb = levels.map((l): Rgb => (l.role === "muted" ? theme.outline : mix(theme.background, theme.ink, l.mix)));
  const idx = (role: LevelRole) => levels.findIndex((l) => l.role === role);
  const codeLevel = new Array<number>(8).fill(idx("bg"));
  codeLevel[CODE.thin] = codeLevel[CODE.solid] = codeLevel[CODE.tone] = idx("ink");
  codeLevel[CODE.muted] = idx("muted");
  return { levels, rgb, codeLevel, toneSteps: TONE_STEPS };
}
