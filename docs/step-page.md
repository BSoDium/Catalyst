# The step page (a place in the panel)

Design note and prototype status. Written 2026-10-25 from the owner's brief; the prototype runs on the demo data and changes no contract.

## The brief

A place that is a **step** of a bigger trip no longer opens on the trip's big map and a timeline (judged ugly). It shows what the step itself has: the owner's description, a few pictures, and a small card for the trip. When a step has **entries** (articles, software, artworks, poems) they are the priority and the travelling becomes context, collapsed. Pictures taken at a step belong to the photography section too. And the secondary question: how does it hold with many pictures.

## What the prototype does (`components/place-detail.tsx`, `trip-card.tsx`)

| Step has | Page |
| --- | --- |
| no entries | the header (cover, name, facts strip), then the story open: summary, body, the pictures (grid, four shown, the rest behind a disclosure), and the trip card |
| entries | the header (cover, name, facts strip), then the entries by kind (unchanged), then **one closed line**, "On the road here" with what is inside ("2 pictures · the story · Demo route"), that opens the same story |

- **Trip card** (`TripCard`, reworked as a poster for #510 from the owner's mood board, direction B "giant type"): the poster across the top (`TripPoster`: a flat field, the trip's one word in giant capitals tone on tone, `tripWord` of its title, e.g. TRANSATLANTIC, BALKAN; the route above it as one thin ink line in the maps' patterns over the land (a faint shape with its coast; the 50 m coast for a regional trip, under 40 degrees, the 110 m coast for a trip across the world; surfaces without outlines or borders), the word nested in the bottom-left corner with the same space under it as to its left, and kept clear of the route: above the word across the width, or, when the poster is wide enough that the room to the right of the word holds the route at the full height, there; the start, the end, this step and up to three highlights are named (`pickHighlights`: the stops with the most linked entries, well apart; none for a stop nothing is linked to), a square at every stop, the start, the end and this step named, this step ringed), then the figures ("33,570 km · 70 stops · 12 countries": the value bold and dark, its unit smaller and quieter; the distance reads "About …"), a photograph of the trip as the poster's backdrop when one was taken at a stop (the owner's pick, the route's `cover`, when it has one; else the most recent that is not sensitive taken at a stop or during the trip; its levels are held in a band the ink reads on, the light end in the light theme and the dark end in the dark one, by an SVG filter that gives every channel the same slope and intercept so the colours keep their relations (`TripPhotoFilters`), not dimmed by a veil; it runs on under the figures and fades into the card's background, so it ends in no edge, and a photograph with a horizon (`lib/horizon.ts`: the row where its colour changes most, read from a small copy of it once it has loaded) is placed so that the horizon is the seam between the poster and the figures; the land on top of it is a translucent surface in the field's colour, without outlines or borders: it lightens the photograph in the light theme and darkens it in the dark one; `?poster=flat` shows the flat field to compare), then in descending weight the trip's own name, one mono line of facts ("70 stops · 12 countries · 2025-07–2025-10"), where the step falls ("Stop 50 of 70") with the stop before and after as two quiet rows (an arrow, the place as a link, "by ferry · about 170 km"), and last, when the trip has a public page, a solid inverted button (black in the light theme, white in the dark one) "See the whole trip on <host> ↗", to the right of the stop before and after (it takes the full width of a line of its own when the two do not fit side by side: measured, `TripFooter`) (neutral on purpose: it reads right for a trip that is over). A place a trip passes several times says "Visited 3 times" and lists no hop (each visit has its own). Several trips are a carousel in the photographs' way (`TripRail`, `lib/trip-carousel.ts` on `lib/photo-carousel.ts`): a native scroller with an empty track and a snap point per card, the cards in a sticky layer placed from the scroll position so they change in width only (the card in front gives way to the next as it comes; on a phone one card across the row, in a wide panel the large card with the edge of the next and a hint of the one after, the row stopping where the LAST card is the large one), what is drawn in a card kept at its full width and cropped by its box, every card as tall as the tallest, the same arrows as the photographs'. `--g` (0 to 1, how much of its width a card has) drives the type: the title from the thinnest weight of the face to the heaviest, the figures, dates, stops and link fading in as the card comes in. The heading "Trips" has the count and the position ("01 / 03", said aloud); a card out of view is a box of no width that stays in the tab order, and focusing something in it brings it in. One trip is a card under the heading "Trip". The trips are a section of their own after the entries, not behind "On the road here" (which keeps the story and the pictures). The poster is the card's full width and at most 320 px high: on a wide panel it stretches in width, not in height (`TripPoster`, measured). The word is a default derived from the title (the longest word that names something, the later on a tie); an authored word per trip is a possible next step (it would be a field of the route in the content repo and the published contract). The big map card and the rail timeline (`trip-itinerary.tsx`) are gone.
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
