import { SECTIONS } from "./sections";

/**
 * The site's identity: what the head tags, the sitemap, the robots file and the share cards say about it. Pure (no environment access):
 * `site.server.ts` reads `CATALYST_SITE_URL` and calls these. Documented in docs/web-architecture.md, "Production readiness".
 *
 * ONE constant (`SITE`) holds what the site calls itself, and everything visible reads it: the home hero's name, the head tags, the
 * manifest, the error pages, the share image's alt text. Facts only: nothing here is a claim the owner did not make. The code name of
 * the project ("Catalyst") lives in the repository, the packages and the environment variables, and never in the site's own text
 * (`lib/identity.test.ts` renders the main routes and the built manifest and fails if it shows up).
 */
export const SITE = {
  /** The owner's name: the site's name, the home hero's headline, the title template's suffix. */
  name: "Elliot Négrel-Jerzy",
  /** The name's two halves: the hero sets the first at the heavy end of the weight axis (800) and the second at the thin end (200). */
  givenName: "Elliot",
  familyName: "Négrel-Jerzy",
  /** For tight spots (the home-screen label under an icon, 12 characters or fewer). */
  shortName: "Elliot N.-J.",
  /** Who: what the owner does, and where. The hero says "<role> based in <location>." */
  role: "Front-end and UX software engineer",
  location: "Warsaw",
  /** What: the fields, in the owner's order. A sentence of its own. */
  speciality: "Data visualisation, geospatial and cartography interfaces, design systems, computer graphics",
} as const;

/** Who the owner is, as a sentence: the first half of the line under the name on the home page (all that stays of it in a very short window). */
export const SITE_IDENTITY = `${SITE.role} based in ${SITE.location}.`;
/** What the owner works on, as a sentence: the second half. */
export const SITE_FOCUS = `${SITE.speciality}.`;
/** The sentence under the name on the home page: the same facts as the description, in the owner's words. */
export const SITE_TAGLINE = `${SITE_IDENTITY} ${SITE_FOCUS}`;

export const SITE_NAME = SITE.name;
export const SITE_DESCRIPTION = `${SITE.role} in ${SITE.location}. ${SITE.speciality}.`;
/** Where an entry or a list has no summary of its own: "Poetry from the archive of <name>." */
export const archiveLine = (what: string) => `${what} from the archive of ${SITE.name}.`;
/** The home page's title: the template (`<Page> · <name>`) has no page to put first, so it says who the site belongs to and what they do. */
export const SITE_TITLE = `${SITE_NAME} · ${SITE.role}`;
/** The temporary main domain of the new site; `CATALYST_SITE_URL` overrides it (the owner's move to the final domain is that one variable). */
export const DEFAULT_SITE_URL = "https://v2.bsodium.fr";

/**
 * The first version of the site, kept as it was (#312): the ONE place its address and its words are written. The moon that circles the globe
 * (`GlobeProps.moon`, docs/landing.md "The moon") and the search palette's entry read it. A way back to look at, not a warning: the words say what
 * it is and that it stays as it was. The address is the old app's own Vercel project (docs/owner-guide.md); if the archive moves, this is the one line to change.
 */
export const ARCHIVED_V1 = {
  url: "https://v1.bsodium.fr",
  title: "Memory lane",
  description: "The first version of this site, kept just as it was.",
  /** The card's last line (an arrow is drawn after it by the stylesheet) and the palette's. */
  cta: "Take a trip back",
  /** The palette's entry, found by these words (every typed word must begin one of them). */
  sub: "The first version of this site, kept as it was",
  words: ["memory", "lane", "moon", "version", "1", "v1", "first", "old", "older", "previous", "archived", "archive", "site", "back"],
} as const;

/** A stretch of a caption line (`GlobeProps.captionPhrases`): the words and the style they are set in (`plain` when absent). */
export interface CaptionSpan {
  text: string;
  style?: "plain" | "heavy" | "heavy-italic" | "mono" | "script";
  /** In the blue text tone (the caption's one palette, sparingly: at most two words on screen); weight or face carries it too. */
  accent?: "blue";
}

/** How each section's name is set in the caption: the code section in the mono face, the poems in a handwriting, the others in the heavy serif. */
const SECTION_CAPTION_STYLE = {
  project: "mono",
  article: "heavy",
  artwork: "heavy",
  poem: "script",
  photograph: "heavy",
} as const satisfies Record<keyof typeof SECTIONS, NonNullable<CaptionSpan["style"]>>;


/** The words a caption row can be set in: heavy for the ones to highlight, the section kinds' own faces (see `SECTION_CAPTION_STYLE`). */
type CaptionRow = readonly CaptionSpan[];

/** What the caption says (`GlobeProps.captionPhrases`): sets that take turns in the upper rows, and the rows that stay under them. */
export interface SiteCaption {
  sets: readonly (readonly CaptionRow[])[];
  fixed: readonly CaptionRow[];
}

/** How many of each kind the archive holds (published entries), when the page knows. */
export type KindCounts = Record<keyof typeof SECTIONS, number>;

const KINDS = Object.keys(SECTIONS) as (keyof typeof SECTIONS)[];

