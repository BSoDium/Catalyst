# The activity picture (software page)

The 3D picture on `/software`: a year of GitHub contributions (green, on top) and WakaTime coding time (blue, below) as glass blocks, one column a day. Code: `apps/web/app/components/activity-panel.tsx` (the panel, figures, legend), `activity-scene.tsx` (the scene, raw three.js), `ground-light.ts` (the light on the ground), `neon.ts` (the start-up, behind `?neon`), `lib/activity.ts` and `lib/activity-view.ts` (the data and the geometry shared with the place-holder), `lib/glass-caustics.ts` (the readable reference of the optics, with the tests). The data is `activity.json` on the `data` branch (`.github/workflows/activity.yml`, every 6 hours, `[vercel skip]`).

## How the light is made

- **Light theme**: the sun through the glass, traced on the graphics card (`ground-light.ts`, a vertex shader; the same optics as `lib/glass-caustics.ts`): refraction, Fresnel, total internal reflection, the glass's colour absorption, rounded edges. The ground's brightness is a signed difference to what it would have got with no glass, so shadows are coloured and soft and caustics are the surplus.
- **Dark theme**: there is no sun, the light is each block's rod. What one block casts on the ground is **baked**: `app/assets/caustic-templates.png` (41 KB) holds path-traced templates (Mitsuba 3) of a glass block with a rod in it, for 3 heights x 4 heights above the ground, averaged over the square's symmetries so they are clean. The page lays the right template under every block (`stamps` in `ground-light.ts`), in the rod's colour. Tracing this live was tried and does not work: with the rays the page can afford the result is noise.
- Regenerating the templates (only if the blocks' shape or the rod changes): `scripts/caustic-templates/README.md`.

### Tunables (all in `activity-scene.tsx` unless said)

`CAUSTIC_POWER` (dark light strength), `STAMP_CONTRAST` and `STAMP_FOOT` (`ground-light.ts`: how much of the faint wide glow and of the bright foot of a block is kept), `POOL` (the soft haze), `ABSORB`, `STRAIGHT`, `SHADOW`, `GLEAM` (light theme), the bloom's blue/green factors in the show shader, `OFF_EMISSIVE`, `OFF_ENV` and the rod's off colour (the neon's off state).

## The neon start-up (prototype, `?neon`)

When the picture first appears in the dark theme the rods flicker on like gas tubes: the blocks are split into 8 oval areas (not square), each with its own stutter, same for all its blocks (a few ms and a little brightness off from one another), then a warm-up. A block whose rod is off is dim and the same for all (cool grey), lit by the blocks around it that are on. The ground light follows each rod. Sound is synthesised (Web Audio, no file): a low 100 Hz ballast hum that dies away slowly and short bell-like dings (a third of them low), faint; it plays only if the browser lets the page (not before the visitor has interacted with the page). It is skipped for `prefers-reduced-motion`. It is **off unless `?neon` is in the address**; shipping it means removing that gate, once the checklist below is done.

Dev-only helpers (not in the production build): `?lite` (the light version on any machine), `?neonhold` (the picture held half on, half off), and the `data-*` figures on the picture's box (`data-frame-ms`, `data-neon-ticks`, `data-neon-apply-ms`, `data-neon-frame-ms`).

## Testing checklist (before the neon is shipped without its flag)

Measured so far (dev build, Apple M4): an update of the neon costs about 0.05 ms, a frame about 0.5 ms. Emulated Pixel 7 (`activity-neon.mjs`, CPU x6, the Mac's GPU): update 0.7-0.8 ms, frame 4-5 ms, rAF p95 16.8 ms during the start-up; the page's one-time build stalls the main thread for up to 1.3 s at x6 (dev build, cold). None of this is a real phone's GPU.

1. **Emulated, repeatable**: `pnpm --filter @catalyst/web dev`, then `node apps/web/scripts/perf/activity-neon.mjs --device pixel7 --throttle 6` (also `--device mobile`, `--throttle 4` and `--throttle 10`). Look at `rafMs.p95`, `longFrames` and `dataset.neonFrameMs`. Repeat on a **production build** (the dev figures above include Vite's compile; a production build has no `data-*`, so use the rAF figures).
2. **Real devices, with `?neon`** (the page must be the production build, on the real network): a recent iPhone (Safari), a mid-range and a low-end Android (Chrome), an older laptop with integrated graphics, a 4K or 5K desktop display. For each: does the start-up run smoothly (no visible stutter beyond the flicker), does the page stay scrollable during it, does the picture end in the same state as without `?neon`, does the device warm up or the battery drop noticeably over 5 loads in a row.
3. **Sound**: with sound on and off, silent after a direct reload (blocked by the browser, nothing else breaks), audible after the visitor has clicked; not startling at the system's usual volume; nothing plays when the tab is in the background or after the visitor leaves the page; not played under `prefers-reduced-motion`.
4. **States**: switch light/dark theme during the start-up (it restarts cleanly, no stuck dim blocks); resize and rotate the phone during it; scroll the picture off and back; reduced motion; a page with the data failing to load (no picture, no error).
5. **Both themes, all widths**: the legend and figures at 1300, 1700 and 2560 px; the phone layout (4 strips, bleeding off the edges); the dark glow's brightness against the cubes' (the ground must never be brighter than the blocks).
6. **Before removing the flag**: decide the sound's default (on after a gesture, or off with a visible switch), cap the update rate on `lite` further if a real phone needs it (`fps` in `createNeon`, and `samplesCap` in `activity-scene.tsx`), and rerun 1-5 on the production build.
