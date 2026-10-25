# Fixtures

`demo.json` is **made-up demo data**: invented places-and-entries content, invented text, generated media. It exists for automated
tests (`@catalyst/published`, `apps/web`, `apps/api`, the browser checks that look places and entries up by slug) and for an explicit
`pnpm dev:demo`, where it lets you judge the design with a full-looking site. It is never the default anywhere, never real content and
must never be deployed (`CATALYST_CONTENT=demo` is for local use only). Production keeps real data only: replacing this file's
content with real entries is all it takes to go from demo to real.

## What is in it

- 18 places in 8 groups and one route (unchanged), a few of them with prose, dates, an image and `related` back-links.
- **18 entries**, written to read like a finished personal travel, archive and creative-coding site. Every address is `example.org` or
  `example.com`; no real business, person or private data.
  - 5 articles (travel and field-notes essays): one long one with 15 blocks and three figures, one of them a small 480 px diagram, with "Fig. N" mentions in its text (`demo-article`), one very short (2 blocks), one with a very long
    title (`vietnam-by-rail`), two mid-sized. Date precisions: full date, month and year only.
  - 4 projects with `Stack`, `Status` (`Active`, `Paused`, `Archived`), `Repository`, a repository link, code blocks (TypeScript, GLSL,
    Rust, Python, shell) and a changelog list (`demo-project`, `timetable-diff`, `label-collision-engine`, `weather-ledger`).
  - 5 artworks with `Medium`, `Year`, `Dimensions`, `Edition` (and `Series` for a 12-plate series): `demo-artwork`, `night-platform-split`,
    `monsoon-index`, `altiplano-sediment`, and `figure-study-two`, the one **`sensitive: true`** entry (a made-up charcoal study with an SVG
    cover and one image block, at Kyoto): the conformance sample for mature content, used by the browser check
    `apps/web/scripts/entries/sensitive.mjs`. Do not mark another entry sensitive: tests assert there is exactly one.
  - 4 poems: two in English (a six-stanza poem and a haiku-like one), one in French and one in Spanish, with a `Language` fact each,
    indented lines and one long verse line: `demo-poem`, `citadel-rain`, `quai-de-nuit`, `cuesta-arriba`.
  - 4 photographs: a 3:2 landscape, a 4:5 portrait, another landscape and a 1:1 square (stand-in SVGs, `photo-*.svg`), three linked to a place and one with none: `demo-photograph`, `rain-at-the-gate`, `sea-wall`, `platform-nine`.
- **A made-up `career` document** (the optional top-level `career` object, see `docs/api-contract.md`): four roles at invented employers
  (Example Studio, Sample Works Ltd, Placeholder & Co, Demo Labs), an ongoing role, a role with no end, a year-only start, a role with no
  highlights, two education items (both with a place), three languages, four skill groups, three links on example domains and an abstract halftone
  `portrait` (`/media/demo/portrait-example.svg`, 4:5; a real portrait is a raster file). It is the sample the career page (`/career`) is
  developed against on `pnpm dev:demo`; a test keeps it plainly fictional (example domains, no contact details).
- Together they use every body block type, 1 to 4 places each (both directions of the place link are exercised, including one place that
  names an entry the entry does not list), 2 to 6 kebab-case tags, and dates spread over 2021 to 2026. Eleven of them have an authored
  cover; the other seven exercise the generated cover art (the design system's fallback).
- The slugs `demo-article`, `demo-project`, `demo-artwork` and `demo-poem` are the first entry of their kind and are referenced by
  scripts and tests: do not rename them. The other slugs are referenced by tests too.

## Media

Covers (1200x630) and figures (960x600) are abstract pixel and dither SVGs under `apps/web/public/media/demo/`, written by
[`scripts/demo/generate-media.mjs`](../scripts/demo/generate-media.mjs) (pure node, seeded, deterministic, each file under 12 KB; the
alt text and sizes the fixture uses live in its `MEDIA` table). Real content never uses SVG.

```sh
pnpm --filter @catalyst/published demo:media           # write the files (and delete stale ones)
node packages/published/scripts/demo/generate-media.mjs --check   # exit 1 when a committed file differs
```

A test (`src/index.test.ts`) checks that the committed files are exactly what the generator writes, that the fixture's `src`, `alt`,
`width` and `height` match the generator's table, and that no file in the folder is orphaned. `field-notes.svg`, the image of the
Lisbon place, is hand-made and kept.

## Validating

```sh
pnpm validate:published packages/published/fixtures/demo.json
```

To see the owner's real places locally use the preview instead (`pnpm export:preview` in the private repo, then `pnpm dev`); see the
content modes table in [docs/architecture.md](../../../docs/architecture.md).
