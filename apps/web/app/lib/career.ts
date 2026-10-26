/**
 * The career page's pure part (docs/career-page.md): dates as the page shows them, the languages line, the share/structured-data
 * facts. Everything is derived from the projection's `career` (nothing is invented) and the site's own name. No clock: the page
 * shows authored months only ("as of September 2026"), never "x years ago", so server and client agree and nothing goes stale in a
 * cached page.
 */
import type { PublishedCareer, PublishedCareerLanguage, PublishedCareerRole } from "@catalyst/schemas";
import type { IconName } from "~/components/ui/icon";
import { safeExternalUrl, safeMediaSrc } from "./entry-blocks";
import { absoluteUrl } from "./meta";
import { SITE } from "./site";

/** The page's address and its name in the navigation (a career is not a content kind: it has no row of `lib/sections.ts`). */
export const CAREER_PATH = "/career";
export const CAREER_LABEL = "Career";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** `2026-09` -> `September 2026`; `2021` -> `2021`; anything else gives null. Fixed English names: no locale, no time zone. */
export function formatCareerMonth(date: string, style: "long" | "short" = "long"): string | null {
  const m = /^((?:19|20)\d{2})(?:-(0[1-9]|1[0-2]))?$/.exec(date);
  if (!m) return null;
  if (!m[2]) return m[1]!;
  const name = MONTHS[Number(m[2]) - 1]!;
  return `${style === "short" ? name.slice(0, 3) : name} ${m[1]}`;
}

/** `as of September 2026`: the availability's date, as the page words it. */
export function asOfText(asOf: string): string {
  const month = formatCareerMonth(asOf);
  return month ? `as of ${month}` : "";
}

export interface CareerPeriod {
  /** The visible text, `Sep 2025 – Present`. */
  text: string;
  /** Machine-readable parts for `<time>`: the start, and the end when it is a date (`present` and no end have none). */
  start: { text: string; dateTime: string };
  end?: { text: string; dateTime?: string };
  /** A screen reader's sentence: `September 2025 to present`. */
  spoken: string;
}

/**
 * The period of a role or a programme. A missing end (the document says nothing about it) shows the start alone; `present` shows
 * "Present" (no `<time>`: it has no date). The end of a same-year or same-text range is not repeated.
 */
export function careerPeriod(start: string, end: string | undefined): CareerPeriod {
  const from = formatCareerMonth(start, "short") ?? start;
  const fromLong = formatCareerMonth(start) ?? start;
  const startPart = { text: from, dateTime: start };
  if (end === undefined) return { text: from, start: startPart, spoken: `from ${fromLong}` };
  if (end === "present") return { text: `${from} – Present`, start: startPart, end: { text: "Present" }, spoken: `${fromLong} to present` };
  const to = formatCareerMonth(end, "short") ?? end;
  if (to === from) return { text: from, start: startPart, spoken: fromLong };
  return { text: `${from} – ${to}`, start: startPart, end: { text: to, dateTime: end }, spoken: `${fromLong} to ${formatCareerMonth(end) ?? end}` };
}

/**
 * The icon of a timeline item, chosen from the words of its title (a role) or programme (an education): what the person did there, at
 * a glance. The first match wins; the last resort is the briefcase (a role) or the cap (a programme). Pure.
 */
export function careerIcon(text: string, kind: "role" | "education"): IconName {
  const t = text.toLowerCase();
  if (kind === "education") {
    if (/\b(graphics|vision|3d|rendering)\b/.test(t)) return "cuboid";
    if (/\b(math|mathematics|physics|statistics)\b/.test(t)) return "sigma";
    return "graduation-cap";
  }
  if (/\b(found(?:ing|er)|co-?found(?:er)?|ceo|cto)\b/.test(t)) return "rocket";
  if (/full[- ]?stack/.test(t)) return "layers";
  if (/\b(back[- ]?end|devops|infrastructure|platform)\b/.test(t)) return "server";
  if (/\b(design(?:er)?|ux|brand)\b/.test(t)) return "palette";
  if (/\b(front[- ]?end|ui|web|software|engineer|developer)\b/.test(t)) return "code";
  return "career";
}

/**
 * The fallback of `careerLogoSrc`: a square file of the site's own, `public/career-logos/` (NOT `public/media/`, which belongs to the
 * content export and refuses a foreign file), found from the name the owner wrote by these patterns. It serves while the document
 * carries no `logo` for an item (the contract has had the field since this change: the private repo feeds it like the portrait, and
 * a published `logo` wins). Null when there is none: the marker then falls back to the role's icon (`careerIcon`).
 */
