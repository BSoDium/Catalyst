/**
 * Attribution for the ACTIVE tile source (HTML, outside the shader pass, always visible). Pure; the engine renders
 * the parts as links. Licence background: docs/street-zoom-spike.md ("Data attribution and licences").
 */
import type { SourceId, TileState } from "./tile-source-manager";

export interface AttributionPart {
  text: string;
  href: string | null;
}

const OSM: AttributionPart = { text: "© OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright" };
const OFM: AttributionPart = { text: "OpenFreeMap", href: "https://openfreemap.org" };
const OMT: AttributionPart = { text: "OpenMapTiles", href: "https://openmaptiles.org" };
const PROTOMAPS: AttributionPart = { text: "Protomaps", href: "https://protomaps.com" };
const NATURAL_EARTH: AttributionPart = { text: "Natural Earth", href: "https://www.naturalearthdata.com" };

export interface AttributionInput {
  state: TileState;
  source: SourceId | null;
  /** The configured primary URL (decides OpenFreeMap vs a custom source) and whether it is a PMTiles archive. */
  primaryUrl: string;
  primaryIsPmtiles: boolean;
}

/**
 * Primary on OpenFreeMap: "© OpenStreetMap contributors · OpenFreeMap · OpenMapTiles". Fallback (or a PMTiles
 * primary, which is Protomaps schema): "© OpenStreetMap contributors · Protomaps". A self-hosted TileJSON primary
 * carries OSM only. While connecting or capped only the bundled Natural Earth lines are drawn (public domain; the
 * credit is a courtesy), because OSM data is not on screen then.
 */
export function attributionFor(input: AttributionInput): AttributionPart[] {
  if (input.source === "fallback" || (input.source === "primary" && input.primaryIsPmtiles)) return [OSM, PROTOMAPS];
  if (input.source === "primary") {
    let host = "";
    try {
      host = new URL(input.primaryUrl).hostname;
    } catch {
      host = "";
    }
    return host === "openfreemap.org" || host.endsWith(".openfreemap.org") ? [OSM, OFM, OMT] : [OSM];
  }
  return [NATURAL_EARTH];
}

export const attributionText = (parts: readonly AttributionPart[]): string => parts.map((p) => p.text).join(" · ");
