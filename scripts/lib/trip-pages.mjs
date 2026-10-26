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

/** `text` with the accepted trip-page addresses replaced, so that the vocabulary scan does not see them. `kind` is "projection" or "bundle". */
export function neutralizeTripPages(text, kind) {
  return text.replace(kind === "projection" ? IN_PROJECTION : IN_BUNDLE, kind === "projection" ? '"url": "<trip page>"' : "<trip page>");
}
