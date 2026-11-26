import { NavLink } from "react-router";
import { MarkdownLink } from "~/components/markdown-link";
import { Icon } from "~/components/ui/icon";
import { CAREER_LABEL, CAREER_PATH } from "~/lib/career";
import { KIND_PATHS, KIND_PLURALS } from "~/lib/entries";
import { LLMS_TXT_PATH } from "~/lib/markdown-path";
import { ARCHIVED_V1, SITE, SITE_IDENTITY } from "~/lib/site";
import { useHasCareer } from "~/lib/use-has-career";
import { cn } from "~/lib/utils";

/** The sections, in the header's order (`components/navbar.tsx`; the names and addresses are `lib/sections.ts`'s), after the globe. */
const SECTION_KINDS = ["project", "article", "artwork", "poem", "photograph"] as const;

export interface SiteFooterProps {
  /** The page's own path: its Markdown twin is `<path>.md`. */
  path: string;
  /** The page content's width and side padding: the band runs edge to edge, its content on the page's own column. */
  className?: string;
  /** A fixed answer in place of the projection's (tests): whether the career page is in the sections. */
  hasCareer?: boolean;
}

/** The first version of the site's address as a reader sees it: the host, no scheme (`v1.bsodium.fr`). */
const ARCHIVE_HOST = new URL(ARCHIVED_V1.url).host;

/**
 * The site footer (docs/design-system.md, "Site footer"): the end of every page that has a Markdown twin, and the one home of the link
 * to it. Not on the home page (the globe fills the screen; its head carries the `alternate` link), nor on the 404 and error pages
 * (nothing to read as text). Facts only, from the site's own tables: the owner's name and line (`SITE`), the sections (`KIND_PATHS`,
 * the career page while there is one), the page in Markdown and the site map for agents (`/llms.txt`), and where the first version of
 * the site is kept (`ARCHIVED_V1`). No copyright line (the owner's decision is pending; an entry's work says its own notice above).
 *
 * A band a whisper off the page (4 % of the ink in the page colour, app.css), from edge to edge of the window or the panel, with no
 * rule inside it; its content on the page's own column (`className` is the content's width and side padding). The first version of
 * the site is a quiet sentence at the foot of the who column, not a row of its own. ONE markup everywhere: in the side panel beside the globe (an
 * entry, a place; and the phone's slide-over) CSS draws its short form, the links for agents only, since the header and the globe are
 * right there; the full-screen entry has it whole. (The same markup, so an entry's text does not change with its container:
 * `entry-view.test.ts`.)
 *
 * A `<footer>` outside any sectioning element is the page's `contentinfo` landmark: the lists and the career page render it after their
 * `main`. In the shell it ends the panel's content inside the panel's own landmark, so it is that panel's footer, not a second
 * `contentinfo`. Not printed: everything in it is a way somewhere else.
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
    <footer data-slot="site-footer" className="site-footer print:hidden">
      <div className={cn("site-footer-inner", className)}>
        <div className="site-footer-grid">
          <div className="site-footer-who">
            <p className="site-footer-name">{SITE.name}</p>
            <p className="site-footer-line">{SITE_IDENTITY}</p>
            {/* (at the foot of the column, level with the last row of the lists beside it: no row of its own) */}
            <p className="site-footer-archive">
              {ARCHIVED_V1.sub}:{" "}
              <a href={ARCHIVED_V1.url} rel="noopener" className="site-footer-link">
                {ARCHIVE_HOST}
                <Icon name="arrow-up-right" size="inline" />
              </a>
            </p>
          </div>
          <nav aria-labelledby="site-footer-sections" className="site-footer-group site-footer-nav">
            <p id="site-footer-sections" className="site-footer-label type-meta">
              Sections
            </p>
            <ul className="site-footer-list" data-columns="2">
              {sections.map((s) => (
                <li key={s.to}>
                  <NavLink to={s.to} end prefetch="intent" className="site-footer-link">
                    {s.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="site-footer-group site-footer-agents">
            <p className="site-footer-label type-meta">For agents</p>
            <ul className="site-footer-list">
              <li>
                <MarkdownLink path={path} className="site-footer-link" />
              </li>
              <li>
                <a href={LLMS_TXT_PATH} type="text/plain" className="site-footer-link">
                  Site map (llms.txt)
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
