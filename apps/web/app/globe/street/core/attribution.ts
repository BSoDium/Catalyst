/**
 * The data credits of the map: the one-line summary at the bottom right (`attributionLine`) and the dialog behind its "See more"
 * button, which lists them all (components/attribution-button.tsx). Pure.
 * Licence background: docs/street-zoom-spike.md ("Data attribution and licences").
 */
import { isPmtilesUrl } from "./source-descriptor";

export interface AttributionPart {
  /** The credit as the licence words it: kept verbatim in the dialog. */
  text: string;
  /** The abbreviation shown in the one-line summary, or null for a credit that only the dialog lists (its schema is not a contributor). */
  short: string | null;
  href: string;
  /** What the source provides, in a sentence. */
  note: string;
}

const OSM: AttributionPart = {
  text: "© OpenStreetMap contributors",
  short: "© OpenStreetMap",
  href: "https://www.openstreetmap.org/copyright",
  note: "The street map data, available under the Open Database Licence (ODbL).",
};
const OFM: AttributionPart = { text: "OpenFreeMap", short: "OpenFreeMap", href: "https://openfreemap.org", note: "Serves the map tiles." };
const OMT: AttributionPart = { text: "OpenMapTiles", short: null, href: "https://openmaptiles.org", note: "The schema of the map tiles." };
const PROTOMAPS: AttributionPart = { text: "Protomaps", short: "Protomaps", href: "https://protomaps.com", note: "Serves the backup extract of the map, used when the main tile server cannot be reached." };
const NATURAL_EARTH: AttributionPart = {
  text: "Natural Earth",
  short: "Natural Earth",
  href: "https://www.naturalearthdata.com",
  note: "The coastlines and country borders of the globe. Public domain; credited as a courtesy.",
};

/** The tile configuration the credits depend on (`StreetTileConfig`, or null when no street map is configured). */
export interface AttributionTiles {
  primaryUrl: string;
  fallbackPmtilesUrl: string | null;
}

const isOpenFreeMap = (url: string): boolean => {
  try {
    const host = new URL(url).hostname;
    return host === "openfreemap.org" || host.endsWith(".openfreemap.org");
  } catch {
    return false;
  }
};

/**
 * Every source the configuration can show: OpenStreetMap with OpenFreeMap and OpenMapTiles for an OpenFreeMap primary
 * (a PMTiles primary is Protomaps' schema; a self-hosted TileJSON primary carries OSM only), plus Protomaps when a
 * fallback archive is configured, plus Natural Earth, whose lines are the globe's and the street map's lowest zooms.
 * The list is the union rather than the active source, so it is always complete and needs no tile status.
 */
export function attributionFor(tiles: AttributionTiles | null): AttributionPart[] {
  const parts: AttributionPart[] = [];
  if (tiles) {
    parts.push(OSM);
    if (isPmtilesUrl(tiles.primaryUrl)) parts.push(PROTOMAPS);
    else {
      if (isOpenFreeMap(tiles.primaryUrl)) parts.push(OFM, OMT);
      if (tiles.fallbackPmtilesUrl) parts.push(PROTOMAPS);
    }
  }
  parts.push(NATURAL_EARTH);
  return parts;
}

export const attributionText = (parts: readonly AttributionPart[]): string => parts.map((p) => p.text).join(" · ");

/**
 * The main contributors for the one-line summary, abbreviated, in priority order (the order of `attributionFor`: the street data
 * first, the courtesy credit last). The line is clipped from the end when the screen is narrow, so what comes first stays.
 * The full wordings are in the dialog, one click away.
 */
export const attributionLine = (parts: readonly AttributionPart[]): string[] => parts.flatMap((p) => (p.short ? [p.short] : []));
