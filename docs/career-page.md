# Career page (`/career`)

The curriculum vitae as a page, for the people who read it (and print it): `apps/web/app/routes/career.tsx`, `components/career-page.tsx`, `lib/career.ts` (dates, languages, structured data: pure), `lib/career-meta.ts` (head tags), styles at the end of `app/app.css` ("The career page"). Data: the optional top-level `career` of the projection ([api-contract.md](api-contract.md#the-career-document-career)); there is no other source and no LLM.

## When it exists

Only while the published projection has a `career` (the owner's private document has `status: published`), or in `pnpm dev` (the preview carries the draft) and on demo content. Without one: `/career` is a real 404 (the site's not-found page), there is no link to it anywhere (header, hero, search), it is not in `sitemap.xml`, and nothing else changes: production has none until the owner publishes. The root loader's `hasCareer` feeds the header and the hero (`lib/use-has-career.ts`); the search index has the row only when the career exists; `scripts/prod/check.mjs` checks the right case from the sitemap (404 and no link, or the page's head, h1, JSON-LD and no contact channel).

## Where it is reached from (owner decisions, 2026-10-14)

- **Home hero:** a fifth quiet row "Career" after Poetry (same row style, arrow, no count; phone too). It is not a content kind, so the caption's section names are unchanged ([landing.md](landing.md)).
- **Header:** a "Career" link after the four sections and before the search. Seven items need tighter tiers (`[data-career]` in app.css); under 24 rem of header (a phone narrower than 384 px) the link is left out there: the hero row and the search have it.
- **Search palette:** one row, type `career` (words: career, CV, resume, experience, education, employers and skills named in it).
- Not a section: no list, no count, not in the sections table (`lib/sections.ts`).

## Layout

Running head over one hairline (the document's title at the left, "Updated Month YYYY" at the right), the owner's name as the h1 at the list-title scale with the optional portrait beside it (a SQUARE of its own size, `clamp(9rem, 20cqi, 17rem)` from 40 rem, its top level with the name's: never sized from the text beside it, which made it blow up at about 820 px, `object-fit: cover`, `object-position: 50% 30%`, no frame, no radius; a 5.5 rem square on a phone; an SVG with its own `prefers-color-scheme` rule follows the scheme, see `docs/portrait/portrait.svg`, width and height attributes, `loading="eager"`, `fetchpriority="high"`; none = the name block takes the room, no frame), the profile statement, the optional availability line ("... · as of September 2026": the month only, never a relative time), then:

1. **Languages: one compact line directly under the head.** The owner asked whether languages should be higher; they are: a recruiter's first filter is "does this person work in my language", the line costs one row, and a footer would be below the fold on a phone. They keep the owner's other idea (skills after education) intact.
2. **Experience**: an ordered list, newest first as authored, two columns from 64 rem (who, when and where at the left in a fixed 26 rem; highlights and skills at the right), one faint 1 px rail with a 41 px marker per item (the organisation's logo, else the role's icon) (`careerIcon` picks the icon from the title: rocket for a founder, layers for full-stack, code for front-end, palette for design, briefcase otherwise; education: cuboid, sigma, cap; the role in progress is accent-coloured), no boxes; each item: organisation (h3, linked to `orgUrl` when there is one) with the location at the right (linked to the place's page when the place exists), role title, one muted line `employment | period (`<time>`) | length of the stay`, highlights, role skills as quiet chips.
3. **Education**: the same timeline.
4. **Skills**: groups as a definition list, items comma separated (compact).
5. **Elsewhere**: the document's public links (GitHub, ...), https only, `rel="me noopener noreferrer"`. No contact channel anywhere (the contract has none; a Copy-email button is a later task).

Headings: h1 name; h2 Languages (visually a label), Experience, Education, Skills, Elsewhere; h3 organisation or institution. Periods: `Sep 2025 – Present`, a missing end shows the start alone, a year-only date stays a year. Solid colours of the page tokens only (no opacity), no animation at all (so reduced motion has nothing to switch off), no layout shift (sizes known).

## Head tags and structured data

Title `Career · <name>`, description the profile statement cut at 160 characters, canonical, the site's default `og:image` (the portrait is never the share image and never in the structured data), one JSON-LD `ProfilePage` about a `Person` with only the site's own name and role line, `url` and `sameAs` (the document's public links); no employer, place, image or contact detail. Sitemap: `/career` with `lastmod` = the reviewed month. Robots: as every page (allowed on the production host, disallowed elsewhere).

## Print

Chrome (header, skip links, scrim) hidden; ink on white whatever the scheme; one column (the blocks stack), items never split, headings keep with their content, the portrait at 3 cm, links print their address after the text, 10.5 pt text. A4 PDF of the demo: 2 pages.

## Portrait

Contract: `career.portrait` `{ src, alt, width, height, dark? }`, the first four required when present, and an optional `logo` `{ src, width, height }` on a role and on an education ([api-contract.md](api-contract.md)): the logo is the item's marker (a file of the page's own, `public/career-logos/`, is the fallback by name), `portrait.dark` the picture for the dark colour scheme. The stay length of a role in progress runs to `career.updated`, never to the clock. Private repo: `portrait: { file: ./portrait.webp, alt, rights: own }` in `content/career/index.md`, the file next to it; exported as `/media/career/portrait.<hash>.<ext>` with its real size, copied by the publication PR; EXIF/XMP, size, rights and alt are enforced by the private validation. The demo has an abstract SVG one.

## Tests

- Unit: `lib/career.test.ts`, `lib/career-meta.test.ts`, `components/career-page.test.ts` (each block, no portrait, no availability, empty skills, long texts, present, escaping, no contact channel), `routes/career.test.ts` (404 / data), `navbar.test.ts`, `landing-hero.test.ts`, `search.test.ts`, `sitemap.test.ts`; schemas `career.test.ts` (portrait); published and api tests.
- Browser: `scripts/career/check.mjs` (against the demo content, plus `ABSENT_URL` for the no-career case): structure, headings, order, `<time>`, portrait attributes, layout shift, no horizontal scroll at 320, 390 and 1440 in both schemes, keyboard order, reduced motion, print emulation and PDF, header, hero row and search, 404 and no links without a career, sitemap. `scripts/contrast/audit.mjs` has the pages `career` and `home-search-career`; `scripts/home/hero.mjs` counts five rows (`HERO_CAREER=0` for content without one); `scripts/prod/check.mjs` is guarded.

## Not verified

Safari and iOS, a real printer, a real recruiter's PDF viewer, screen readers (the markup is semantic and tested, not heard), the real portrait (none exists yet: the demo's is a drawing).
