// A trip's own public page is meant to be public (`routes[].url`, docs/api-contract.md). Its address has ONE shape: https on the trip site, then
// the author, then `<number>-<slug>`, plain path characters only. That shape is not private vocabulary; anything else that names the site still fails.

/** The address of a trip page, on its own (no key, no quotes around it). */
const TRIP_PAGE = String.raw`https:\/\/www\.polarsteps\.com\/[A-Za-z0-9._-]+\/[0-9]+-[A-Za-z0-9-]+`;

/** In the published projection the address is accepted only as the value of a `"url"` key: exactly the shape the contract gives it. */
const IN_PROJECTION = new RegExp(`"url": "${TRIP_PAGE}"`, "g");

/**
 * The same addresses inside a BUNDLE: the projection is compiled into the server and API bundles (as an object literal, a JSON string with
 * escaped quotes or a minified JSON text), so the key is no longer spelled the way it is in the data file. There the bare address, in the
 * one shape above, is accepted; the word anywhere else still fails.
 */
// (It must END there: no query, fragment or further path after it, or it is a different address and fails.)
const IN_BUNDLE = new RegExp(`${TRIP_PAGE}(?![A-Za-z0-9._?#/%=&~-])`, "g");

/**
 * A PRERENDERED PAGE (`build/client/**\/*.html`) also says where the link goes, in words: the label `tripLinkLabel` derives from the address ("See the whole trip on
 * polarsteps.com", app/lib/journeys.ts). That sentence, whole and ending where the element does, is the one other accepted spelling; a bare "polarsteps.com" elsewhere fails.
 */
const IN_PAGE_LABEL = /See the whole trip on polarsteps\.com(?=<)/g;

/** `text` with the accepted trip-page addresses replaced, so that the vocabulary scan does not see them. `kind` is "projection", "bundle" or "page" (a bundle, and a prerendered page's label). */
export function neutralizeTripPages(text, kind) {
  if (kind === "projection") return text.replace(IN_PROJECTION, '"url": "<trip page>"');
  const bare = text.replace(IN_BUNDLE, "<trip page>");
  return kind === "page" ? bare.replace(IN_PAGE_LABEL, "<trip link label>") : bare;
}

/**
 * The brand wiring of the trip link (the owner's decision, 2026-11-18: the button to the trip site wears its colour and mark, like the buttons to Pexels and ArtStation). Three spellings, and no others, say the
 * trip site's name for that: the table in `app/lib/journeys.ts` (`"<host>": "<brand>"`, in any quoting a bundler writes), the attribute on the link (`data-brand="..."`, in a prerendered page and in a bundle) and its
 * CSS selector (`[data-brand=...]`). `neutralizeBrandWiring` replaces them so the vocabulary scan does not see them; the word anywhere else (an importer's name, a variable, a path) still fails.
 */
const BRAND_TABLE = /["']?polarsteps\.com["']?\s*:\s*["']polarsteps["']/g;
const BRAND_ATTRIBUTE = /data-brand=\\?["']polarsteps\\?["']/g;
const BRAND_SELECTOR = /\[data-brand=["']?polarsteps["']?\]/g;

export function neutralizeBrandWiring(text) {
  return text.replace(BRAND_TABLE, "<brand table>").replace(BRAND_ATTRIBUTE, "data-brand=<brand>").replace(BRAND_SELECTOR, "[data-brand=<brand>]");
}
