# Entry content model: from the vault to the contract

Design note for the private content repo's next export step. It maps a vault document (`content/<kind>/<slug>/index.md`: a typed YAML header plus a Markdown body) onto the **entry** shape of the public contract (`packages/schemas/src/published.ts`, documented in [api-contract.md](api-contract.md), "Entries"). It implements decision D3 of the private `content-model-v2.md` (Markdown reaches the public repo as typed, schema-validated blocks, never as HTML) with the names and limits this repo actually accepts. Where the two differ, **this repo's contract wins**; the private profile is to be narrowed, not the contract widened. Written 2026-10-08.

Kinds: `article`, `project` (a development project), `artwork`, `poem`. `poem` is new on both sides: the private envelope's `type` enum and the editorial content kinds (`EditorialContent`, `kindSets`, `DroppedRecord.kind`, importance links, `contentOf`) need it, and the mapper needs a `poems` collection (published poems only, sorted by slug, like the other three).

Conformance sample: `packages/published/fixtures/demo.json` (made-up demo data) has 17 realistic entries (5 articles, 4 projects, 4 artworks, 4 poems) with covers, tags, kind-specific meta and bodies that use **every** block type. A private test can export a vault that reproduces it and compare, and it validates against `packages/schemas/published.schema.json` with ajv in strict mode (checked).

## 1. Header to fields

The mapper builds a new object field by field, in this key order: `slug, title, summary, date, url, cover, tags, meta, body, placeSlugs`. Optional fields are **omitted** when empty (no `[]`, no `null`).

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
| `places: [place/x]` | `placeSlugs` | Keep only places that are published (as `mapContent` does today). |
| `status` | (filter) | Only `published` entries are exported. |
| `id`, `publishedAt`, `notes`, `rights`, `credit`, `readme.*`, `related`, `refKind`, `authors`, `year` | not exported | Private. A project's README snapshot is never exported; only an adopted `README.md` that passes the Markdown profile may become the body. |
| `lang` (`en`, `fr`) | poem `meta` `Language` | Reserved today. For a **poem** with no `Language` fact, emit `{label:"Language", value:"English"}` or `"Français"` (the language's own name). Optional for other kinds. |

Entry-to-entry `related` has no public field yet; it stays private (the place side already lists `related`).

`meta` conventions the web app will display (the schema does not enforce them): project `Stack`, `Status`, `Repository`; artwork `Medium`, `Year`, `Dimensions`; article `Publication`; poem `Language`. A `meta` value is plain text, never a link: put a repository or demo address in `url`, or in `links`.

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

## 4. Poems

A poem document is Markdown too, but its text is verse:

- In a `type: poem` document, **consecutive paragraphs form one `verse` block**: each paragraph is a stanza, each line of the paragraph (the soft or hard line breaks) is a line of the stanza. Headings, quotes, images and the rest map as usual; a heading closes the current verse block and the next paragraphs start a new one.
- Markdown strips leading spaces, so indentation is lost with plain paragraphs. When indentation matters, use a fence with the info string `verse`: the content is taken verbatim, a blank line separates stanzas, lines are only right-trimmed. Leading spaces (not tabs) are kept. (In Obsidian the fence shows as a code block; plain paragraphs render as prose.)
- Limits: a line is 1 to 300 characters with a visible character; a stanza has 1 to 60 lines; a verse block 1 to 60 stanzas. A longer line is an error (do not wrap automatically: a wrapped line is a different poem).
- Prose around the poem (a note, a dedication) is ordinary `paragraph` blocks, for instance after a `divider`.

## 5. What the private gates must add

Gate 1 (JSON Schema, copy of `packages/schemas/published.schema.json`, draft 2020-12, ajv strict) covers shapes, lengths, patterns, the closed block union and `additionalProperties: false`. It **cannot** express the following; Gate 2 must re-implement them (they are in `parsePublishedProjection` here):

1. total body text at most 60,000 characters per entry;
2. `tags` unique within an entry; `meta` labels unique (case-insensitive);
3. `width` and `height` both present or both absent (cover and image blocks);
4. no credentials in an https URL (`https://user:pw@host` matches the pattern);
5. cross-references, per kind, now including `poem`: place `related` refs resolve to a published entry of that kind, `placeSlugs` resolve to published places, no duplicate slug within a kind, group rules as before;
6. every `/media/` path (place images, covers, image blocks) exists as a file the export owns.

The contract change is additive: nothing changes for projections without the new fields, and `schemaVersion` stays `1`. Old plain bodies keep exporting byte for byte (`body` is new on entries only; a place's `body` is still `string[]`; blocks for place bodies would be a later, separate additive field).

## 6. Not representable yet (errors today, additive later)

Each would be a new optional field or block type in `/v1`, with this repo's schema, tests and docs first, then the private mapper:

- inline spans (emphasis, strong, code, links) as an optional `spans` array next to a block's `text` (renderers ignoring it keep showing `text`);
- nested lists, tables, callouts, footnotes;
- entry-to-entry and entry-to-place references inside the text (a typed `ref` span or block);
- `images` (gallery) on entries, a `references` collection, a table of contents or heading ids;
- Markdown for place bodies.
