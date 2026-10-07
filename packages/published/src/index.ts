import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
 * Demo fixture: PLACEHOLDER TEST DATA (made-up places and text) for automated tests and explicit `pnpm dev:demo`
 * runs. It is never the default anywhere and must never be deployed as real content.
 */
export function loadDemoProjection(): PublishedProjection {
  return parsePublishedProjection(demo);
}

/** Public-repo-relative location of the local preview file (git-ignored, written by `pnpm export:preview` in the private repo). */
export const PREVIEW_FILE = "preview.projection.json";
const PREVIEW_REL = ["packages", "published", "data", PREVIEW_FILE] as const;

export interface PreviewOptions {
  /** Explicit file to read (tests). Default: found next to this package, else upward from the working directory. */
  path?: string;
  env?: Record<string, string | undefined>;
}

/** Candidate locations, most specific first: this package's data dir, then the repo layout upward from the cwd. */
export function previewCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = [resolve(here, "..", "data", PREVIEW_FILE)];
  for (let d = process.cwd(); ; d = dirname(d)) {
    out.push(join(d, ...PREVIEW_REL));
    if (dirname(d) === d) break;
  }
  return [...new Set(out)];
}

/** The preview file that exists, or null. Used by the dev launcher to pick its default mode. */
export function findPreviewFile(): string | null {
  return previewCandidates().find((p) => existsSync(p)) ?? null;
}

/**
 * The owner's LOCAL preview: every place (drafts included), names and positions only, written by
 * `pnpm export:preview` in the private repo. The file is git-ignored and is read here with node:fs at CALL time:
 * never a static import, so no bundler can inline it into a build. Refused in production (NODE_ENV=production)
 * unless CATALYST_ALLOW_PREVIEW=1, which exists only for testing a production build locally with
 * `react-router-serve`; never set it on a deployment.
 */
export function loadPreviewProjection(options: PreviewOptions = {}): PublishedProjection {
  const env = options.env ?? process.env;
  if (env.NODE_ENV === "production" && env.CATALYST_ALLOW_PREVIEW !== "1") {
    throw new Error(
      "preview content is refused in production (it includes unpublished drafts). " +
        "Set CATALYST_ALLOW_PREVIEW=1 only to test a production build locally with react-router-serve.",
    );
  }
  const file = options.path ?? findPreviewFile();
  if (!file || !existsSync(file)) {
    throw new Error(
      `preview projection not found (${options.path ?? `packages/published/data/${PREVIEW_FILE}`}): ` +
        "run `pnpm export:preview --out <this repo>` in the private content repo (catalyst-content).",
    );
  }
  return parsePublishedProjection(JSON.parse(readFileSync(file, "utf8")));
}

/**
 * `published`: the committed projection (the only mode a deployment serves). `preview`: the local, git-ignored
 * file with the owner's real places (dev only). `demo`: placeholder fixture for tests and `pnpm dev:demo`.
 */
export type ContentMode = "published" | "demo" | "preview";

export function loadProjection(mode: ContentMode = "published"): PublishedProjection {
  if (mode === "demo") return loadDemoProjection();
  if (mode === "preview") return loadPreviewProjection();
  return loadPublishedProjection();
}
