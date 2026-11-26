/**
 * The site as plain text for language models and agents (#750): `/llms.txt` (what the site is, and where everything is) and a Markdown
 * twin of every page (`/locations/lisbon.md`, `/articles/slug.md`, `/articles.md`, `/career.md`). Pure: the resource routes read the
 * projection and the origin, these only format.
 *
 * Nothing is added to what the HTML pages already say: the same fields, the same copyright notice. Two things are left out on purpose:
 * coordinates (a model reading a place does not need a point, and a file of every point is what a scraper wants), and the images of an
 * entry marked `sensitive` (the page blurs them until the visitor asks; alt text would describe them to everyone).
 */
import type { PublishedBodyBlock, PublishedCareer, PublishedProjection } from "@catalyst/schemas";
import { CAREER_PATH } from "./career";
import { copyrightNotice } from "./copyright";
import { formatEntryDate } from "./dates";
import { markdownPath } from "./markdown-path";
import { CONTENT_KINDS, COLLECTIONS, KIND_LABELS, KIND_PATHS, KIND_PLURALS, placePath, type EntryDetail, type EntrySummary } from "./entries";
import type { PlaceDetailData } from "./projection";
import { SITE, SITE_DESCRIPTION } from "./site";

export { markdownPath };

const abs = (origin: string, path: string) => `${origin}${path}`;
const mdUrl = (origin: string, path: string) => abs(origin, markdownPath(path));

/** Link text: the brackets that would end it are escaped, nothing else (the text is plain, authored for a person). */
const text = (s: string) => s.replace(/[[\]]/g, "\\$&");
const link = (label: string, url: string) => `[${text(label)}](${url})`;

/** A fence longer than any run of backticks in the code, so the code cannot close it. */
function fence(code: string): string {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(longest + 1);
}

/** One body block as Markdown. An entry's own title is the level 1, so its headings (2 and 3) map one to one. */
function blockMarkdown(block: PublishedBodyBlock, origin: string, withImages: boolean): string | null {
  switch (block.type) {
    case "paragraph":
      return block.text;
    case "heading":
      return `${"#".repeat(block.level)} ${block.text}`;
    case "list":
      return block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : "-"} ${item.replace(/\n/g, " ")}`).join("\n");
    case "quote":
      return [...block.text.split("\n").map((l) => `> ${l}`), ...(block.cite ? [`> — ${block.cite}`] : [])].join("\n");
    case "image":
      return withImages ? `![${text(block.alt)}](${abs(origin, block.src)})${block.caption ? `\n*${block.caption}*` : ""}` : null;
    case "verse":
      // two trailing spaces end a line in Markdown; a blank line ends a stanza
      return block.stanzas.map((stanza) => stanza.map((line) => `${line}  `).join("\n").trimEnd()).join("\n\n");
    case "code": {
      const f = fence(block.code);
      return `${f}${block.language ?? ""}\n${block.code}\n${f}`;
    }
    case "link":
      return `- ${link(block.title, block.url)}${block.description ? `: ${block.description}` : ""}`;
    case "divider":
      return "---";
  }
}

function body(blocks: readonly PublishedBodyBlock[], origin: string, withImages: boolean): string[] {
  const out: string[] = [];
  let previous: PublishedBodyBlock["type"] | undefined;
  for (const block of blocks) {
    const md = blockMarkdown(block, origin, withImages);
    if (md === null) continue;
    // consecutive link blocks read as one list, not as paragraphs of one bullet each
    if (block.type === "link" && previous === "link") out[out.length - 1] += `\n${md}`;
    else out.push(md);
    previous = block.type;
  }
  return out;
}

/** The lines that follow a page's title: the one-line summary, then a list of facts. */
function head(title: string, summary: string | undefined, facts: ReadonlyArray<[string, string | undefined]>): string[] {
  const rows = facts.filter((f): f is [string, string] => Boolean(f[1])).map(([k, v]) => `- ${k}: ${v}`);
  return [`# ${title}`, ...(summary ? [`> ${summary}`] : []), ...(rows.length ? [rows.join("\n")] : [])];
}

