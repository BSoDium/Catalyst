import { loadProjection, type ContentMode } from "@catalyst/published";
import type { PublishedProjection } from "@catalyst/schemas";

export type ContentState =
  | { status: "ready"; mode: ContentMode; projection: PublishedProjection }
  | { status: "invalid"; reason: string };

export interface ContentEnv {
  CATALYST_CONTENT?: string | undefined;
}

/** Unset or empty means `published`. Anything unrecognised is an error, never a silent fallback. */
export function resolveMode(raw: string | undefined): ContentMode {
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
  load: (mode: ContentMode) => PublishedProjection = loadProjection,
): ContentState {
  try {
    const mode = resolveMode(env.CATALYST_CONTENT);
    return { status: "ready", mode, projection: load(mode) };
  } catch (err) {
    return { status: "invalid", reason: err instanceof Error ? err.message : String(err) };
  }
}
