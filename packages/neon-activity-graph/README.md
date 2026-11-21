# Neon-activity-graph

[![npm](https://img.shields.io/npm/v/neon-activity-graph)](https://www.npmjs.com/package/neon-activity-graph) [![ci](https://github.com/BSoDium/Neon-activity-graph/actions/workflows/ci.yml/badge.svg)](https://github.com/BSoDium/Neon-activity-graph/actions/workflows/ci.yml) [![license](https://img.shields.io/npm/l/neon-activity-graph)](LICENSE)

A 3D activity graph in three.js: one glass block a day, two layers stacked in a column (say GitHub contributions on top of coding time), lit like a neon sign. In the dark theme the blocks' rods flicker on like gas tubes, with a synthesised hum; in the light theme the sun shines through the glass and casts coloured shadows and caustics. The camera never moves, so the picture is rendered progressively (soft shadows and anti-aliasing accumulated over a few dozen frames) and then the GPU goes idle.

It draws the graph only: no panel, no figures, no legend. Hover and keyboard events are handed to you as data (`onHover`) so the card is yours.

<p>
  <img alt="Dark theme" src="docs/dark.jpg" width="49%" />
  <img alt="Light theme" src="docs/light.jpg" width="49%" />
</p>
<p>
  <img alt="Custom colours (the demo's Technicolor preset)" src="docs/technicolor.jpg" width="98%" />
</p>

- Framework-agnostic core (`createActivityGraph`) and a React wrapper (`neon-activity-graph/react`)
- Generic data: two layers of `{ date, value }`; adapters for GitHub's contribution calendar and WakaTime's summaries
- Light and dark themes (following `prefers-color-scheme` by default), phone layout (4 strips), reduced motion, a `lite` mode
- No assets to bundle: the baked light of the dark theme is embedded (41 KB PNG, loaded only for the dark theme)
- `three` is a peer dependency, and is loaded on demand (`import("three")`), so the entry is small

## Install

```sh
npm install neon-activity-graph three
```

## Quick start

Vanilla:

```ts
import { createActivityGraph, fromGitHubCalendar } from "neon-activity-graph";

const graph = createActivityGraph(document.getElementById("graph")!, {
  data: {
    top: fromGitHubCalendar(calendar), // GitHub's contributionCalendar, or any { date, value }[] layer
    bottom: { label: "Coding", unit: "h", days: [{ date: "2026-11-19", value: 3.5 } /* ... */] },
  },
  onHover: (day) => { /* day: { date, top, bottom, x, y, outline } | null: show your card */ },
});

graph.update(newData);       // rebuilds the graph
graph.setTheme("dark");      // "light" | "dark" | "auto"
graph.destroy();             // frees the GPU resources and the listeners
```

Give the container a size: the picture fills it (about 4:1 for one strip; with `strips: 4`, about 4:5). It needs WebGL 2.

React:

```tsx
import { ActivityGraphView } from "neon-activity-graph/react";

<ActivityGraphView data={data} theme="auto" className="aspect-[4/1] w-full" onHover={setDay} />
```

`data` should be memoised (a new object rebuilds the graph); callbacks can be new closures at every render.

## Data

```ts
interface GraphData { top: GraphLayer; bottom: GraphLayer }
interface GraphLayer { label?: string; unit?: string; days: { date: string /* "2026-11-19", UTC */; value: number }[] }
```

The graph shows the last `weeks` weeks (53 by default) ending at the latest day of either layer; missing days are 0 (a flat tile). A block's height and colour follow `sqrt(value / max)` of its layer. Adapters (all pure, no network): `fromGitHubCalendar`, `fromWakaTimeSummaries`, `fromRecords(rows, date, value)`; `fakeLayer({ seed })` makes repeatable fake data for demos and tests.

## Options

| Option | Default | |
| --- | --- | --- |
| `data` | required | The two layers, or `null` while they are being fetched (only the place-holder shows; `update(data)` builds the graph). |
| `weeks` | `53` | How many weeks are drawn. |
| `strips` | `1` | `1` is one long strip; `4` staggers four strips for a narrow, tall box (aspect about 0.8). |
| `theme` | `"auto"` | `"light"`, `"dark"` or `"auto"` (follows `prefers-color-scheme`). Change it with `setTheme`. |
| `colors` | green on top, blue below | `{ top?: { light?: [low, high], dark?: [low, high] }, bottom?: ... }`, colours as `#rrggbb` or `0xrrggbb`: the glass of a quiet day and of the busiest one. Change them live with `graph.setColors({ top, bottom })` (React: change the `colors` prop): the blocks are rebuilt in place, debounced by 120 ms, without the start-up and without refetching; about 0.8 s on a laptop (at 1440 px, 371 days), the old picture stays, softened, until the new one is in focus. Colours other than the defaults get a generic rod (the hue lifted toward white) instead of the tuned green and blue. |
| `background` | nearest opaque ancestor background | A CSS colour, or `(theme) => css`. The ground takes it, so the picture has no seam with the page. Call `setTheme` again after it changed. |
| `rodColor` | `undefined` | `({ layer, index, date, t }) => [r, g, b] \| null`: the dark theme's rod colour (linear RGB, around 0..1; `t` is how busy the day was). Giving it turns on the "string of lights" look: clear glass, no grey veil, softer bloom; `null` keeps the default colour for that day. |
| `sound` | `true` | The synthesised hum, dings and soft bzzs of the start-up. They play only once the browser lets the page make sound (after the visitor interacted with it) and only while the graph is on screen. |
| `reducedMotion` | `"auto"` | `"auto"` follows `prefers-reduced-motion`; when reduced there is no start-up and no flicker. |
| `lite` | `"auto"` | The light version: a third of the frames, lower resolution, simpler blocks. `"auto"` turns it on for coarse pointers and for machines with 4 cores or fewer or under 4 GB. |
| `grain` | `0.012` | Camera grain strength; `0` is off. |
| `templatesUrl` | embedded | URL of `caustic-templates.png` (see below) instead of the embedded data URI. |
| `label` | "Activity graph, ..." | The accessible name. The arrow keys walk the days (focus the graph by clicking it), Escape lets go. |
| `placeholder` | `true` | Shows the flat days (the same slab, seen by the same camera, strips on a narrow box) at once, pulsing, and fades it out when the first picture is on screen. The React view renders it itself, so it is in server-rendered pages. |
| `overlay` | off | `true` or `{ outline?, card?, locale? }`: the day's outline (an SVG path round its blocks) and a day card, drawn over the graph. `card` can be `false` or a function `(info) => string \| Node`. Styled with CSS variables on the container or above: `--nag-outline`, `--nag-outline-fill`, `--nag-card-bg`, `--nag-card-fg`, `--nag-card-muted`, `--nag-top`, `--nag-bottom`, `--nag-card-radius`. |
| `maxPixelRatio` | `2` | The highest pixel ratio the picture is rendered at (`lite` is always 1). |
| `maxPixels` | `8_000_000` | The most pixels rendered; a larger container is rendered at a lower ratio (also capped by the card's texture size). |
| `onLayout` | | `(bounds) => void`: where the blocks are on the screen, `{ left, right, top, bottom }` in CSS pixels of the container (the first layout, and every resize). The same numbers are on the container as the CSS variables `--nag-content-left`, `--nag-content-right`, `--nag-content-top` and `--nag-content-bottom`, and in `graph.bounds`: use them to line a caption up with the picture and not with its box (the demo hangs its title in the empty ground at the bottom left, `left: var(--nag-content-left)`). |
| `onHover` | | `(info \| null) => void`: `{ index, date, top, bottom, outline, x, y, behind }`. `outline` is the SVG `points` of the day's silhouette, `x, y` a point on its top in CSS pixels of the container. Clicking days that are behind one another cycles through them (`behind`). |
| `onReady` / `onLit` | | The first picture is on screen (fade your place-holder); the picture is lit (`false` while the start-up runs). |
| `startup` | | `({ inView }) => { start?, stop? } \| void`: called each time a start-up is prepared, to hook your own sound or greeting to it. |
| `debug` | | `{ metrics?, wireframe?, neonHold? }`: development helpers (`data-*` timings on the container, the glass as a cage, the picture held half on). |

`createHoverOverlay(container, options, labels)` is the overlay on its own, for a graph you drive yourself. In React, `<ActivityGraphView aspect={4} overlay />` takes the same options (`aspect` is the box's, so the server-rendered place-holder has the right shape).

The blocks' bounds are also known before anything is drawn: `predictBounds(weeks, strips, width, height)` (in `neon-activity-graph/layout`) is what the container's `--nag-content-*` variables are set from at creation, so a caption lined up with the picture is placed at the first paint and does not move when the scene arrives; the scene's own measurement replaces it a moment later (a few pixels at most).

A flat place-holder that shares the scene's camera (so the scene replaces it in place) can be drawn without loading three.js: `import { placeholderTiles } from "neon-activity-graph/layout"` gives an SVG `viewBox` and one path of all the squares.

## Performance

- Nothing moves, so the picture is drawn once, a frame at a time (96 jittered samples; 32 in `lite`), then the render loop stops. Hover only re-lights the blocks (a few frames, then stops again).
- The start-up and the idle flickers update the light of the blocks, not their geometry: a light update costs about 0.05 ms of CPU and a frame about 0.5 ms on an Apple M4; on an emulated Pixel 7 (CPU slowed 6x) 0.7-0.8 ms and 4-5 ms.
- The one-time build (geometry, ground light) stalls the main thread for a few hundred ms, up to 1.3 s on a slowed phone. Dark theme: the baked light is decoded once.
- The idle flickers run only while the graph is in view and the tab visible; `prefers-reduced-motion` skips the start-up altogether.
- The picture is rendered at the container's size times the pixel ratio (up to 2), so it grows with the screen; above 8 million pixels the ratio drops. Measured (Chrome on an Apple M4, dark and light): a 2352 px wide graph on a 2560 px screen at ratio 2 renders 4704 x 1184 px (5.6 MP), the first picture is on screen after about 1 s, rAF stays at 16.7 ms (p95 16.8 ms) with a one-time build hitch of 250-330 ms, JS heap about 100 MB. GPU memory is not measured: expect a few hundred MB of half-float targets at that size, which `maxPixels` bounds.
- three.js is imported on demand: until the graph is created nothing of it is loaded.

## Browser support

Anything with WebGL 2 and half-float render targets (current Chrome, Edge, Firefox, Safari 15+, iOS Safari). Without WebGL 2 the call fails (logged); check first and draw a fallback if you care (`document.createElement("canvas").getContext("webgl2")`).

## How the optics work

- **Light theme.** The sun's light through the glass is traced on the GPU (`ground-light.ts`, a vertex shader that splats rays onto the ground): refraction, Fresnel, total internal reflection, the glass's colour absorption, rounded edges. The ground's brightness is a signed difference to what it would have got with no glass, so shadows are coloured and soft and the caustics are the surplus. `glass-caustics.ts` is the readable CPU version of the same optics, with the tests.
- **Dark theme.** There is no sun; the light is each block's rod. What one block casts on the ground is *baked*: `assets/caustic-templates.png` holds path-traced templates (Mitsuba 3) of a glass block with a rod in it, for 3 heights x 4 heights above the ground, averaged over the square's symmetries. The graph lays the right template under every block, in the rod's colour. Tracing this live does not work: with the rays a page can afford the result is noise.
- **Start-up.** The blocks are split into 8 oval areas, each with its own stutter, then a warm-up; a block whose rod is off is dim and lit by its lit neighbours. The sound is Web Audio (a 100 Hz ballast hum and bell-like dings), no file. Afterwards, rarely and less and less, a batch of tubes flickers like a sign's.
- **Grain.** A soft, luminance-dependent noise added in the last pass, like a camera's.

### Regenerating the caustic templates

Only needed if the blocks' shape or the rod changes. See `scripts/caustic-templates/README.md` (Mitsuba 3, about 15 minutes), then `pnpm embed:templates` rewrites the embedded data URI (`pnpm build` does it too).

## Demo and playground

The demo's fonts are Shrikhand (title), Bricolage Grotesque (text) and JetBrains Mono (labels), all SIL Open Font License 1.1 (licence texts in `demo/public/fonts`), Latin subsets, self-hosted. It also shows the colour presets (`setColors`), a title that switches on with the graph's start-up, and the overlay.


The [demo](https://bsodium.github.io/Neon-activity-graph/) draws the author's current activity (GitHub contributions over WakaTime coding time) and falls back to generated data when the activity file is not there. `demo/` is the page, `demo/scripts/fetch-activity.mjs` fetches public data without a token (a scheduled workflow writes `activity.json` to the `data` branch every 6 hours; set the repository variables `GITHUB_LOGIN` and `WAKATIME_USER` to draw somebody else).

```sh
pnpm demo  # the demo page
pnpm dev   # the playground: fake data and every option
```

## Releasing (maintainers)

Releases go through npm Trusted Publishing (OIDC): no npm token is created or stored. `0.1.0` was published by hand (a trusted publisher can only be attached to a package that exists); the trusted publisher is set on npmjs.com (package > Settings > Trusted Publisher > GitHub Actions: user `BSoDium`, repository `Neon-activity-graph`, workflow `release.yml`, environment empty).

From now on: bump `version` in `package.json` (the next one, `0.1.1`, is the first to be published with provenance), commit, then `git tag v0.1.1 && git push origin v0.1.1`. The `release` workflow tests, builds and publishes with provenance; the tag must match the version, and a tag for a version already on npm does nothing.

## License

MIT