/** The last line of every twin: the way back to the description of the whole site, so an agent that landed on one page finds the rest. */
const siteIndex = (origin: string) => `Site index: ${abs(origin, "/llms.txt")}`;

const join = (parts: readonly string[]) => `${parts.join("\n\n")}\n`;

const entryLine = (e: Pick<EntrySummary, "title" | "href" | "summary" | "date">, origin: string) => {
  const date = formatEntryDate(e.date)?.text;
  return `- ${link(e.title, mdUrl(origin, e.href))}${date ? ` (${date})` : ""}${e.summary ? `: ${e.summary}` : ""}`;
};

// --- Pages ----------------------------------------------------------------------------------------------------------------------

/** An entry (article, software, artwork, poem, photograph). Its images are left out when it is `sensitive`. */
export function entryMarkdown(entry: EntryDetail, origin: string): string {
  const notice = copyrightNotice(entry);
  const date = formatEntryDate(entry.date)?.text;
  const places = entry.places.map((p) => link(p.region ? `${p.name}, ${p.region}` : p.name, mdUrl(origin, p.href)));
  return join([
    ...head(entry.title, entry.summary, [
      ["Kind", KIND_LABELS[entry.kind]],
      ["Date", date],
      ["Tags", entry.tags.join(", ")],
      ["Places", places.join("; ")],
      ["Country", entry.places.length ? undefined : entry.country?.name],
      ...entry.meta.map((m): [string, string] => [m.label, m.value]),
      ["Link", entry.url],
      ["Page", abs(origin, entry.href)],
    ]),
    // a photograph or an artwork is its picture: the cover, unless the body already shows it
    ...(entry.cover && !entry.sensitive && !entry.body.some((b) => b.type === "image" && b.src === entry.cover!.src)
      ? [`![${text(entry.cover.alt)}](${abs(origin, entry.cover.src)})`]
      : []),
    ...body(entry.body, origin, !entry.sensitive),
    ...(entry.sensitive ? ["*The images of this entry are not described here: the page shows them blurred until a visitor asks.*"] : []),
    ...(entry.related.length ? ["## Related", entry.related.map((r) => entryLine(r, origin)).join("\n")] : []),
    ...(entry.prev || entry.next
      ? [[entry.prev && `Previous: ${entryLine(entry.prev, origin).slice(2)}`, entry.next && `Next: ${entryLine(entry.next, origin).slice(2)}`].filter(Boolean).join("  \n")]
      : []),
    ...(notice ? ["---", notice.text] : []),
    siteIndex(origin),
  ]);
}

/** A place: what the owner wrote about it, its trips, and the entries that belong to it. No coordinates. */
export function placeMarkdown(place: PlaceDetailData, origin: string): string {
  return join([
    ...head(place.name, place.summary, [
      ["Region", place.region === place.country ? undefined : place.region],
      ["Country", place.country],
      ["Dates", place.dates?.text],
      ["Page", abs(origin, placePath(place.slug))],
    ]),
    ...place.body,
    ...(place.images.length ? [place.images.map((i) => `![${text(i.alt)}](${abs(origin, i.src)})`).join("\n\n")] : []),
    ...(place.trips.length
      ? [
          "## Trips",
          place.trips.map((t) => `- ${t.title}${t.dates ? ` (${t.dates.text})` : ""}: ${t.from} to ${t.to}, ${t.stops} stops${t.summary ? `. ${t.summary}` : ""}`).join("\n"),
        ]
      : []),
    ...place.entries.flatMap((g) => [`## ${KIND_PLURALS[g.kind]}`, g.entries.map((e) => entryLine(e, origin)).join("\n")]),
    siteIndex(origin),
  ]);
}

/** A section's list page: `/articles`, `/software`, ... */
export function listMarkdown(kind: (typeof CONTENT_KINDS)[number], entries: readonly EntrySummary[], origin: string): string {
  return join([`# ${KIND_PLURALS[kind]}`, ...(entries.length ? [entries.map((e) => entryLine(e, origin)).join("\n")] : ["Nothing here yet."]), `Page: ${abs(origin, KIND_PATHS[kind])}`, siteIndex(origin)]);
}

