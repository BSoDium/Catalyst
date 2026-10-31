import { loadPublishedProjection } from "@catalyst/published";
import type { PublishedProjection } from "@catalyst/schemas";

/**
 * The content modes the API knows: `published` is the only one a deployment can serve. `demo` is accepted as a name so a mistaken
 * `CATALYST_CONTENT=demo` is refused with a clear message; the fixture itself is not in the API bundle (`@catalyst/published/dev`,
 * which tests inject through `loadContent`'s second argument). The local `preview` file is never served.
 */
export type ApiMode = "published" | "demo";

function loadServed(mode: ApiMode) {
  if (mode !== "published") throw new Error(`CATALYST_CONTENT "${mode}" is not available in the API build: it serves the published snapshot only`);
  return loadPublishedProjection();
}

export type ContentState =
  | { status: "ready"; mode: ApiMode; projection: PublishedProjection }
  | { status: "invalid"; reason: string };

export interface ContentEnv {
  CATALYST_CONTENT?: string | undefined;
}

/** Unset or empty means `published`. Anything unrecognised is an error, never a silent fallback. */
export function resolveMode(raw: string | undefined): ApiMode {
  const value = raw?.trim();
  if (value === undefined || value === "" || value === "published") return "published";
  if (value === "demo") return "demo";
  throw new Error(`Invalid CATALYST_CONTENT "${value}": expected "published" or "demo"`);
}

/**
 * Select and validate the projection exactly once. Never throws: callers decide
 * how loudly to fail (the node server exits, the Vercel entry serves 503s).
 * `load` is injectable so the failure path is testable.
 */
export function loadContent(
  env: ContentEnv,
  load: (mode: ApiMode) => PublishedProjection = loadServed,
): ContentState {
  try {
    const mode = resolveMode(env.CATALYST_CONTENT);
    return { status: "ready", mode, projection: load(mode) };
  } catch (err) {
    return { status: "invalid", reason: err instanceof Error ? err.message : String(err) };
  }
}
