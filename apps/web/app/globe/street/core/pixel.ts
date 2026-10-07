/**
 * Pure pieces of the compositor: sizes, the focus-mask coverage and the eased scalars that drive the reveal and the
 * dissolve. Every function with a GLSL twin is pinned by a unit test.
 */
import { ditherThreshold } from "./art-line";
import { STREET_TUNING } from "../tuning";

/** Whole device pixels per art pixel (the globe's rule, re-exported so the street code has one name for it). */
export function cellDevicePx(cellCss: number, dpr: number): number {
  return Math.max(1, Math.round(cellCss * dpr));
}

/** Art pixel in CSS px for a container, as the globe computes it (whole device pixels). */
export function cellCssFor(width: number, height: number, dpr: number): number {
  return STREET_TUNING.pixelSize(Math.min(width, height), dpr);
}

/** Focus mask coverage 0..1: 1 inside `radius`, smooth fall-off over `feather`, 0 beyond. */
export function maskCoverage(dist: number, radius: number, feather: number): number {
  if (radius <= 0) return 0;
  if (feather <= 0) return dist <= radius ? 1 : 0;
  const t = Math.min(1, Math.max(0, (dist - radius) / feather));
  return 1 - t * t * (3 - 2 * t);
}

/** A cell shows the sharp render (or the street, for the blend) when the mask coverage exceeds its dither threshold. */
export function showsSharp(coverage: number, cx: number, cy: number): boolean {
  return coverage > ditherThreshold(cx, cy);
}

/** Fraction of cells (of a big flat area) shown at a given coverage. Used to test the dissolve is monotonic and fair. */
export function sharpFraction(coverage: number, size = 64): number {
  let n = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (showsSharp(coverage, x, y)) n++;
  return n / (size * size);
}

/** Radius (device px) of the sharp reveal circle at full strength, for an output of `outW x outH` device px. */
export function revealRadiusDevice(outW: number, outH: number, dpr: number): number {
  return Math.min(STREET_TUNING.revealMaxCss, STREET_TUNING.revealFraction * (Math.min(outW, outH) / dpr)) * dpr;
}

/**
 * A scalar eased linearly in time towards a target, displayed smoothstepped. Instant under reduced motion ("static
 * dissolve": the dither pattern never animates). Pure: advance it with `step(dtMs)`.
 */
export class EasedValue {
  value: number;
  target: number;
  constructor(
    public durationMs: number,
    public reducedMotion = false,
    initial = 0,
  ) {
    this.value = initial;
    this.target = initial;
  }
  set(target: number, durationMs?: number): void {
    this.target = Math.min(1, Math.max(0, target));
    if (durationMs !== undefined) this.durationMs = durationMs;
    if (this.reducedMotion || this.durationMs <= 0) this.value = this.target;
  }
  get animating(): boolean {
    return this.value !== this.target;
  }
  step(dtMs: number): number {
    if (!this.animating) return this.value;
    const d = dtMs / Math.max(1, this.durationMs);
    this.value = this.value < this.target ? Math.min(this.target, this.value + d) : Math.max(this.target, this.value - d);
    return this.value;
  }
  /** Smoothstepped value for display. */
  get eased(): number {
    const t = this.value;
    return t * t * (3 - 2 * t);
  }
}
