/**
 * Renderer-agnostic globe contract. The app talks to the globe ONLY through
 * these types; the implementation behind `Globe` can be swapped freely.
 * Nothing under app/globe/ may import from the rest of the app.
 */
export interface GlobeViewState {
  lon: number;
  lat: number;
  /** In [0, 1]. 0 = whole globe, 1 = closest. */
  zoom: number;
}

export interface GlobePlace {
  slug: string;
  name: string;
  lat: number;
  lon: number;
  labelPriority: number;
}

/** Resolved from `route.stops`: ordered points, never inferred. */
export interface GlobeRoute {
  id: string;
  title: string;
  points: { lat: number; lon: number }[];
}

export interface GlobeProps {
  places: GlobePlace[];
  routes: GlobeRoute[];
  selectedSlug: string | null;
  focusedSlug: string | null;
  /** View to restore when the globe is (re)mounted; null = renderer default. */
  initialView: GlobeViewState | null;
  reducedMotion: boolean;
  /**
   * CSS px at the right edge of the globe's box that the app covers (the detail panel). The globe centres its
   * projection on the free area to the left: rotate-to-place, picking, label positions and the minimum zoom
   * (the whole globe fits the free area) all use that shifted centre. The box itself is not resized.
   * Going from 0 to a positive value (or back) is eased like the panel's slide; other changes (viewport
   * resizes) and `reducedMotion` apply at once. Read at mount as well, so a direct load with the panel
   * open starts centred. The renderer may also stop drawing under the covered strip and dissolve the
   * map's right edge into the page; the box stays full width. 0 = no inset.
   */
  insetRight: number;
  onSelect(slug: string): void;
  onViewChange(view: GlobeViewState): void;
}
