import { Link } from "react-router";
import type { ContentListItem } from "~/lib/projection";

interface ContentPageProps {
  heading: string;
  items: ContentListItem[];
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Shared page for /projects, /articles and /artworks. Each item's anchor id is its slug. */
export function ContentPage({ heading, items }: ContentPageProps) {
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-2xl px-6 pt-[calc(var(--navbar-height)+3rem)] pb-24">
      <h1 className="text-3xl font-semibold tracking-tight">{heading}</h1>
      {items.length === 0 ? (
        <div className="mt-10">
          <p className="text-muted-foreground">Nothing here yet.</p>
          <p className="mt-4">
            <Link to="/" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 hover:no-underline">
              Back to the globe
            </Link>
          </p>
        </div>
      ) : (
        <ul className="mt-10 divide-y divide-border border-y border-border">
          {items.map((item) => (
            <li key={item.slug}>
              <article id={item.slug} aria-labelledby={`${item.slug}-title`} className="py-8">
                {item.date && <p className="label">{item.date}</p>}
                <h2 id={`${item.slug}-title`} className="mt-1 text-xl font-semibold tracking-tight">
                  {item.title}
                </h2>
                {item.summary && <p className="mt-3 text-muted-foreground">{item.summary}</p>}
                {(item.url || item.places.length > 0) && (
                  <ul className="mt-4 flex flex-wrap gap-x-5 text-sm">
                    {item.url && (
                      <li>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-11 min-w-11 items-center underline underline-offset-4 hover:no-underline"
                        >
                          {hostOf(item.url)}
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      </li>
                    )}
                    {item.places.map((place) => (
                      <li key={place.slug}>
                        <Link
                          to={place.href}
                          className="inline-flex min-h-11 min-w-11 items-center text-muted-foreground underline underline-offset-4 hover:text-foreground hover:no-underline"
                        >
                          {place.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
