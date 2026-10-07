import { MotionConfig } from "motion/react";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "./+types/root";
import { DevContentBadge } from "~/components/dev-content-badge";
import { PageNavScrim } from "~/components/nav-scrim";
import { Navbar } from "~/components/navbar";
import { NotFoundPage } from "~/components/not-found-page";
import { SkipLinks } from "~/components/skip-links";
import { getContentMode } from "~/lib/content.server";
import "./app.css";

export const links: Route.LinksFunction = () => [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <Meta />
        <Links />
      </head>
      <body>
        <SkipLinks />
        <div id="app">
          <PageNavScrim />
          <Navbar />
          {children}
        </div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/** Only the dev badge needs this: production builds never expose the content mode (the branch is dead code there). */
export function loader() {
  return { devContentMode: import.meta.env.DEV ? getContentMode() : null };
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
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-2xl px-6 pt-[calc(var(--navbar-height)+3rem)] pb-24">
      <title>Error · Catalyst</title>
      <p className="label">Error</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Something went wrong.</h1>
      <p className="mt-4 text-muted-foreground">Try reloading the page. If it keeps happening, come back a little later.</p>
    </main>
  );
}
