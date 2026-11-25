import { NavLink } from "react-router";
import { FileLink, MarkdownLink } from "~/components/markdown-link";
import { Icon } from "~/components/ui/icon";
import { CAREER_LABEL, CAREER_PATH } from "~/lib/career";
import { KIND_PATHS, KIND_PLURALS } from "~/lib/entries";
import { LLMS_TXT_PATH } from "~/lib/markdown-path";
import { ARCHIVED_V1, SITE, SITE_HANDLE_LINE, SITE_IDENTITY } from "~/lib/site";
import { useHasCareer } from "~/lib/use-has-career";
import { cn } from "~/lib/utils";

/** The sections, in the header's order (`components/navbar.tsx`; the names and addresses are `lib/sections.ts`'s), after the globe. */
const SECTION_KINDS = ["project", "article", "artwork", "poem", "photograph"] as const;

export interface SiteFooterProps {
  /** The page's own path: its Markdown twin is `<path>.md`. */
  path: string;
  /** The page's width and side padding, so the footer's edges are the content's. */
  className?: string;
  /** A fixed answer in place of the projection's (tests): whether the career page is in the sections. */
  hasCareer?: boolean;
}

/**
 * The site footer (docs/design-system.md, "Site footer"): the end of every page that has a Markdown twin, and the one home of the
 * "Read as Markdown" link. Not on the home page (the globe fills the screen; its head carries the `alternate` link), nor on the 404 and
 * error pages (nothing to read as text). Facts only, from the site's own tables: the owner's name and line (`SITE`), the sections
 * (`KIND_PATHS`, the career page while there is one), the page's twin and the site index for agents, the handle the domain is named
 * after, the first version of the site (`ARCHIVED_V1`). No copyright line: a list carries none and software is under the repository's
 * licence; an entry's work says its own notice above (`lib/copyright.ts`). Hairline on top, mono capitals for its labels, the `.md`
 * tile for the files; nothing loud.
 *
 * ONE markup everywhere. In the side panel beside the globe (an entry, a place; and the phone's slide-over) CSS draws its short form,
 * the plain-text files only, since the header and the globe are right there; the full-screen entry has it whole. (The same markup, so
 * an entry's text does not change with its container: `entry-view.test.ts`.)
 *
 * A `<footer>` outside any sectioning element is the page's `contentinfo` landmark: the lists and the career page render it after their
 * `main`. In the shell it ends the panel's content inside the panel's own landmark, so it is that panel's footer, not a second
 * `contentinfo`. Printed, only the handle line stays.
 */
export function SiteFooter({ path, className, hasCareer: forcedCareer }: SiteFooterProps) {
  const storedCareer = useHasCareer();
  const withCareer = forcedCareer ?? storedCareer;
  const sections = [
    { to: "/", label: "Globe" },
    ...SECTION_KINDS.map((kind) => ({ to: KIND_PATHS[kind], label: KIND_PLURALS[kind] })),
    ...(withCareer ? [{ to: CAREER_PATH, label: CAREER_LABEL }] : []),
  ];
  return (
    <footer data-slot="site-footer" className={cn("site-footer", className)}>
      <div className="site-footer-grid print:hidden">
        <div className="site-footer-who">
          <p className="site-footer-name">{SITE.name}</p>
          <p className="site-footer-line">{SITE_IDENTITY}</p>
        </div>
        <nav aria-label="Sections" className="site-footer-group site-footer-nav">
          <p aria-hidden="true" className="site-footer-label type-meta">
            Sections
          </p>
          <ul className="site-footer-sections">
            {sections.map((s) => (
              <li key={s.to}>
                <NavLink to={s.to} end prefetch="intent" className="site-footer-link">
                  {s.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="site-footer-group">
          <p className="site-footer-label type-meta">Plain text</p>
          <ul className="site-footer-files">
            <li>
              <MarkdownLink path={path} />
            </li>
            <li>
              <FileLink href={LLMS_TXT_PATH} type="text/plain" file="llms.txt">
                Site index for agents
              </FileLink>
            </li>
          </ul>
        </div>
      </div>
      <div className="site-footer-legal type-meta">
        <p className="m-0">{SITE_HANDLE_LINE.replace(/\.$/, "")}</p>
        <a href={ARCHIVED_V1.url} rel="noopener" className="site-footer-link site-footer-archive print:hidden">
          {ARCHIVED_V1.shortDescription.replace(/\.$/, "")}
          <Icon name="arrow-up-right" size="inline" />
        </a>
      </div>
    </footer>
  );
}