/** The career document. */
export function careerMarkdown(career: PublishedCareer, origin: string): string {
  const range = (start: string, end?: string) => `${start} to ${end ?? "now"}`;
  return join([
    ...head(career.title, career.summary, [
      ["Updated", career.updated],
      ["Availability", career.availability?.text],
      ["Page", abs(origin, CAREER_PATH)],
    ]),
    "## Experience",
    ...career.roles.map((r) =>
      [
        `### ${r.title}, ${r.org}`,
        `${range(r.start, r.end)} · ${r.location}${r.employment ? ` · ${r.employment}` : ""}`,
        ...(r.highlights.length ? [r.highlights.map((h) => `- ${h}`).join("\n")] : []),
        ...(r.projects?.length ? [r.projects.map((p) => `- ${p.title}: ${p.summary}`).join("\n")] : []),
        ...(r.skills.length ? [`Skills: ${r.skills.join(", ")}`] : []),
      ].join("\n\n"),
    ),
    ...(career.education.length
      ? ["## Education", career.education.map((e) => `- ${e.programme}${e.level ? ` (${e.level})` : ""}, ${e.institution}${e.location ? `, ${e.location}` : ""}, ${range(e.start, e.end)}${e.note ? `. ${e.note}` : ""}`).join("\n")]
      : []),
    ...(career.skills.length ? ["## Skills", career.skills.map((g) => `- ${g.group}: ${g.items.join(", ")}`).join("\n")] : []),
    ...(career.languages.length ? ["## Languages", career.languages.map((l) => `- ${l.name}: ${l.label ?? l.level}`).join("\n")] : []),
    ...(career.links.length ? ["## Links", career.links.map((l) => `- ${link(l.label, l.url)}`).join("\n")] : []),
    siteIndex(origin),
  ]);
}

/**
 * `/llms.txt` (https://llmstxt.org): the site in a few lines, then the lists and every place and entry as a link to its Markdown twin, with the
 * one-line summary. The shape is the convention's: an H1, a blockquote, then H2 sections of links; "Optional" holds what can be skipped first.
 */
export function llmsTxt(projection: PublishedProjection, origin: string): string {
  const sections = CONTENT_KINDS.map((kind) => ({ kind, items: projection[COLLECTIONS[kind]] })).filter((s) => s.items.length > 0);
  return join([
    `# ${SITE.name}`,
    `> ${SITE_DESCRIPTION} A personal site: a globe of the places the owner has been to, with the writing, software, artwork, poetry and photography that belong to them.`,
    [
      "Every page has a plain Markdown twin: add `.md` to its address (`/articles.md` is the list of articles, `/career.md` the career page), or follow the links below.",
      "The writing, artwork and photographs are all rights reserved: quoting briefly with attribution is welcome, reproducing them is not.",
      `The site asks crawlers that collect pages to train a model to stay away (${abs(origin, "/robots.txt")}); search and assistants answering a person's question are welcome.`,
    ].join("\n"),
    ...(projection.career ? ["## About", `- ${link(projection.career.title, mdUrl(origin, CAREER_PATH))}: ${projection.career.summary}`] : []),
    ...sections.flatMap(({ kind, items }) => [
      `## ${KIND_PLURALS[kind]}`,
      [
        `- ${link(`All ${KIND_PLURALS[kind].toLowerCase()}`, mdUrl(origin, KIND_PATHS[kind]))}`,
        ...items.map((item) => {
          const date = formatEntryDate(item.date)?.text;
          return `- ${link(item.title, mdUrl(origin, `${KIND_PATHS[kind]}/${item.slug}`))}${date ? ` (${date})` : ""}${item.summary ? `: ${item.summary}` : ""}`;
        }),
      ].join("\n"),
    ]),
    ...(projection.places.length
      ? [
          "## Optional",
          "Places: one page each, with the trips that stopped there and the entries written about it.",
          projection.places.map((p) => `- ${link(p.region ? `${p.name}, ${p.region}` : p.name, mdUrl(origin, placePath(p.slug)))}${p.summary ? `: ${p.summary}` : ""}`).join("\n"),
        ]
      : []),
  ]);
}
