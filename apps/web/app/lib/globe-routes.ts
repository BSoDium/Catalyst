import type { PublishedProjection } from "@catalyst/schemas";
import { GLOBE_ROUTES_ROUTE, globeRoutesFile } from "./globe-routes-file";
import { resolveRoutes } from "./projection";

const cache = new WeakMap<PublishedProjection, string>();

/** The routes' polylines as JSON (the body of `GLOBE_ROUTES_ROUTE`), made once per projection. */
export function globeRoutesJson(projection: PublishedProjection): string {
  let json = cache.get(projection);
  if (json === undefined) {
    json = JSON.stringify(resolveRoutes(projection));
    cache.set(projection, json);
  }
  return json;
}

/**
 * The address the globe fetches its routes from. In a build: the content-named static file (`globeRoutesFile`; moved out of the route's own path after the
 * build, because the host answers that path with the function; immutable for a year, `vercel.json`). In development, where nothing is built: the route.
 */
export function globeRoutesSrc(projection: PublishedProjection, prod: boolean): string {
  return prod ? globeRoutesFile(globeRoutesJson(projection)) : GLOBE_ROUTES_ROUTE;
}
