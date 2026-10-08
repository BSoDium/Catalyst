/**
 * The kinds the data display knows (docs/design-system.md, "Kind coding"). The three published content kinds plus the
 * poem and the place itself. Pure, so the UI components, the styleguide and the tests share one list.
 */
export const ENTRY_KINDS = ["article", "project", "artwork", "poem", "place"] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number];

/** Title case, for reading text and accessible names. Micro-labels uppercase it in CSS. */
export const ENTRY_KIND_LABEL: Record<EntryKind, string> = {
  article: "Article",
  project: "Project",
  artwork: "Artwork",
  poem: "Poem",
  place: "Place",
};

export function isEntryKind(value: unknown): value is EntryKind {
  return typeof value === "string" && (ENTRY_KINDS as readonly string[]).includes(value);
}
