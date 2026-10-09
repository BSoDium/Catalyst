import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

// `/dev/street` (the street map on its own, for checks and measurements) and `/dev/design` (the UI system's styleguide) exist
// only in development or in a build made with CATALYST_DEV_ROUTES=1; their loaders answer 404 anywhere else.
// See docs/street-architecture.md and docs/design-system.md.
const devRoutes =
  process.env.NODE_ENV !== "production" || process.env.CATALYST_DEV_ROUTES === "1"
    ? [route("dev/street", "routes/dev-street.tsx"), route("dev/street-lines", "routes/dev-street-lines.tsx"), route("dev/design", "routes/dev-design.tsx")]
    : [];

export default [
  // Pathless layout: `/` and `/locations/:slug` share one globe instance.
  layout("routes/shell.tsx", [index("routes/home.tsx"), route("locations/:slug", "routes/location.tsx")]),
  route("projects", "routes/projects.tsx"),
  route("articles", "routes/articles.tsx"),
  route("artworks", "routes/artworks.tsx"),
  ...devRoutes,
] satisfies RouteConfig;
