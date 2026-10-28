/**
 * Visual effects tiers (owner, 2026-10-28): the effects added on top of the planet (the sun's flare and halo, the eye's iris, the ring's smooth night) can be switched off
 * for a device that cannot afford them, one by one or by tier. Module state like `SKY_STATE`: `applyFxFlags` sets it from the page before the renderer is built; the layers read `FX` per frame.
 *
 *   full     everything
 *   reduced  no iris, the ring's night in whole tones (no second draw per letter)
 *   minimal  reduced, and no lens flare
 *
 * The tier is picked by `?fx=full|reduced|minimal` (or sessionStorage "fx"), else from the device (`deviceMemory`, `hardwareConcurrency`, reduced data); single effects are
 * switched off with `?no-fx=iris,flare` (names of `FxName`). Pure: `resolveFx`.
 */
export type FxTier = "full" | "reduced" | "minimal";
export type FxName = "iris" | "ringBlend" | "flare" | "sunHalo";

const NAMES: readonly FxName[] = ["iris", "ringBlend", "flare", "sunHalo"];
const OFF_AT: Record<FxName, FxTier[]> = { iris: ["reduced", "minimal"], ringBlend: ["reduced", "minimal"], flare: ["minimal"], sunHalo: [] };

export interface FxInput {
  search: string;
  stored?: string | null;
  memory?: number;
  cores?: number;
  saveData?: boolean;
}

export interface FxResult {
  tier: FxTier;
  on: Record<FxName, boolean>;
}

const isTier = (s: string | null | undefined): s is FxTier => s === "full" || s === "reduced" || s === "minimal";

export function resolveFx(i: FxInput): FxResult {
  const q = new URLSearchParams(i.search);
  const asked = q.get("fx") ?? i.stored;
  let tier: FxTier = "full";
  if (isTier(asked)) tier = asked;
  else if (i.saveData || (i.memory !== undefined && i.memory <= 2) || (i.cores !== undefined && i.cores <= 2)) tier = "minimal";
  else if ((i.memory !== undefined && i.memory <= 4) || (i.cores !== undefined && i.cores <= 4)) tier = "reduced";
  const off = new Set((q.get("no-fx") ?? "").split(",").map((s) => s.trim()));
  const on = {} as Record<FxName, boolean>;
  for (const n of NAMES) on[n] = !OFF_AT[n].includes(tier) && !off.has(n);
  return { tier, on };
}

/** Live switches: everything on until the page says otherwise. */
export const FX: FxResult = { tier: "full", on: { iris: true, ringBlend: true, flare: true, sunHalo: true } };

export function applyFxFlags(): void {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    const r = resolveFx({ search: location.search, stored: sessionStorage.getItem("fx"), memory: nav.deviceMemory, cores: nav.hardwareConcurrency, saveData: nav.connection?.saveData });
    FX.tier = r.tier;
    Object.assign(FX.on, r.on);
  } catch {
    /* keep the defaults */
  }
}

/** The iris's next value: eased toward `target` over `closeMs` (closing) or `openMs` (opening) in `dt` ms, the whole way at once under reduced motion, snapped when it is within 0.002. Pure. */
export function irisStep(iris: number, target: number, dt: number, closeMs: number, openMs: number, reduced: boolean): number {
  const ms = target > iris ? closeMs : openMs;
  const next = reduced ? target : iris + (target - iris) * (1 - Math.exp((-dt / ms) * 3));
  return Math.abs(target - next) < 0.002 ? target : next;
}
