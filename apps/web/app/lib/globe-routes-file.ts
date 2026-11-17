import { createHash } from "node:crypto";

/** The route (a resource route, `routes/globe-routes.ts`) that renders the routes' JSON: what a dev server serves, and what the build prerenders. */
export const GLOBE_ROUTES_ROUTE = "/globe-routes.json";

/** 12 characters of the SHA-256 of the JSON text: the file's name, so its address changes with its content and never otherwise. */
export const globeRoutesHash = (json: string): string => createHash("sha256").update(json, "utf8").digest("hex").slice(0, 12);

/** Where the build puts the prerendered file (`scripts/prerender/seal-csp.mts`), named by its content. No dependencies: the build script imports this file as it is. */
export const globeRoutesFile = (json: string): string => `/data/globe-routes.${globeRoutesHash(json)}.json`;
