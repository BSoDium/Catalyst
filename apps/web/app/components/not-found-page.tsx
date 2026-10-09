import { Link } from "react-router";
import { Button, Glyph, StatePanel } from "~/components/ui";

/** Global 404 (unmatched URL, or an entry slug that does not exist): the empty state of the UI system on the plain page. */
export function NotFoundPage() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-2xl px-6 pt-[calc(var(--navbar-height)+3rem)] pb-24 outline-none">
      <title>Page not found · Catalyst</title>
      <StatePanel
        state="empty"
        headingLevel={1}
        code="404 / NOT FOUND"
        title="Page not found"
        description="There is nothing at this address. It may have been moved or never existed."
        action={
          <Button asChild variant="secondary">
            <Link to="/">
              <Glyph name="arrow-left" size={16} />
              Back to the globe
            </Link>
          </Button>
        }
      />
    </main>
  );
}
