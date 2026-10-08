import { Hono, type Context } from "hono";
import { SCHEMA_VERSION } from "@catalyst/schemas";
import type { ApiError, HealthResponse, HealthUnavailableResponse } from "./contract";
import type { ContentState } from "./content";
import { buildSnapshot, CONTENT_COLLECTIONS, HEALTH_PATH, STATIC_PATHS, type Entry, type Snapshot } from "./snapshot";

export const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=86400";
const ALLOWED_METHODS = "GET, HEAD, OPTIONS";
const PLACE_PREFIX = "/v1/places/";
/** Detail endpoints: `/v1/places/:slug` and `/v1/<projects|articles|artworks|poems>/:slug`. */
const DETAIL_PREFIXES: readonly string[] = [PLACE_PREFIX, ...CONTENT_COLLECTIONS.map((c) => `${c.list}/`)];

/** True when an If-None-Match header matches `etag` (weak comparison, per RFC 9110). */
export function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((candidate) => candidate.trim().replace(/^W\//, "") === etag);
}

function errorBody(code: ApiError["error"]["code"], message: string): ApiError {
  return { error: { code, message } };
}

/**
 * Build the Hono app for a given content state. Pure and side-effect free, so
 * tests can create as many instances as they need. `src/index.ts` is the only
 * place that reads the environment.
 */
export function createApp(state: ContentState): Hono {
  const app = new Hono();
  const snapshot: Snapshot | undefined = state.status === "ready" ? buildSnapshot(state.projection) : undefined;
  const mode = state.status === "ready" ? state.mode : undefined;

  const isKnownPath = (path: string): boolean => {
    if (path === HEALTH_PATH || (STATIC_PATHS as readonly string[]).includes(path)) return true;
    if (!snapshot) return DETAIL_PREFIXES.some((prefix) => path.startsWith(prefix) && path.length > prefix.length);
    return snapshot.entries.has(path);
  };

  const fail = (
    c: Context,
    status: 404 | 405 | 500 | 503,
    code: ApiError["error"]["code"],
    message: string,
  ): Response => {
    c.header("Cache-Control", "no-store");
    return c.json(errorBody(code, message), status);
  };

  // Headers common to every response, errors included. Public data by design:
  // CORS is open, read-only, and never credentialed. No cookie is ever set.
  app.use("*", async (c, next) => {
    await next();
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Expose-Headers", "ETag");
    c.header("X-Content-Type-Options", "nosniff");
  });

  // Method gate: only GET, HEAD and OPTIONS ever reach a handler.
  app.use("*", async (c, next) => {
    const path = c.req.path;
    if (!isKnownPath(path)) return next();
    const method = c.req.method;
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          Allow: ALLOWED_METHODS,
          "Access-Control-Allow-Methods": ALLOWED_METHODS,
          "Access-Control-Allow-Headers": "If-None-Match, Accept",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    if (method !== "GET" && method !== "HEAD") {
      c.header("Allow", ALLOWED_METHODS);
      return fail(c, 405, "method_not_allowed", `${method} is not allowed on ${path}; this API is read-only`);
    }
    return next();
  });

  const unavailable = (c: Context): Response =>
    fail(c, 503, "content_unavailable", "Content failed validation at startup; see server logs");

  if (!snapshot || !mode) {
    app.get(HEALTH_PATH, (c) => {
      c.header("Cache-Control", "no-store");
      const body: HealthUnavailableResponse = {
        ok: false,
        error: errorBody("content_unavailable", "Content failed validation at startup; see server logs").error,
      };
      return c.json(body, 503);
    });
    for (const path of STATIC_PATHS) app.get(path, unavailable);
    for (const prefix of DETAIL_PREFIXES) app.get(`${prefix}:slug`, unavailable);
  } else {
    const ready = snapshot;

    app.get(HEALTH_PATH, (c) => {
      c.header("Cache-Control", "no-store");
      const body: HealthResponse = {
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        content: mode,
        counts: ready.counts,
      };
      return c.json(body);
    });

    const serve = (c: Context): Response => {
      const hit: Entry | undefined = ready.entries.get(c.req.path);
      if (!hit) return fail(c, 404, "not_found", `No resource at ${c.req.path}`);
      c.header("ETag", hit.etag);
      c.header("Cache-Control", CACHE_CONTROL);
      if (ifNoneMatchHits(c.req.header("If-None-Match"), hit.etag)) return c.body(null, 304);
      c.header("Content-Type", "application/json; charset=UTF-8");
      return c.body(hit.body, 200);
    };
    for (const path of STATIC_PATHS) app.get(path, serve);
    for (const prefix of DETAIL_PREFIXES) app.get(`${prefix}:slug`, serve);
  }

  app.notFound((c) => fail(c, 404, "not_found", `No resource at ${c.req.path}`));
  app.onError((err, c) => {
    console.error("Unhandled error", err);
    return fail(c, 500, "internal_error", "Internal server error");
  });

  return app;
}
