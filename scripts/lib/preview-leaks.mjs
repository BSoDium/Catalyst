// Helpers for the preview-leak part of scripts/check-public-leaks.mjs (unit-tested in preview-leaks.test.mjs).
// The preview file holds the owner's REAL places including unpublished drafts: it may exist locally (git-ignored)
// but must never be tracked, never be unignored-untracked, and never end up inside a production bundle.

export const PREVIEW_FILE = "packages/published/data/preview.projection.json";

/**
 * Up to `max` places spread evenly over the file (deterministic), skipping names too short to be a meaningful probe and the slugs in
 * `published` (a place the site already publishes is meant to be in the bundles: only the drafts can leak).
 */
export function samplePreviewPlaces(projection, max = 12, published = new Set()) {
  const places = (projection?.places ?? []).filter((p) => typeof p?.slug === "string" && typeof p?.name === "string" && p.name.length >= 3 && !published.has(p.slug));
  if (places.length <= max) return places;
  const out = [];
  for (let i = 0; i < max; i++) out.push(places[Math.floor((i * places.length) / max)]);
  return out;
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Matches a place record the way it would survive in a bundle: `slug`, then the slug, then `name`, then the name,
 * each separated by 1-6 non-word characters (`":"`, `:"`, `\\":\\"`, `","`...). Requiring the slug and the key names
 * next to the name keeps a country or city name in unrelated data (geodata, tiles config) from matching.
 */
export function placeSignature(place) {
  return new RegExp(`slug\\W{1,6}${escapeRegExp(place.slug)}\\W{1,6}name\\W{1,6}${escapeRegExp(place.name)}\\W`);
}

/** Preview files that must not exist in the repo: tracked, or untracked and not ignored. */
export function previewFilesInRepoListing(listing) {
  return listing.filter((f) => /(^|\/)preview\.projection(\.[^/]*)?$/.test(f));
}

/**
 * @param {{ file: string, text: string }[]} files bundle files (relative path + text)
 * @param {object} projection the parsed preview file
 * @param {number} max how many places to probe
 * @param {Set<string>} published slugs of the places the site publishes (never probed)
 * @returns {string[]} failure messages that never print a place name
 */
export function findPreviewLeaks(files, projection, max = 12, published = new Set()) {
  const sample = samplePreviewPlaces(projection, max, published);
  const sigs = sample.map(placeSignature);
  const failures = [];
  for (const { file, text } of files) {
    if (/(^|\/)preview\.projection/.test(file)) failures.push(`preview data: the preview file itself is in the bundle: ${file}`);
    const hits = sigs.filter((re) => re.test(text)).length;
    if (hits > 0) failures.push(`preview data: ${hits} of ${sample.length} sampled preview places found in ${file} (the local preview file was bundled)`);
  }
  return failures;
}
