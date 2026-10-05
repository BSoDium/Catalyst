import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  // Pathless layout: `/` and `/locations/:slug` share one globe instance.
  layout("routes/shell.tsx", [index("routes/home.tsx"), route("locations/:slug", "routes/location.tsx")]),
  route("projects", "routes/projects.tsx"),
  route("articles", "routes/articles.tsx"),
  route("artworks", "routes/artworks.tsx"),
] satisfies RouteConfig;
