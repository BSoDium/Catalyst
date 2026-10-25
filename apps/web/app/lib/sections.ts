import type { ContentKind } from "@catalyst/schemas";

/**
 * The sections of the site and their contract kinds, in one table. Pure.
 *
 * Two names exist for each kind and they are NOT the same thing:
 *
 *   - the contract's kind id (`article`, `project`, `artwork`, `poem`, `photograph`): an interface (schemaVersion 1: the projection's `projects` /
 *     `poems` collections, the API's `/v1/projects`, the private repo's `content/projects/`, `data-kind="project"`, the `--kind-project`
 *     token). It is never renamed here; and
 *   - the section's PUBLIC name, which is the owner's to choose and has been changed twice: the poems' section is "Poetry" (`/poetry`), the
 *     projects' section is "Software" (`/software`; "project" is too generic a word for what the section holds).
 *
 * Everything the visitor reads or follows (address, title, label, count, search group, header and hero rows, sitemap, breadcrumbs, no-JS
 * text) comes out of this table, through `KIND_PATHS`, `KIND_LABELS`, `KIND_PLURALS` and `KIND_NOUNS` in `lib/entries.ts`. A new rename
 * is a change to ONE row here (plus the route files in `routes.ts`, whose test fails until they follow) and nothing else.
 *
 * `formerSlugs` are the section's earlier addresses: each keeps answering with a permanent redirect to the current one (`lib/legacy-paths.ts`,
 * `routes/legacy-poems.ts`, `routes/legacy-projects.ts`), query string kept, so a link, a bookmark or a search result made before the
 * rename still lands where it meant to.
 */
export interface Section {
  /** The path segment: the list is `/<slug>`, an entry `/<slug>/<entry slug>`. */
  slug: string;
  /** One entry of the kind, title case: the kind tag, the breadcrumb, "More <name>". */
  label: string;
  /** The section's name, title case: the list page's title, the header and hero rows, the search group, the place panel's group. */
  name: string;
  /**
   * What a COUNT says, lowercase. A section's name is not always a count noun ("4 poetry" is not English) and "software" is uncountable: it is
   * its own plural ("1 software", "33 software").
   */
  noun: { one: string; many: string };
  /** Path segments this section was served under before, each redirected (301) to `slug`. */
  formerSlugs: readonly string[];
}

export const SECTIONS: Readonly<Record<ContentKind, Section>> = {
  project: { slug: "software", label: "Software", name: "Software", noun: { one: "software", many: "software" }, formerSlugs: ["projects"] },
  article: { slug: "articles", label: "Article", name: "Articles", noun: { one: "article", many: "articles" }, formerSlugs: [] },
  artwork: { slug: "artworks", label: "Artwork", name: "Artworks", noun: { one: "artwork", many: "artworks" }, formerSlugs: [] },
  poem: { slug: "poetry", label: "Poem", name: "Poetry", noun: { one: "poem", many: "poems" }, formerSlugs: ["poems"] },
  photograph: { slug: "photography", label: "Photograph", name: "Photography", noun: { one: "photograph", many: "photographs" }, formerSlugs: [] },
};
