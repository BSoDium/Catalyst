/**
 * Mature content (docs/design-system.md, "Sensitive media"; the contract field is `sensitive` on an entry, docs/api-contract.md).
 * Pure decisions, shared by the components, the head tags and the structured data, so that one rule decides everywhere:
 *
 *   - an entry's images (cover and image blocks) are drawn blurred until the visitor asks to see them;
 *   - the cover is NEVER used as a share image (Open Graph, Twitter) or as a JSON-LD `image`: a sensitive entry shares the site's
 *     default image, so a link preview or a search result cannot show what the page hides;
 *   - the page asks search engines not to index its images (`noimageindex`).
 *
 * Absent and `false` are the same thing: only `true` counts (the contract's exporter omits the field when it is false).
 */

/** The words of the interface, in one place: the markup, the tests and the browser check all read them. */
export const SENSITIVE_COPY = {
  /** The label drawn on a hidden image, and what a card says in its place. */
  label: "Mature content",
  /** The accessible name of the control that reveals the entry's images (constant: `aria-pressed` carries the state). */
  show: "Show image",
  /** The name of the control that IS the blurred picture (the words on it): pressing it shows the image. */
  view: "View mature content",
  /** The name of the small control that hides a shown image again. */
  hide: "Hide image",
  /** Said where there is no control yet (before hydration, without scripts). */
  hidden: "Image hidden",
  /** Said politely when the control changes the state. */
  announceShown: "Image shown",
  announceHidden: "Image hidden",
} as const;

/** Whether an entry (or a summary, or a ref to one) is mature content. Only a literal `true` counts. */
export function isSensitive(entry: { sensitive?: boolean | undefined } | null | undefined): boolean {
  return entry?.sensitive === true;
}

/**
 * The cover an entry may lend to a share image or to structured data: its own, unless the entry is sensitive. The head tags and the
 * JSON-LD both go through here (then still check the path and the format, see `entry-meta.ts` and `json-ld.ts`).
 */
export function shareableCover<C>(entry: { sensitive?: boolean | undefined; cover?: C | undefined }): C | undefined {
  return isSensitive(entry) ? undefined : entry.cover;
}
