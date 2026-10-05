/**
 * What a tile source looks like to the style builder, and how a TileJSON document is validated into one.
 * Pure (unit tested); the fetching lives in net/.
 */
import type { SourceId } from "./tile-source-manager";

export type Schema = "protomaps" | "openmaptiles";

export interface SourceDescriptor {
  /** Which role this source plays in the chain. */
  role: SourceId;
  /** Layer schema of the tiles: decides the source-layer names of the style. */
  schema: Schema;
  /** Real (unprefixed) z/x/y tile URL templates, for a TileJSON source. Empty for a PMTiles archive. */
  tiles: string[];
  /** The `.pmtiles` archive URL, for a PMTiles source. */
  archiveUrl: string | null;
  minzoom: number;
  /** Highest zoom tiles are requested at (beyond it the map over-zooms). */
  maxzoom: number;
  bounds: [number, number, number, number] | null;
  /** The TileJSON's own attribution string, if any (informational: the HTML attribution is built by core/attribution.ts). */
  attribution: string | null;
}

const isFinite_ = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Tile URLs must be absolute https (plain http only for localhost, for development), with the three placeholders. */
export function isValidTileTemplate(url: unknown): url is string {
  if (typeof url !== "string" || !url.includes("{z}") || !url.includes("{x}") || !url.includes("{y}")) return false;
  try {
    const u = new URL(url.replace(/\{[zxy]\}/g, "0"));
    if (u.username || u.password) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Validate a parsed TileJSON into a descriptor. Returns null when it is unusable: the caller treats that as a
 * failed probe ("invalid"), never as a crash.
 */
export function descriptorFromTileJson(role: SourceId, json: unknown, schema: Schema = "openmaptiles"): SourceDescriptor | null {
  if (typeof json !== "object" || json === null) return null;
  const j = json as Record<string, unknown>;
  const tiles = Array.isArray(j.tiles) ? j.tiles.filter(isValidTileTemplate) : [];
  if (tiles.length === 0) return null;
  const minzoom = isFinite_(j.minzoom) ? Math.max(0, Math.min(22, j.minzoom)) : 0;
  const maxzoom = isFinite_(j.maxzoom) ? Math.max(minzoom, Math.min(22, j.maxzoom)) : 14;
  const b = j.bounds;
  const bounds =
    Array.isArray(b) && b.length === 4 && b.every(isFinite_) && b[0]! < b[2]! && b[1]! < b[3]! ? ([b[0]!, b[1]!, b[2]!, b[3]!] as [number, number, number, number]) : null;
  return { role, schema, tiles, archiveUrl: null, minzoom, maxzoom, bounds, attribution: typeof j.attribution === "string" ? j.attribution : null };
}

export interface PmtilesHeaderLike {
  minZoom: number;
  maxZoom: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** Descriptor of a PMTiles archive: `maxFallbackZoom` clamps the zoom tiles are requested at (the archive's `--maxzoom`). */
export function descriptorFromPmtiles(role: SourceId, archiveUrl: string, h: PmtilesHeaderLike, maxZoomCap: number | null): SourceDescriptor {
  const maxzoom = Math.max(h.minZoom, maxZoomCap === null ? h.maxZoom : Math.min(h.maxZoom, maxZoomCap));
  const valid = h.minLon < h.maxLon && h.minLat < h.maxLat;
  return {
    role,
    schema: "protomaps",
    tiles: [],
    archiveUrl,
    minzoom: h.minZoom,
    maxzoom,
    bounds: valid ? [h.minLon, h.minLat, h.maxLon, h.maxLat] : null,
    attribution: null,
  };
}

/** Whether a URL names a PMTiles archive (a configured primary may be one). */
export const isPmtilesUrl = (url: string): boolean => {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pmtiles");
  } catch {
    return false;
  }
};
