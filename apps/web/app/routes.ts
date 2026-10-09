import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

// `/dev/street` (the street map on its own, for checks and measurements) and `/dev/design` (the UI system's styleguide) exist
// only in development or in a build made with CATALYST_DEV_ROUTES=1; their loaders answer 404 anywhere else.
// See docs/street-architecture.md and docs/design-system.md.
const devRoutes =
  process.env.NODE_ENV !== "production" || process.env.CATALYST_DEV_ROUTES === "1"
    ? [route("dev/street", "routes/dev-street.tsx"), route("dev/street-lines", "routes/dev-street-lines.tsx"), route("dev/design", "routes/dev-design.tsx")]
    : [];

export default [
  // Pathless layout: `/`, `/locations/:slug` and the entries (`/articles/:slug` ...) share one globe instance; the place or the entry
  // opens in the detail panel (an entry also full screen with `?view=full`).
  layout("routes/shell.tsx", [
    index("routes/home.tsx"),
    route("locations/:slug", "routes/location.tsx"),
    route("articles/:slug", "routes/entry-article.tsx"),
    route("projects/:slug", "routes/entry-project.tsx"),
    route("artworks/:slug", "routes/entry-artwork.tsx"),
    route("poems/:slug", "routes/entry-poem.tsx"),
  ]),
  // The lists (no globe).
  route("projects", "routes/projects.tsx"),
  route("articles", "routes/articles.tsx"),
  route("artworks", "routes/artworks.tsx"),
  route("poems", "routes/poems.tsx"),
  // Resource routes (no UI): the crawlers' files. `manifest.webmanifest`, the favicons and the share image are static files in public/.
  route("sitemap.xml", "routes/sitemap.ts"),
  route("robots.txt", "routes/robots.ts"),
  // The quick search's index (titles and tags of the places and entries), fetched when the palette first opens.
  route("search-index.json", "routes/search-index.ts"),
  ...devRoutes,
] satisfies RouteConfig;
