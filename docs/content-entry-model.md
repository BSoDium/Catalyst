# Entry content model: from the vault to the contract

Design note for the private content repo's next export step. It maps a vault document (`content/<kind>/<slug>/index.md`: a typed YAML header plus a Markdown body) onto the **entry** shape of the public contract (`packages/schemas/src/published.ts`, documented in [api-contract.md](api-contract.md), "Entries"). It implements decision D3 of the private `content-model-v2.md` (Markdown reaches the public repo as typed, schema-validated blocks, never as HTML) with the names and limits this repo actually accepts. Where the two differ, **this repo's contract wins**; the private profile is to be narrowed, not the contract widened. Written 2026-10-08.

Kinds: `article`, `project` (a development project; the site calls its section **Software**, `/software`, and the kind, the vault `type`, the projection collection `projects` and the API's `/v1/projects` stay `project` / `projects`), `artwork`, `poem`, `photograph` (the site calls its section **Photography**, `/photography`; see section 4b). `poem` is new on both sides: the private envelope's `type` enum and the editorial content kinds (`EditorialContent`, `kindSets`, `DroppedRecord.kind`, importance links, `contentOf`) need it, and the mapper needs a `poems` collection (published poems only, sorted by slug, like the other three).

Conformance sample: `packages/published/fixtures/demo.json` (made-up demo data) has 22 realistic entries (5 articles, 4 projects, 5 artworks, 4 poems, 4 photographs; one artwork is `sensitive`) with covers, tags, kind-specific meta and bodies that use **every** block type. A private test can export a vault that reproduces it and compare, and it validates against `packages/schemas/published.schema.json` with ajv in strict mode (checked).

## 1. Header to fields

The mapper builds a new object field by field, in this key order: `slug, title, summary, date, url, cover, sensitive, tags, meta, body, placeSlugs, countryCode`. Optional fields are **omitted** when empty (no `[]`, no `null`).

| Vault header | Contract field | Rule |
| --- | --- | --- |
| folder name | `slug` | Unique per kind. |
| `title` | `title` | 1 to 160, trimmed. |
| `summary` | `summary` | 1 to 500. Never derived from the body. |
| `date` | `date` | `YYYY`, `YYYY-MM`, `YYYY-MM-DD`. |
| `url` | `url` | https only, max 2000, no credentials or whitespace (the JSON Schema cannot check credentials, see section 5). Project: live demo; poem or article: original publication. |
| `tags` | `tags` | Same slug rule as the vault; the contract accepts max **12** unique tags of max 40 characters. |
| `facts: [{label, value}]` | `meta` | Rename. One line of plain text each, label max 40, value max 200, max **10** entries, labels unique (case-insensitive). The vault's cap of 6 is stricter and fine. |
| `links: [{label, url}]` | `link` blocks | Appended last (after the body and the gallery images), in order, as `{type:"link", title: label, url}`. The contract has no `links` field. |
| `images` (`ImageDecl`) | `cover`, `image` blocks | See section 3. |
| `sensitive: true` | `sensitive` | Mature content (a figure or anatomy study, for instance). **Optional boolean, omitted when false** (never write `sensitive: false`); only `true` is meaningful. Valid only on an entry that exports an image (a `cover` or an `image` block): **warn** (`sensitive-without-image`, not fatal) when it is set on an entry that has none. Any other value than a YAML boolean is an error (`sensitive-not-boolean`), not coerced: `"true"`, `yes`, `1` are all refused. The private profile adds the key to the typed header of the four kinds (artworks use it today). See section 3, "Mature content". |
| `places: [place/x]` | `placeSlugs` | Keep only places that are published (as `mapContent` does today). |
| `status` | (filter) | Only `published` entries are exported. |
| `id`, `publishedAt`, `notes`, `rights`, `credit`, `readme.*`, `related`, `refKind`, `authors`, `year` | not exported | Private. A project's README snapshot is never exported; only an adopted `README.md` that passes the Markdown profile may become the body. |
| `lang` (`en`, `fr`) | poem `meta` `Language` | Reserved today. For a **poem** with no `Language` fact, emit `{label:"Language", value:"English"}` or `"Français"` (the language's own name). Optional for other kinds. |

Entry-to-entry `related` has no public field yet; it stays private (the place side already lists `related`).

`meta` conventions the web app will display (the schema does not enforce them): project `Stack`, `Status`, `Repository`; artwork `Medium`, `Year`, `Dimensions`; article `Publication`; poem `Language`; photograph `Format` and `Licence`. A `meta` value is plain text, never a link: put a repository or demo address in `url`, or in `links`.

**Photograph exposure (#385).** A photograph may carry six `meta` facts with fixed labels: `Camera`, `Lens`, `Focal length`, `Aperture`, `Shutter`, `ISO` (camera and lens are the core, the four others optional per photograph; a missing one is left out, never a dash). The export writes them as text (`35 mm`, `f/2.8`, `1/250 s`, `200`; the web app also accepts a bare number and says it with its unit), from the vault header's `facts` (read from the original's EXIF when the photograph is promoted, or written by hand: `pnpm photo:exif`, see the content repo's media policy). The entry page and the panel say them as an exposure line under the title (`lib/exposure.ts`, `splitExposure`): the camera and the lens on one line, the settings on the next (`35 mm · f/2.8 · 1/250 s · ISO 200`), and the facts block no longer repeats them; the wall and the lists show none. The page's JSON-LD `Photograph` has them as `exifData` (`PropertyValue` pairs: name the label, value the text). GPS, serial numbers, the owner's name and thumbnails are never in `meta`.

## 2. Markdown body to `body` blocks

Parse with `mdast-util-from-markdown` plus GFM (as decided), walk the root's children, and emit one block per node. Anything not listed is an **error** with file, line and a fix hint (`md-forbidden-<node>`), never cleaned up. All text goes through the same filter: LF line endings only (CR is rejected), no control characters other than LF (and tab inside code), no U+202A to U+202E or U+2066 to U+2069, trimmed except in `verse` and `code`. NFC-normalise before measuring lengths.

| Markdown | Block | Notes and rejections |
| --- | --- | --- |
| Paragraph | `paragraph {text}` | Max 5000 characters (longer: error; split the paragraph). Soft line break inside the text becomes a space; a hard break (two spaces or backslash) becomes `\n`. Inline marks: see below. |
| Paragraph that contains only one link | `link {title, url, description?}` | Link text is the title, a Markdown link title attribute (`[t](u "d")`) the description. The URL must be https. A `mailto:` or `http:` URL is an error. |
| `##` | `heading {level:2, text}` | Max 160, one line, inline marks flattened. |
| `###` | `heading {level:3, text}` | |
| `####` | **error** | The contract has levels 2 and 3 only; narrow the private profile (it says `##` to `####`) or lift the heading. `#` and setext headings stay forbidden. Heading ids are not exported: the renderer derives anchors from the text. |
| Bullet or ordered list | `list {ordered, items}` | 1 to 50 items, each max 1000, inline marks flattened. Items must be one paragraph. **Nested lists, task lists and multi-paragraph items are errors** (the private profile allows two levels; the contract does not). |
| Blockquote | `quote {text, cite?}` | Paragraphs joined by a blank line (`\n\n`). A last line that starts with an em dash, `--` or `-` followed by a space becomes `cite` (max 200, one line). A quote that contains a list, code or an image is an error. |
| Callout `> [!note]` | **error** | No callout block yet. Either write a plain quote or wait for the block (section 6). |
| Fenced code | `code {language?, code}` | Info string must match `^[a-z0-9+#-]{1,20}$` after lowercasing, else error; no info string means no `language`. Max 10000 characters, tabs allowed, final newline removed, not trimmed. |
| Block-level image | `image {src, alt, width?, height?, caption?}` | The file must be declared in `images:` with `placement: inline`, `publish: true`, non-empty alt (max 300). `src` is the content-hashed `/media/<kind>/<slug>/<stem>.<sha8>.<ext>` path; width and height are read from the file (always emit both). `caption` from the declaration, else the Markdown title attribute; max 300, one line. A credit, when required, is appended to the caption (`Caption. Photo: X.`). External images, `![[embeds]]` and inline images inside a paragraph are errors. |
| Thematic break | `divider` | |
| Table | **error** | No table block yet (section 6). |
| Raw HTML, comments, footnotes, math, frontmatter in the body, bare-URL autolinks | **error** | As in the private profile. |

**Inline content** has no public representation yet. The first export **flattens** it to plain text and reports a warning per occurrence (`md-inline-flattened`, counted in the PR summary; `check --strict` can make it fatal):

- `*em*`, `**strong**`, `` `code` `` become their text;
- a link inside a sentence becomes its link text. An internal link (relative path or wikilink) is also just its text, and its target is not exported (no entry-to-entry reference exists in the contract). If the destination matters, put the link in its own paragraph (`link` block) or in `links:`.

Document-level limits (the contract enforces them, so the private gate must too): at most **200 blocks** (the private profile says 400: lower it) and **60,000 characters** of block text in total (the sum of paragraph, heading, item, quote, cite, verse line, code, link title and description, image alt and caption lengths; media paths and URLs do not count). An empty Markdown body means no `body` key.

## 3. Images: cover and gallery

- `cover` = the single declared image with `placement: cover` (a new value next to `gallery` and `inline`; at most one; it must be `publish: true`). Export `{src, alt, width, height}` (no caption). Without one, the entry has no cover and lists fall back to text.
- Other `gallery` images have no field. Export them as `image` blocks **appended after the Markdown body and before the `link` blocks of `links:`**, in declaration order, so nothing is lost; a future `images` field could replace this.
- `inline` images appear where the Markdown puts them. A declared `publish: true` image that is neither cover, gallery nor referenced is a warning.
- Media policy is unchanged: raster only for real content (the demo uses SVG under `apps/web/public/media/demo/`, which the export never writes and never owns), resize, strip metadata, content-hashed names. A media path must be `/media/` followed by plain file names: slugify stems to `[A-Za-z0-9._-]`, no segment starting with a dot, no `..`, no empty segment, max 300 characters in total.
- Collect every `cover.src` and image block `src` into `mediaSrcs`, as the place images are, so the media export copies them and `check` verifies the files exist.

### Mature content (`sensitive`)

An entry the owner wants published but not shown by surprise sets `sensitive: true` in its vault header (an artwork that is a figure or
anatomy study, for example). The exporter's whole job is to carry the flag; the **web app does the rest**:

- **Mapper.** Header key `sensitive: true` becomes the contract field `sensitive: true` on the entry (not on `cover`, not on an `image`
  block: the flag covers every picture of the entry, its cover and its gallery or inline images alike). When the header has no such key, or
  `false`, the field is absent (the key order above applies). The flag is only meaningful with images: if the entry exports no `cover` and
  no `image` block, emit it anyway and **warn**, since it can only be a mistake (a forgotten image, or a flag on the wrong document).
- **Do not do the web app's work.** Do not blur, resize, or replace the images, do not publish a second "safe" cover, and do not drop the
  flag from the lists: the summaries (`/v1/<kind>`) carry `sensitive` too (they are what the cards are built from). The files are
  exported exactly like any other media (content-hashed, in `mediaSrcs`).
- **What the site does with it** (docs/design-system.md, "Sensitive media"): every picture of the entry is blurred from the server render
  (entry page, cards in lists, the place panel, related entries) until the visitor presses "Show image" on the entry (not remembered: a
  reload blurs again); the cover is never the share image, never a JSON-LD `image`, and the page asks not to have its images indexed. Alt
  text is shown to assistive technology as authored, so write it as the description of the work, not as a warning.
- **Conformance.** The demo fixture has exactly one: `artworks[slug="figure-study-two"]` (a made-up charcoal study, with an SVG cover and
  one `image` block). A private export test can assert that the flag round-trips, is omitted when false and warns without images.

## 4. Poems

On the site the section that lists poems is called **Poetry** (`/poetry`, entries at `/poetry/:slug`; `/poems` redirects). The kind, the vault `type`, the projection collection and the API (`/v1/poems`) stay `poem` / `poems`.

A poem document is Markdown too, but its text is verse:

- In a `type: poem` document, **consecutive paragraphs form one `verse` block**: each paragraph is a stanza, each line of the paragraph (the soft or hard line breaks) is a line of the stanza. Headings, quotes, images and the rest map as usual; a heading closes the current verse block and the next paragraphs start a new one.
- Markdown strips leading spaces, so indentation is lost with plain paragraphs. When indentation matters, use a fence with the info string `verse`: the content is taken verbatim, a blank line separates stanzas, lines are only right-trimmed. Leading spaces (not tabs) are kept. (In Obsidian the fence shows as a code block; plain paragraphs render as prose.)
- Limits: a line is 1 to 300 characters with a visible character; a stanza has 1 to 60 lines; a verse block 1 to 60 stanzas. A longer line is an error (do not wrap automatically: a wrapped line is a different poem).
- Prose around the poem (a note, a dedication) is ordinary `paragraph` blocks, for instance after a `divider`.

## 4b. Photographs

Additive in schema version 1, like `poem` before it: the kind is `photograph`, the projection collection `photographs` (defaults to `[]`, so a projection written before the kind existed stays valid), the API's `/v1/photographs`, the vault `type: photograph`. On the site the section is called **Photography** (`/photography`, entries at `/photography/:slug`; counts say "4 photographs"). The section's name, address and nouns are one row of `apps/web/app/lib/sections.ts`.

A photograph document is a photograph first, so its shape is smaller than an article's:

- **`cover` is the photograph** and is expected: `src` (a `/media/` path, see [media-policy.md](media-policy.md)), `alt` (required, 1 to 300 characters: say what is in the picture, not that it is a photograph) and `width` / `height` (both, in pixels of the published file: the list lays the picture out at its own proportions before it loads). An entry without a cover is valid for the schema and renders as its caption alone: the site never draws generated art for a photograph.
- `title` is the caption's first line, `summary` one or two sentences (the standfirst), `date` the day it was taken (`YYYY-MM-DD`, or less).
- **The place is a link, not a coordinate.** The photograph's location is `placeSlugs` (at most one is the norm), the same references every entry uses, so the page links to the place on the globe and the place's panel lists the photograph. A GPS position never reaches the contract: there is no field for it and the media pipeline removes it from the file (media-policy.md). A place that is not published has no link; the photograph then has none.
- **Only the country known: `countryCode`.** When the owner remembers only the country (no geotag, "somewhere on the Amazon in Brazil"), the entry carries `countryCode` (ISO 3166-1 alpha-2, uppercase, any kind accepts it) and no `placeSlugs`. A code, not a group slug: the country groups are generated from the places and their slugs are not stable. The site names the country, frames it on the globe and lists the entry under no place. A GPS position, when the original has one, wins: the export links the nearest published place instead.
- `meta` conventions (not enforced): `Format` (`3:2 landscape`), `Licence`. No camera, lens or settings: they are EXIF, and EXIF is stripped.
- `body` is optional prose after the picture (`paragraph`, `heading`, `list`, `quote`, `link`); a longer note on how it was taken belongs there. More pictures go in `image` blocks.
- `tags` and `sensitive` work as for every kind.

## 5. What the private gates must add

Gate 1 (JSON Schema, copy of `packages/schemas/published.schema.json`, draft 2020-12, ajv strict) covers shapes, lengths, patterns, the closed block union and `additionalProperties: false`. It **cannot** express the following; Gate 2 must re-implement them (they are in `parsePublishedProjection` here):

1. total body text at most 60,000 characters per entry;
2. `tags` unique within an entry; `meta` labels unique (case-insensitive);
3. `width` and `height` both present or both absent (cover and image blocks);
4. no credentials in an https URL (`https://user:pw@host` matches the pattern);
5. cross-references, per kind, now including `poem` and `photograph`: place `related` refs resolve to a published entry of that kind, `placeSlugs` resolve to published places, no duplicate slug within a kind, group rules as before;
6. every `/media/` path (place images, covers, image blocks) exists as a file the export owns.
Not fatal, but the gate reports it as a warning (the contract itself accepts it): 7. `sensitive: true` on an entry without a `cover` and
without an `image` block, which can only be a mistake. `sensitive` itself is shape-checked by Gate 1 (`boolean`, optional); a value that is
not a boolean (`"true"`, `1`) fails there.

The contract change is additive (this includes `sensitive`): nothing changes for projections without the new fields, and `schemaVersion` stays `1`. Old plain bodies keep exporting byte for byte (`body` is new on entries only; a place's `body` is still `string[]`; blocks for place bodies would be a later, separate additive field).

## 6. Not representable yet (errors today, additive later)

Each would be a new optional field or block type in `/v1`, with this repo's schema, tests and docs first, then the private mapper:

- inline spans (emphasis, strong, code, links) as an optional `spans` array next to a block's `text` (renderers ignoring it keep showing `text`);
- nested lists, tables, callouts, footnotes;
- entry-to-entry and entry-to-place references inside the text (a typed `ref` span or block);
- `images` (gallery) on entries, a `references` collection, a table of contents or heading ids;
- Markdown for place bodies.

## 7. The career document (a singleton, not an entry)

One more vault document maps onto the contract, and it is **not an entry**: `content/career/index.md` (`type: career`), a YAML header plus a Markdown body, exported as the optional top-level `career` object of the projection (shape and limits: [api-contract.md](api-contract.md), "The career document"). It has no slug, no kind and no collection; there is at most one, and it is absent while its `status` is not `published`. The private model is `src/vault/model/career.ts`; the writing guide is the private `docs/writing-entries.md`, "Career".

| Vault header | Contract field | Rule |
| --- | --- | --- |
| `title` | `title` | 1 to 40, one line. |
| the body's one paragraph, or `summary` | `summary` | The profile statement. Not both; one paragraph, no hard break, at most 500 characters. Any other block in the body (heading, list, quote, image, code, link card) is an error. Inline marks are flattened with a warning, as in an entry. |
| `updated` | `updated` | `YYYY-MM`, authored. A month in the future is an error; a document that mentions a later date is warned about. |
| `availability: { text, asOf }` | `availability` | Optional. `text` 1 to 120, one line of plain text (no e-mail address or phone number); `asOf` `YYYY-MM`, a month in the future is an error. Both are required when the key is there. |
| `portrait: { file, alt, rights }` | `portrait` | Optional. `file` is `./portrait.<ext>` next to `content/career/index.md` (raster only), `alt` 1 to 200 characters (required), `rights: own \| licensed \| permission` (required). Exported as `{ src: "/media/career/portrait.<hash>.<ext>", alt, width, height }` with the real pixel size; the file's own name is never published; the same media checks as every published image (no EXIF/XMP, 3000 px, 2.5 MB). |
| `roles` | `roles` | Most recent first by `start` (an error otherwise). `place: place/<slug>` becomes `place: "<slug>"`. |
| `education`, `languages`, `skills`, `links` | the same names | Same field names; `orgUrl` and `links[].url` are https without credentials. |
| `status` | (filter) | Only `published` is exported; the preview (`pnpm export:preview`) includes it whatever its status. |
| `id`, `notes`, `type`, `schema` | not exported | Private. The singleton's own `id` is not exported (it has no public identity), unlike the `id` of a role or an education item, which is authored and public. |

Rules the private validator adds on top of the contract (errors for a published document, warnings for a draft): no start more than twelve months ahead, no e-mail-like or phone-like text and no messenger or `mailto:`/`tel:` link (the same value checks as the contract's), ids unique across roles and education, no empty `roles`, no skill group without items, no markup-looking text (a real HTML tag such as `<b>`; `Array<T>` and `a<b` are fine), a place reference that exists and, for a published document, is published (otherwise the export would drop it). The second gate (`checkProjectionSemantics`) re-implements the contract's zod-only rules, as for entries (section 5).

**Privacy by construction.** The header is strict and has no key for an email address, a phone number or a street address, in the vault and in the contract alike, so neither can leave the private repo by accident. A role's `location` is a free-text city and country, not an address. The only availability is the dated `availability` text; whether a contact line or a location line should exist is a contract change, to be decided by the owner (not made here).

**Order of deployment** (the contract must know the key before a projection carries it): see [api-contract.md](api-contract.md#the-career-document-career).

**Conformance sample.** `packages/published/fixtures/demo.json` has a made-up `career` (made-up employers: "Example Studio", "Sample Works Ltd", example domains only) that uses every field, and the blueprint `portrait` (`/media/demo/portrait-example.svg`), so the career page ([career-page.md](career-page.md)) can be developed on `pnpm dev:demo`.
