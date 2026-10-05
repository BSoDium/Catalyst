import { Link } from "react-router";

/** Global 404 (unmatched URL). */
export function NotFoundPage() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-2xl px-6 pt-[calc(var(--navbar-height)+3rem)] pb-24">
      <title>Page not found · Catalyst</title>
      <p className="label">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found.</h1>
      <p className="mt-4 text-muted-foreground">There is nothing at this address.</p>
      <p className="mt-6">
        <Link to="/" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:no-underline">
          Back to the globe
        </Link>
      </p>
    </main>
  );
}
