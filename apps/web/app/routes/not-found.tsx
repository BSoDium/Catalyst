import { data } from "react-router";

/**
 * The catch-all: an address no route matches is a 404 that the root boundary draws with the site's not-found page. Matching a route (rather
 * than falling out of the router) lets the root loader run, so the page's header knows whether the career page exists and links to it like every other page's.
 */
export function loader() {
  throw data({ message: "Not found" }, { status: 404 });
}

export default function NotFoundRoute() {
  return null;
}
