import { parsePublishedProjection, type PublishedProjection } from "@catalyst/schemas";
import published from "../data/projection.json";

// This entry is what a deployment bundles: the committed snapshot and nothing else. The demo fixture, the local preview loader and the
// content modes live in `./dev` (`@catalyst/published/dev`), imported by the web dev server, the tools and the tests only (issue #238).

/**
 * The last published projection. Merged via PR from the private content repo;
 * this is the snapshot the site keeps serving if upstream sync breaks.
 */
export function loadPublishedProjection(): PublishedProjection {
  return parsePublishedProjection(published);
}
