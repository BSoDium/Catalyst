import { Link, isRouteErrorResponse } from "react-router";
import { Button, Glyph, StatePanel } from "~/components/ui";
import { errorStatus } from "~/lib/error-status";

/**
 * The root error boundary's page for everything that is not a 404: a loader or render error (500) or any other error response. It says
 * what to do, never what happened inside: the message and the stack of an error stay in the server log (React Router already strips them
 * from the page in a production build). Only a development server shows the error's message, to the developer.
 */
export function ErrorPage({ error, showDetail = import.meta.env.DEV }: { error: unknown; showDetail?: boolean }) {
  const status = errorStatus(error);
  const serverSide = status >= 500;
  const detail = showDetail ? (error instanceof Error ? error.message : isRouteErrorResponse(error) ? String(error.data ?? error.statusText) : null) : null;
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-2xl px-6 pt-[calc(var(--navbar-height)+3rem)] pb-24 outline-none">
      <title>{serverSide ? "Something went wrong · Catalyst" : "Request not accepted · Catalyst"}</title>
      <meta name="robots" content="noindex" />
      <StatePanel
        state="error"
        headingLevel={1}
        code={`ERR / ${status}`}
        title={serverSide ? "Something went wrong" : "That request was not accepted"}
        description={
          <>
            {serverSide ? "The page could not be built. This is on our side: try again in a moment, or go back to the globe." : "The address or the request is not one this site can answer. Go back to the globe."}
            {detail && <code className="mt-3 block break-words text-xs">{detail}</code>}
          </>
        }
        action={
          <div className="flex flex-wrap gap-3">
            {serverSide && (
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Try again
              </Button>
            )}
            <Button asChild variant="secondary">
              <Link to="/">
                <Glyph name="arrow-left" size={16} />
                Back to the globe
              </Link>
            </Button>
          </div>
        }
      />
    </main>
  );
}
