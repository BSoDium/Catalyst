// Which content `pnpm dev` serves. Pure so it is unit-tested (app/lib/dev-content.test.ts).
//
// Rules: an explicit CATALYST_CONTENT always wins. Otherwise the local preview (the owner's real places, written by
// `pnpm export:preview` in the private repo) when its file exists, else the committed published projection (empty
// until the first publication). Demo placeholder data is NEVER chosen implicitly: only `pnpm dev:demo`.

export const PREVIEW_HINT =
  "[catalyst] no local preview yet: serving the published projection (empty state). To see your real places, run " +
  "`pnpm export:preview --out <this repo>` in the private catalyst-content repo, then restart `pnpm dev`.";

export const PREVIEW_NOTICE = "[catalyst] dev content: PREVIEW (your real places incl. unpublished drafts; local only, never published)";

/**
 * @param {{ env: Record<string, string | undefined>, previewExists: boolean }} input
 * @returns {{ content: string, message: string | null }}
 */
export function resolveDevContent({ env, previewExists }) {
  const explicit = env.CATALYST_CONTENT?.trim();
  if (explicit) return { content: explicit, message: null };
  if (previewExists) return { content: "preview", message: PREVIEW_NOTICE };
  return { content: "published", message: PREVIEW_HINT };
}

/** Adds the default dev port unless the caller passed one. */
export function devArgs(args) {
  const hasPort = args.some((a) => a === "--port" || a.startsWith("--port=") || a === "-p");
  return ["dev", ...(hasPort ? [] : ["--port", "5173"]), ...args];
}