/**
 * The caption of the home screen, set on parallels of the globe (reading serif, a few weights, the code face and a calligraphic script): four
 * rows in view at once, never more: a fifth row made the block too heavy (owner, 2026-10-26). The call to action is two rows that stay at the bottom, the biggest;
 * the two rows above take turns, every few seconds, through the phrase sets: (1) what the site is, (2) what it holds, the five sections in the order of the lists
 * as one sentence in two rows (each word in its section's face, the handwriting's "Poems" on the top row (no descender to meet the row under it); "articles" and "art" for Articles and Artworks, which is what a row of that width can hold: the
 * sections' own names are in the hero's rows and the header, as text) and (3) how much of it there is, from the published projection (left out when the
 * page does not know the counts). Facts about the site and interface copy, nothing about the owner; the hero's how-to line says the same in the
 * page as text, always (the caption is for the eyes: it is hidden from assistive technology).
 */
export function siteCaption(counts?: KindCounts | null): SiteCaption {
  const word = (kind: keyof typeof SECTIONS, text: string): CaptionSpan => ({ text, style: SECTION_CAPTION_STYLE[kind] });
  const sets: CaptionRow[][] = [
    [
      [{ text: "A " }, { text: "personal archive", style: "heavy", accent: "blue" }, { text: "," }],
      [{ text: "organised around " }, { text: "places", style: "heavy", accent: "blue" }, { text: "." }],
    ],
    // (five sections in two rows no wider than the counts' row of the four-section caption (24 letters); the handwriting, bigger than the serif, ends the TOP row: it has
    // nothing above it there, so it can rise without touching a row, and it has no comma after it (its comma is ugly): the comma before it is the serif's)
    [
      [word("project", "software"), { text: ", " }, word("artwork", "art"), { text: ", " }, word("poem", "Poems")],
      [word("article", "articles"), { text: " & " }, word("photograph", "photography"), { text: "." }],
    ],
  ];
  const total = counts ? KINDS.reduce((n, k) => n + counts[k], 0) : 0;
  if (counts && KINDS.every((k) => Number.isFinite(counts[k]) && counts[k] >= 0) && total > 0) {
    const kinds = KINDS.filter((k) => counts[k] > 0).length;
    sets.push([
      [{ text: String(total), style: "heavy", accent: "blue" }, { text: total === 1 ? " entry" : " entries" }, { text: "," }],
      [{ text: `in ${kinds} ` }, { text: kinds === 1 ? "section" : "sections", style: "heavy" }, { text: "." }],
    ]);
  }
  return {
    sets,
    fixed: [
      [{ text: "Drag to " }, { text: "explore", style: "heavy" }, { text: "." }],
      [{ text: "Pick a " }, { text: "place", style: "heavy" }, { text: "." }],
    ],
  };
}

/** The caption without counts. */
export const SITE_CALL: SiteCaption = siteCaption();

/** A caption as plain text: one string per row, per set, and for the fixed rows (tests, and anything that wants the words without the styles). */
export const captionText = (c: SiteCaption): { sets: string[][]; fixed: string[] } => ({
  sets: c.sets.map((set) => set.map((row) => row.map((s) => s.text).join(""))),
  fixed: c.fixed.map((row) => row.map((s) => s.text).join("")),
});

/** The role inside a sentence, as the share image's alt text says it: lower-cased where it starts a clause, but "UX" stays "UX" (never `role.toLowerCase()`). */
export const ROLE_IN_SENTENCE = "front-end and UX software engineer";

/** The share image of every page that has no entry cover of its own (`public/og-default.png`, drawn by `scripts/brand/build.mjs`). */
export const DEFAULT_SHARE_IMAGE = {
  path: "/og-default.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: `${SITE.name}, ${ROLE_IN_SENTENCE} in ${SITE.location}: a wireframe globe with two places joined by a route.`,
} as const;

/** The page colours of the two schemes (`--background` in app.css; a test keeps them equal): the browser UI's `theme-color`. */
export const THEME_COLORS = { light: "#fbfbfb", dark: "#0a0a0a" } as const;

/**
 * The origin of the site from a raw `CATALYST_SITE_URL`: trimmed, an empty value counts as unset, only `https:` (or `http:` for
 * localhost, to test a production build) is accepted, and whatever follows the origin (path, query, credentials) is dropped. A bad
 * value reports once through `warn` and the default is used: a typo must never break the pages.
 */
export function resolveSiteUrl(raw: string | undefined, warn: (message: string) => void = () => {}): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_SITE_URL;
  try {
    const u = new URL(value);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    if (u.protocol === "https:" || (u.protocol === "http:" && local)) return u.origin;
    warn(`[site] CATALYST_SITE_URL ignored (only https is accepted); using ${DEFAULT_SITE_URL}`);
  } catch {
    warn(`[site] CATALYST_SITE_URL ignored (not an absolute URL); using ${DEFAULT_SITE_URL}`);
  }
  return DEFAULT_SITE_URL;
}

/**
 * Whether search engines may index what this server answers. Only the production site itself: the request must come in on the host of
 * `siteUrl` (so the `*.vercel.app` address of the same deployment, a preview URL or localhost are all kept out) and Vercel must not say
 * the deployment is a preview or a development one.
 */
export function isIndexableHost({ siteUrl, host, vercelEnv }: { siteUrl: string; host: string | null | undefined; vercelEnv?: string | undefined }): boolean {
  if (vercelEnv === "preview" || vercelEnv === "development") return false;
  if (!host) return false;
  try {
    return host.trim().toLowerCase() === new URL(siteUrl).host.toLowerCase();
  } catch {
    return false;
  }
}

/** The host a request was addressed to: the proxy's `x-forwarded-host` (first value) when present, else `host`. */
export function requestHost(headers: Pick<Headers, "get">): string | null {
  return headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host");
}
