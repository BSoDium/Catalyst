import type { PublishedCareer } from "@catalyst/schemas";
import { careerJsonLd, CAREER_LABEL, CAREER_PATH } from "./career";
import { pageMeta } from "./meta";
import { SITE } from "./site";

/**
 * Head tags of `/career`: the title (`Career · <name>`), the profile statement as the description (cut at a word under 160
 * characters: search results cut it anyway), the canonical URL and the structured data. The share image stays the site's default:
 * the portrait is a picture of a person, not a card, and is never offered to scrapers.
 */
export function careerMeta(career: PublishedCareer | undefined, base: { origin?: string | undefined; path?: string | undefined } = {}) {
  if (!career) return pageMeta({ title: "Not found", description: "There is nothing at this address.", noindex: true });
  return pageMeta({
    title: career.title || CAREER_LABEL,
    description: describe(career.summary),
    origin: base.origin,
    path: base.path ?? CAREER_PATH,
    markdown: true,
    jsonLd: base.origin ? careerJsonLd(career, base.origin) : undefined,
  });
}

/** The first 160 characters of the summary, cut at a word with an ellipsis; a short one as it is. */
export function describe(summary: string, max = 160): string {
  const text = summary.trim() || `${SITE.role}.`;
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}
