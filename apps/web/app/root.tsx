import { MotionConfig } from "motion/react";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "./+types/root";
import { DevContentBadge } from "~/components/dev-content-badge";
import { ErrorPage } from "~/components/error-page";
import { NavProgress } from "~/components/nav-progress";
import { PageNavScrim } from "~/components/nav-scrim";
import { Navbar } from "~/components/navbar";
import { NotFoundPage } from "~/components/not-found-page";
import { SkipLinks } from "~/components/skip-links";
import { getContentMode } from "~/lib/content.server";
import { THEME_COLORS } from "~/lib/site";
import { getSiteUrl } from "~/lib/site.server";
import "./app.css";

// The icons: a vector favicon that follows the colour scheme, the classic .ico for what ignores it, the home-screen icon, the manifest.
// The files are in public/ (drawn by scripts/brand/build.mjs); nothing here is fetched from another origin.
export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
  { rel: "manifest", href: "/manifest.webmanifest" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        {/* The browser's own UI (address bar, status bar) takes the page colour of the visitor's scheme. */}
        <meta name="theme-color" content={THEME_COLORS.light} media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content={THEME_COLORS.dark} media="(prefers-color-scheme: dark)" />
        <Meta />
        <Links />
      </head>
      <body>
        <SkipLinks />
        <div id="app">
          <PageNavScrim />
          <Navbar />
          <NavProgress />
          {children}
        </div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/** `siteUrl` is the origin every canonical and Open Graph URL is built on (`CATALYST_SITE_URL`): the routes' `meta` reads it from here, so the server and the client agree. */
export function loader() {
  // Only the dev badge needs the content mode: production builds never expose it (the branch is dead code there).
  return { siteUrl: getSiteUrl(), devContentMode: import.meta.env.DEV ? getContentMode() : null };
}

/** The site origin and the dev badge never change while the app runs: no navigation (a `?view=full` toggle, a filter chip, a tag link) reloads them. */
export function shouldRevalidate() {
  return false;
}

export default function App({ loaderData }: Route.ComponentProps) {
  // "user": transform/layout animations are disabled when the OS asks for reduced motion.
  return (
    <MotionConfig reducedMotion="user">
      <Outlet />
      <DevContentBadge mode={loaderData.devContentMode} />
    </MotionConfig>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  return <ErrorPage error={error} />;
}
