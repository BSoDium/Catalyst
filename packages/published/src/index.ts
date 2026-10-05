import { parsePublishedProjection, type PublishedProjection } from "@catalyst/schemas";
import demo from "../fixtures/demo.json";
import published from "../data/projection.json";

/**
 * The last published projection. Merged via PR from the private content repo;
 * this is the snapshot the site keeps serving if upstream sync breaks.
 */
export function loadPublishedProjection(): PublishedProjection {
  return parsePublishedProjection(published);
}

/**
 * Demo fixture for development, tests and verification. Contains only
 * placeholder text and must never be deployed as real content.
 */
export function loadDemoProjection(): PublishedProjection {
  return parsePublishedProjection(demo);
}

export type ContentMode = "published" | "demo";

export function loadProjection(mode: ContentMode = "published"): PublishedProjection {
  return mode === "demo" ? loadDemoProjection() : loadPublishedProjection();
}
