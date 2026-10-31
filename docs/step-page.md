# The step page (a place in the panel)

Design note and prototype status. Written 2026-10-25 from the owner's brief; the prototype runs on the demo data and changes no contract.

## The brief

A place that is a **step** of a bigger trip no longer opens on the trip's big map and a timeline (judged ugly). It shows what the step itself has: the owner's description, a few pictures, and a small card for the trip. When a step has **entries** (articles, software, artworks, poems) they are the priority and the travelling becomes context, collapsed. Pictures taken at a step belong to the photography section too. And the secondary question: how does it hold with many pictures.

## What the prototype does (`components/place-detail.tsx`, `trip-card.tsx`)

| Step has | Page |
| --- | --- |
| no entries | name and quiet line, then the story open: summary, body, the pictures (grid, four shown, the rest behind a disclosure), and the trip card |
| entries | name and quiet line, then the entries by kind (unchanged), then **one closed line**, "On the road here" with what is inside ("2 pictures · the story · Demo route"), that opens the same story |

- **Trip card** (`TripCard`): the trip's map across the top (this step ringed), then in descending weight the trip's own name, one mono line of facts ("2025-07–2025-10 · 70 stops · about 32,700 km"), where the step falls ("Stop 50 of 70") with the stop before and after as two quiet rows (an arrow, the place as a link, "by ferry · about 170 km"), and last, when the trip has a public page, one full-width row "See the whole trip on <host> ↗" (neutral on purpose: it reads right for a trip that is over). A place a trip passes several times says "Visited 3 times" and lists no hop (each visit has its own). Two cards open, the others behind a disclosure. The map is the card's full width, never a small box in a tall one. The big map card and the rail timeline (`trip-itinerary.tsx`) are gone.
- **Photographs are pictures of the step.** A photograph (kind `photograph`) linked to the place shows in the step's picture strip, its cover linking to the photograph, and is **not** counted as an entry: a step whose only entries are its own photos is still a story page, not a page whose story is secondary. A `sensitive` photograph stays an entry (its card blurs it).
- No contract change: place `summary`, `body` (max 60 paragraphs of 5000), `images` (max 40, each with optional `caption`) and the entries' `placeSlugs` already carry everything. The demo's Bangkok now has a summary, a text and three pictures to show the no-entries page.

## Open: what "visit the trip" opens

There is no trip page: a route has a title, summary and dates but no slug and no address. The card therefore links to the stops either side. Options for a real destination, cheapest first:

1. **Nothing more** (the card plus neighbours): the trip is walked stop by stop.
2. **The globe framed on the trip**: the same mechanism as `/?country=BR` (the globe frames a group), with a route id; needs a route slug in the contract (additive) and a framing in the globe. Recommended next step: it is graphical, it fits "not the full page".
3. **A trip page** (`/trips/:slug`): the trip's story and all its stops. A real feature (contract, route, sitemap, list), only worth it once trips have prose.

## Open: where the step's words and pictures come from (policy)

`docs/owner-guide.md` states that Polarsteps text and photos never reach the site: only coordinates, names and step membership are used, prose and images are the owner's own. The brief reverses part of that, so three decisions are the owner's before any import is written:

1. **Text.** Default stays: nothing is copied from Polarsteps automatically. The step's words are written (or pasted) in the private repo's `editorial/` and exported as the place's `summary` and `body`, so the owner approves each step. A Polarsteps text is a source to start from, never published unseen (it may name people, a hotel, a time of day that places someone).
2. **Pictures.** Same rule: the owner picks which pictures of a step go public; each is a `photograph` entry (with `placeSlugs` = the step) when it belongs in the photography section, or a place `image` when it only illustrates the step. Metadata and GPS stripped, location as a place link only (`docs/media-policy.md`).
3. **Private zones.** `config/private-zones.json` (private repo) already keeps legs and stops out of the export. Text and pictures of a step inside a zone must be excluded by the same rule; the export must refuse them, not rely on the owner remembering.

The private repo's allowlist (`docs/import-contract.md` there) would also have to admit the fields it reads (step description, photo list) if the import is automated. That is a change of the unofficial-endpoint exposure (see `docs/architecture.md`, risk): reading more fields from the same single GET does not add requests, but photo URLs are signed and short-lived and must be downloaded during the sync run.

## Improving thin descriptions

Many steps have a one-line or empty description. Three honest levels, none invents facts:

1. **Facts from data the site already has**, composed into a line: "Arrived from Hue by road, about 190 km" (already in the card), the dates, the country, the stop's position in the trip. No new data, no prose.
2. **A draft in the private repo**: an offline, owner-run step (a script or Claude Code session over `editorial/`, never a call from the site or from CI) that turns a thin description plus the step's facts and the owner's neighbouring text into a proposed paragraph, written to `editorial/` as a draft with `status: draft`. The owner edits and publishes. The draft may only restate what the sources say; places, people and events not in them are not added.
3. **Leave it short.** A step with one honest sentence and good pictures is a good page. The layout does not need length: with no text, the pictures and the card are the page.

## Scale

The pictures are the risk, not the text. Measured on today's data and policy (before issue #336; `docs/media-policy.md` now says: photographs at 1280 px, WebP, about 100 to 150 KB, at most 40 in the section):

- the 18 published photographs are 5.9 MB, about 330 KB each; `projection.json` is 334 KB with them;
- a 70-step trip at 6 pictures a step is 420 pictures: about 140 MB of media in the repository and the deployment, and roughly 300 bytes of projection per picture (an estimate: about 130 KB more JSON, parsed by the web server on each cold start, since the loaders read the whole projection; the browser gets the place index and the one place's detail, not the projection);
- a place may carry at most 40 images by contract, and a photograph entry has no limit besides the list.

What keeps it healthy, in order:

1. **Lazy, sized, and bounded on the page** (done): `loading="lazy"`, width and height always given (no layout shift), four pictures open and the rest behind a disclosure, so a step never renders 40 images at once.
2. **Responsive sizes** (done for covers, issue #336): the export writes the picture at 1280 px and a copy 800 px wide, given as the optional `cover.small`; lists use `srcset`/`sizes` (`lib/cover-image.ts`). A step's own images (`place.images`, body images) do not have a small copy yet.
2b. **Curation** (done): the photography section holds at most 40 photographs (the export refuses more), so 40 photographs weigh about 4 to 6 MB, and `/photography` ends with a card that sends the rest to Pexels.
3. **Move media off the repository** once it passes a budget (suggested: 100 MB): Vercel Blob (or any object store) with the same content-hashed names behind `/media/`. The repository then holds the projection only. The Vercel plan's limits on deployment size and file count should be checked before the first large trip is imported (UNVERIFIED here).
4. **Projection size**: today `place.images` rides in `projection.json`, which the web loaders and the API read whole. For thousands of pictures the step's images would be better kept in a file per place (loaded for that place only) with the projection carrying the first image; the API's `/v1/places/:slug` already serves one place, the web loaders do not use it. Not needed below a few hundred pictures.
5. **The photography list** needs pagination (or a virtualised wall) past about 200 photographs; the current brick wall renders all of them.

## Verified

Demo data in the browser at desktop and 375 px (Bangkok: no entries, story open; Lisbon: entries first, story and a linked photograph in the closed disclosure; no horizontal overflow). Tests in `components/place-detail.test.ts`.
