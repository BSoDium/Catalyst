import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

// `/dev/street` (the street map on its own, for checks and measurements) and `/dev/design` (the UI system's styleguide) exist
// only in development or in a build made with CATALYST_DEV_ROUTES=1; their loaders answer 404 anywhere else.
// See docs/street-architecture.md and docs/design-system.md.
const devRoutes =
  process.env.NODE_ENV !== "production" || process.env.CATALYST_DEV_ROUTES === "1"
    ? [route("dev/street", "routes/dev-street.tsx"), route("dev/street-lines", "routes/dev-street-lines.tsx"), route("dev/design", "routes/dev-design.tsx"), route("dev/entry-layout", "routes/dev-entry-layout.tsx")]
    : [];

export default [
  // Pathless layout: `/`, `/locations/:slug` and the entries (`/articles/:slug` ...) share one globe instance; the place or the entry
  // opens in the detail panel (an entry also full screen with `?view=full`).
  layout("routes/shell.tsx", [
    index("routes/home.tsx"),
    route("locations/:slug", "routes/location.tsx"),
    route("articles/:slug", "routes/entry-article.tsx"),
    route("software/:slug", "routes/entry-project.tsx"),
    route("artworks/:slug", "routes/entry-artwork.tsx"),
    route("poetry/:slug", "routes/entry-poem.tsx"),
    route("photography/:slug", "routes/entry-photograph.tsx"),
  ]),
  // The lists (no globe).
  route("software", "routes/software.tsx"),
  route("articles", "routes/articles.tsx"),
  route("artworks", "routes/artworks.tsx"),
  route("poetry", "routes/poetry.tsx"),
  route("photography", "routes/photography.tsx"),
  // The career page: a singleton document of the projection, not a content kind; the loader answers 404 while there is none.
  route("career", "routes/career.tsx"),
  // The sections' former addresses, before they were named "Poetry" (`/poems`) and "Software" (`/projects`): permanent redirects, query kept
  // (lib/legacy-paths.ts; the names are one table, lib/sections.ts).
  route("poems", "routes/legacy-poems.ts", { id: "legacy-poems" }),
  route("poems/:slug", "routes/legacy-poems.ts", { id: "legacy-poem" }),
  route("projects", "routes/legacy-projects.ts", { id: "legacy-projects" }),
  route("projects/:slug", "routes/legacy-projects.ts", { id: "legacy-project" }),
  // Resource routes (no UI): the crawlers' files. `manifest.webmanifest`, the favicons and the share image are static files in public/.
  route("sitemap.xml", "routes/sitemap.ts"),
  route("robots.txt", "routes/robots.ts"),
  // The quick search's index (titles and tags of the places and entries), fetched when the palette first opens.
  route("search-index.json", "routes/search-index.ts"),
  ...devRoutes,
] satisfies RouteConfig;