const LOGOS: readonly (readonly [RegExp, string])[] = [
  [/\bmacrodata\b/i, "macrodata"],
  [/\bkanop\b/i, "kanop"],
  [/\btauniqo\b/i, "tauniqo"],
  [/\bescape\b/i, "escape"],
  [/\benseeiht\b/i, "enseeiht"],
  [/\bd[ée]odat\b/i, "deodat"],
  [/\balpen-adria|\bklagenfurt\b/i, "aau"],
];

export function careerLogo(name: string): string | null {
  const hit = LOGOS.find(([re]) => re.test(name));
  return hit ? `/career-logos/${hit[1]}.webp` : null;
}

/** Whether a role is the one in progress (`end: present`). */
export const isCurrent = (r: Pick<PublishedCareerRole, "end">): boolean => r.end === "present";

/** A language as the line reads it: the label and the level, not the same word twice (`Native, C2`; `A2`). */
export function languageDetail(l: PublishedCareerLanguage): string {
  const parts = [l.label, l.level].filter((p): p is string => !!p);
  return parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i).join(", ");
}

/** The portrait the page may draw: its `src` is checked again on the way out (defence in depth, as an entry's images are). */
export function safePortrait(career: PublishedCareer): NonNullable<PublishedCareer["portrait"]> | null {
  const p = career.portrait;
  if (!p || !safeMediaSrc(p.src)) return null;
  // a dark variant with a bad path is dropped, not the portrait
  if (p.dark && !safeMediaSrc(p.dark.src)) {
    const { dark: _dark, ...rest } = p;
    return rest;
  }
  return p;
}

/**
 * The logo of an organisation or a school: the one the published document carries (`logo`, a `/media/` file, checked again), else a
 * file of the site's own found from the name (below). Null = none: the marker then falls back to the role's icon.
 */
export function careerLogoSrc(item: { logo?: { src: string } | undefined }, name: string): string | null {
  if (item.logo && safeMediaSrc(item.logo.src)) return item.logo.src;
  return careerLogo(name);
}

/** The links the footer may draw: https only, no credentials (the schema says so; checked again). */
export function safeLinks(career: PublishedCareer): { label: string; url: string }[] {
  return career.links.flatMap((l) => {
    const url = safeExternalUrl(l.url);
    return url ? [{ label: l.label, url }] : [];
  });
}

/**
 * Structured data: a `ProfilePage` about a `Person`, minimal on purpose. The name is the site's (the owner's), the job title the
 * site's own role line, `sameAs` the document's public profile links. NOT included: employers (a role line the owner may still be
 * wording), the portrait, any contact detail (none exists in the contract), places, dates other than the authored review month.
 */
export function careerJsonLd(career: PublishedCareer, origin: string): Record<string, unknown> {
  const url = absoluteUrl(CAREER_PATH, origin);
  const sameAs = safeLinks(career).map((l) => l.url);
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url,
    dateModified: career.updated,
    isPartOf: { "@type": "WebSite", name: SITE.name, url: `${origin}/` },
    mainEntity: {
      "@type": "Person",
      name: SITE.name,
      jobTitle: SITE.role,
      url: `${origin}/`,
      ...(sameAs.length ? { sameAs } : {}),
    },
  };
}

/**
 * How long a role lasted, to the month, as `1y 2m`, `7m` or `3y` (inclusive of both months, as a CV counts them). Null when it cannot
 * be told: a bare year, no end, or a malformed month. An ongoing role runs to `asOf`, the month the owner last reviewed the
 * document (`career.updated`, authored): the page never reads the clock, so a cached page never goes stale.
 */
export function careerDuration(start: string, end: string | undefined, asOf: string): string | null {
  const month = (s: string): number | null => {
    const m = /^(\d{4})-(\d{2})$/.exec(s);
    return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
  };
  const from = month(start);
  const to = end === "present" ? month(asOf) : end === undefined ? null : month(end);
  if (from === null || to === null || to < from) return null;
  const total = to - from + 1;
  const years = Math.floor(total / 12);
  const months = total % 12;
  return [years > 0 ? `${years}y` : "", months > 0 ? `${months}m` : ""].filter(Boolean).join(" ");
}
