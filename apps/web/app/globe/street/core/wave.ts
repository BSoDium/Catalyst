/**
 * The map's entrance as a wave of tiles (#589), like chunks loading: the tile in the middle of the screen comes first, with a flash, then the ring of tiles round it, then the ring round that, each
 * `staggerMs` after the one inside it and each taking `fadeMs` to come in (dithered, with a flash in the ink at its start and a glow in the peak tone while it settles). Pure: the numbers and the geometry.
 * The GPU's side is the present pass (gl/pixel-pass.ts), which reads the same constants.
 */
export const WAVE = {
  /** A tile is this many art cells a side (more when the screen would need more than `maxRings` of them). */
  tileCells: 12,
  maxRings: 22,
  /** The time between one ring beginning and the next, and the time a tile takes to come in, ms. */
  staggerMs: 85,
  fadeMs: 520,
  /** The share of a tile's coming in that is the flash. */
  flash: 0.3,
} as const;

/** The tile's side in output px and the rings the wave has to cross to reach the farthest corner from the middle of an `outW` x `outH` screen, `cell` output px to an art cell. */
export function waveGeometry(outW: number, outH: number, cell: number): { tile: number; rings: number } {
  const reach = Math.max(outW, outH) / 2;
  const tile = Math.max(1, Math.round(Math.max(cell * WAVE.tileCells, reach / WAVE.maxRings)));
  return { tile, rings: Math.ceil(reach / tile) };
}

/** How long the whole wave takes, ms. */
export function waveTotalMs(rings: number): number {
  return rings * WAVE.staggerMs + WAVE.fadeMs;
}
