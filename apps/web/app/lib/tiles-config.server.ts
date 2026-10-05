/**
 * Tile source configuration, read from the environment at REQUEST time (never baked into the client bundle) and
 * handed to the browser in the shell loader data. The contract is docs/self-hosting.md, section 6:
 *
 *   CATALYST_TILES_PRIMARY_URL       default https://tiles.openfreemap.org/planet
 *   CATALYST_TILES_FALLBACK_URL      default unset (no fallback: the chain is primary -> the globe floor)
 *   CATALYST_TILES_MAX_FALLBACK_ZOOM default 14, integer 0..15
 *
 * The default primary is OpenFreeMap's planet TileJSON: the style-independent source description (no Liberty or
 * other style attached) of a global OpenMapTiles-schema vector tile set, z0 to z14, no key. The street map draws its
 * own monochrome style over it and requests no glyphs or sprites. OpenFreeMap has no SLA: the fallback exists
 * for that. All values are PUBLIC URLs, never secrets.
 *
 * Handling: values are trimmed, an empty string counts as unset, an invalid value logs ONE warning and behaves as
 * unset. A bad value must never break page rendering. URLs must be absolute https (plain http only for localhost
 * outside production) and carry no credentials.
 */
import type { StreetTileConfig } from "~/globe/street/types";

export const DEFAULT_PRIMARY_URL = "https://tiles.openfreemap.org/planet";
export const DEFAULT_MAX_FALLBACK_ZOOM = 14;

export interface TilesConfigOptions {
  /** Allow `http://localhost` (development only). */
  dev?: boolean;
  warn?: (message: string) => void;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Validate a tile URL; returns the normalised string or an explanation of what is wrong. */
export function validateTileUrl(raw: string, dev: boolean): { ok: true; url: string } | { ok: false; why: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, why: "not an absolute URL" };
  }
  if (u.username || u.password) return { ok: false, why: "credentials in a URL are not allowed" };
  if (u.protocol === "https:") return { ok: true, url: u.toString() };
  if (u.protocol === "http:" && dev && LOCAL_HOSTS.has(u.hostname)) return { ok: true, url: u.toString() };
  return { ok: false, why: u.protocol === "http:" ? "plain http is only allowed for localhost in development" : "only https URLs are allowed" };
}

const clean = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

/** Pure: resolve the three values from an environment object. */
export function resolveTilesConfig(env: Record<string, string | undefined>, options: TilesConfigOptions = {}): StreetTileConfig {
  const dev = options.dev ?? false;
  const warn = options.warn ?? ((m: string) => console.warn(m));

  let primaryUrl = DEFAULT_PRIMARY_URL;
  const primary = clean(env.CATALYST_TILES_PRIMARY_URL);
  if (primary !== undefined) {
    const r = validateTileUrl(primary, dev);
    if (r.ok) primaryUrl = r.url;
    else warn(`[tiles] CATALYST_TILES_PRIMARY_URL ignored (${r.why}); using ${DEFAULT_PRIMARY_URL}`);
  }

  let fallbackPmtilesUrl: string | null = null;
  const fallback = clean(env.CATALYST_TILES_FALLBACK_URL);
  if (fallback !== undefined) {
    const r = validateTileUrl(fallback, dev);
    if (r.ok) fallbackPmtilesUrl = r.url;
    else warn(`[tiles] CATALYST_TILES_FALLBACK_URL ignored (${r.why}); the fallback is disabled`);
  }

  let maxFallbackZoom = DEFAULT_MAX_FALLBACK_ZOOM;
  const zoom = clean(env.CATALYST_TILES_MAX_FALLBACK_ZOOM);
  if (zoom !== undefined) {
    const n = Number(zoom);
    if (/^\d+$/.test(zoom) && Number.isInteger(n) && n >= 0 && n <= 15) maxFallbackZoom = n;
    else warn(`[tiles] CATALYST_TILES_MAX_FALLBACK_ZOOM ignored (expected an integer from 0 to 15); using ${DEFAULT_MAX_FALLBACK_ZOOM}`);
  }

  return { primaryUrl, fallbackPmtilesUrl, maxFallbackZoom };
}

let cached: StreetTileConfig | undefined;

/** The configuration of this process: validated once (one warning per bad value), then reused. */
export function getTilesConfig(): StreetTileConfig {
  cached ??= resolveTilesConfig(process.env, { dev: process.env.NODE_ENV !== "production" });
  return cached;
}
