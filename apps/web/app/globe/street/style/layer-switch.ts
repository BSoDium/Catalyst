/**
 * Which layers of the street style are on (pure, unit tested): the camera decides, the temporal ease animates.
 *
 * Every zoom-dependent layer of the street style (a road class, a river, a fill, the graticule, the sea texture) is BINARY: on or off.
 * `LayerSwitch` keeps that state with a hysteresis band (a layer switches on at `on + ZOOM_BAND`, off again at `on - ZOOM_BAND`, so a
 * zoom jittering around the threshold cannot flap it) and reports what changed; the engine applies the changes as layer visibility.
 * The fade is not here: the cells of a layer that has just switched ease in or out by time in the compositor (`core/ease.ts`, a level per
 * 24 ms, run to the end by its settle loop), so the map at rest is never half way, whatever the zoom inertia did.
 *
 * Two layers follow the FLATNESS of the view instead of a zoom (`core/flatness.ts`): the graticule while the earth is visibly curved,
 * the sea texture once it is close to flat (and the tiles reach that far: `seaOn`). They are exactly one of the two at every zoom: the
 * graticule is on whenever the texture is not (so a flat view whose tiles do not reach the texture yet keeps its graticule).
 */
import { isFlat } from "../core/flatness";
import { hysteresis } from "../../engine/fade";
import { LOD } from "./lod";
import { SPECS } from "./street-style";

/** Half width of the hysteresis band, in map zoom levels. */
export const ZOOM_BAND = 0.05;
export const SEA_LAYER = "water-fill";
export const GRATICULE_LAYER = "graticule";

export interface SwitchRule {
  id: string;
  /** Map zoom from which the layer is on. */
  on: number;
  /** Map zoom from which it is off again (a class that hands over to another). */
  off?: number;
}

/** The camera, as the switch needs it. */
export interface SwitchView {
  /** MapLibre zoom. */
  zoom: number;
  /** The unified (globe) zoom, `registerMapToGlobe`. */
  unifiedZoom: number;
  /** Height of the view in CSS px. */
  heightPx: number;
}

/**
 * The zoom rules of every switched layer: the road, water and border classes of the LOD table, the park, green and building fills, and
 * the sea texture, which is on from `seaOn` (the zoom the tile geometry takes over from the bundled world lines, `street-style.ts seaFrom`)
 * once the view is flat.
 */
export function switchRules(seaOn: number): SwitchRule[] {
  const rules: SwitchRule[] = [];
  for (const spec of SPECS) {
    if (spec.id === SEA_LAYER) rules.push({ id: spec.id, on: seaOn });
    else if (spec.lod) rules.push({ id: spec.id, on: LOD[spec.lod].on, ...(LOD[spec.lod].off !== undefined ? { off: LOD[spec.lod].off! } : {}) });
    else if (spec.fade) rules.push({ id: spec.id, on: spec.fade.on });
  }
  return rules;
}

/** Whether a layer id is switched at all. */
export const isSwitched = (id: string): boolean => id === GRATICULE_LAYER || SPECS.some((s) => s.id === id && (s.lod || s.fade));

export class LayerSwitch {
  private readonly reached = new Map<string, boolean>();
  private readonly passed = new Map<string, boolean>();
  private readonly shown = new Map<string, boolean>();
  /** The view is flat (the hysteresis of `core/flatness.ts`). */
  flat = false;

  constructor(private readonly rules: readonly SwitchRule[]) {}

  /** Move to a camera; returns the layers whose visibility changed. */
  update(view: SwitchView): { id: string; visible: boolean }[] {
    this.flat = isFlat(this.flat, view.unifiedZoom, view.heightPx);
    const out: { id: string; visible: boolean }[] = [];
    const set = (id: string, visible: boolean) => {
      if (this.shown.get(id) === visible) return;
      this.shown.set(id, visible);
      out.push({ id, visible });
    };
    let sea = false;
    for (const r of this.rules) {
      const reached = hysteresis(this.reached.get(r.id) ?? false, view.zoom, r.on - ZOOM_BAND, r.on + ZOOM_BAND);
      const passed = r.off === undefined ? false : hysteresis(this.passed.get(r.id) ?? false, view.zoom, r.off - ZOOM_BAND, r.off + ZOOM_BAND);
      this.reached.set(r.id, reached);
      this.passed.set(r.id, passed);
      const on = reached && !passed && (r.id !== SEA_LAYER || this.flat);
      if (r.id === SEA_LAYER) sea = on;
      set(r.id, on);
    }
    // The graticule is the sea texture's other half: it goes exactly when the texture comes, never before. The view can be flat (the graticule
    // would go) while the tiles do not reach the texture yet (`seaOn` is the hand-over zoom plus 0.7, and the Protomaps fallback hands over at 8.5
    // while a 900 px view is flat from 8.3): between the two zooms the map would show neither water nor graticule.
    set(GRATICULE_LAYER, !sea);
    return out;
  }

  /** The layers that are on now. */
  visibleIds(): Set<string> {
    return new Set([...this.shown].filter(([, v]) => v).map(([id]) => id));
  }
}
