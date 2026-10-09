# Fixtures

`demo.json` is **made-up demo data**: invented places-and-entries content, invented text, generated media. It exists for automated
tests (`@catalyst/published`, `apps/web`, `apps/api`, the browser checks that look places and entries up by slug) and for an explicit
`pnpm dev:demo`, where it lets you judge the design with a full-looking site. It is never the default anywhere, never real content and
must never be deployed (`CATALYST_CONTENT=demo` is for local use only). Production keeps real data only: replacing this file's
content with real entries is all it takes to go from demo to real.

## What is in it

- 18 places in 8 groups and one route (unchanged), a few of them with prose, dates, an image and `related` back-links.
- **17 entries**, written to read like a finished personal travel, archive and creative-coding site. Every address is `example.org` or
  `example.com`; no real business, person or private data.
  - 5 articles (travel and field-notes essays): one long one with 14 blocks (`demo-article`), one very short (2 blocks), one with a very long
    title (`vietnam-by-rail`), two mid-sized. Date precisions: full date, month and year only.
  - 4 projects with `Stack`, `Status` (`Active`, `Paused`, `Archived`), `Repository`, a repository link, code blocks (TypeScript, GLSL,
    Rust, Python, shell) and a changelog list (`demo-project`, `timetable-diff`, `label-collision-engine`, `weather-ledger`).
  - 4 artworks with `Medium`, `Year`, `Dimensions`, `Edition` (and `Series` for a 12-plate series): `demo-artwork`, `night-platform-split`,
    `monsoon-index`, `altiplano-sediment`.
  - 4 poems: two in English (a six-stanza poem and a haiku-like one), one in French and one in Spanish, with a `Language` fact each,
    indented lines and one long verse line: `demo-poem`, `citadel-rain`, `quai-de-nuit`, `cuesta-arriba`.
- Together they use every body block type, 1 to 4 places each (both directions of the place link are exercised, including one place that
  names an entry the entry does not list), 2 to 6 kebab-case tags, and dates spread over 2021 to 2026. Ten of them have an authored
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
