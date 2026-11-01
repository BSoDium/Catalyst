/**
 * The copyright notice of the owner's writing and artwork: the line at the end of a poem, an article or an artwork, and the same words in
 * the page's `<meta name="copyright">` and JSON-LD. ONE place builds it (`copyrightNotice`), so the visible line and the machine-readable
 * ones can never disagree. The holder is the site's name (`SITE.name`), never typed here. Software entries are code, under the
 * repository's licence (LICENSE): they have no notice (`null`).
 */
import type { ContentKind, PublishedMetaEntry } from "@catalyst/schemas";
import { entryLanguage } from "./entries";
import { SITE } from "./site";

/** The language of a notice: the entry's own when it is French, English otherwise (the interface's language). */
export type NoticeLanguage = "en" | "fr";

const NOUNS: Partial<Record<ContentKind, Record<NoticeLanguage, string>>> = {
  poem: { en: "poem", fr: "ce poème" },
  photograph: { en: "photograph", fr: "cette photographie" },
  article: { en: "article", fr: "ce texte" },
  // feminine: "cette œuvre" (the brief's "ce œuvre" would be wrong French)
  artwork: { en: "artwork", fr: "cette œuvre" },
};

/** What is welcome of a work, said by what it is: a text can be quoted; a picture cannot (a short quotation of a photograph means nothing), it can be linked or shown small with a credit. */
const WELCOME: Partial<Record<ContentKind, Record<NoticeLanguage, string>>> = {
  photograph: { en: "a link or a small preview with credit is welcome", fr: "un lien ou un aperçu réduit avec mention de l'auteur est bienvenu" },
  artwork: { en: "a link or a small preview with credit is welcome", fr: "un lien ou un aperçu réduit avec mention de l'auteur est bienvenu" },
};

export interface CopyrightNotice {
  /** The whole line: `© 2026 Elliot Négrel-Jerzy. All rights reserved. Please do not ...` */
  text: string;
  /** The year, when the projection says one. */
  year?: number;
  holder: string;
  /** `fr` when the entry is in French (set on the element as `lang`), else `en`. */
  language: NoticeLanguage;
}

/** The year of a partial ISO date (`2026`, `2026-03`, `2026-03-14`), or undefined. */
export function yearOf(value: string | undefined): number | undefined {
  const m = value ? /^(\d{4})(?:-|$)/.exec(value.trim()) : null;
  return m ? Number(m[1]) : undefined;
}

export interface CopyrightInput {
  kind: ContentKind;
  /** The entry's authored date. Wins. */
  date?: string | undefined;
  /** An updated / published stamp (a partial ISO date), used only when the entry has no date. The projection carries none today. */
  updated?: string | undefined;
  /** The entry's facts (`Language: French`): decides the language of the notice. */
  meta?: readonly PublishedMetaEntry[] | undefined;
}

/** The notice of an entry, or `null` for a kind that has none (software). The year is the date's, else the stamp's, else absent. */
export function copyrightNotice({ kind, date, updated, meta = [] }: CopyrightInput): CopyrightNotice | null {
  const nouns = NOUNS[kind];
  if (!nouns) return null;
  const language: NoticeLanguage = entryLanguage(meta)?.split("-")[0] === "fr" ? "fr" : "en";
  const year = yearOf(date) ?? yearOf(updated);
  const head = `© ${year !== undefined ? `${year} ` : ""}${SITE.name}.`;
  const rest =
    language === "fr"
      ? `Tous droits réservés. Merci de ne pas reproduire ${nouns.fr} sans autorisation ; ${WELCOME[kind]?.fr ?? "de courtes citations avec mention de l'auteur sont bienvenues"}.`
      : `All rights reserved. Please do not reproduce this ${nouns.en} without permission; ${WELCOME[kind]?.en ?? "short quotations with attribution are welcome"}.`;
  // Without a year the line is only the holder: "© Elliot Négrel-Jerzy." then the terms, as the owner asked.
  return { text: `${head} ${rest}`, ...(year !== undefined ? { year } : {}), holder: SITE.name, language };
}
