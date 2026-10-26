# How the globe's 3D works: a report

Written 2026-10-26, when the moon became a real object in the scene. Everything here is in `apps/web/app/globe/`; the long-form notes are in [web-architecture.md](web-architecture.md) ("Production globe", "Skybox", "Ring of type", "Caption on the sphere", "The cinematic interlude") and [street-architecture.md](street-architecture.md). This page is the map of how the pieces fit, and what is and is not 3D.

## 1. The short version

There are **two WebGL canvases and a few 2D layers** stacked in the globe's box, plus, past a certain zoom, a **separate map renderer**.

| Layer (bottom to top) | What | Is it 3D? | Where |
| --- | --- | --- | --- |
| **Globe canvas** | Planet disc, land picture, graticule, borders, coastlines, sky, stars, routes, the moon, the horizon outline | **Yes**: one Three.js scene, one perspective camera | `engine/scene.ts`, `renderer.ts` |
| **Ring of type** | The small mono text that circles the planet | **No**: a flat 2D canvas | `engine/ring-layer.ts` |
| **Box and label overlay** | Place markers, group squares, their labels | **No**: a pixel canvas plus DOM labels, placed from the camera | `engine/box-scene.ts`, `label-dom.ts` |
| **Street map** (past zoom 3.7) | Roads, buildings: a different renderer | 2D (Web Mercator), registered to the globe's camera | `street/`, `handover/` |
| **Caption canvas** | "A personal archive, organised around places", the section names, and the UNIVERSAL word | **Yes**: a second Three.js renderer, same camera | `engine/caption-layer.ts` |
| **The moon's link** | Invisible `<a>` over the moon | DOM, placed from the 3D moon's projection | `engine/moon-overlay.ts` |
| **Hero** (name, rows) | Page text | DOM | `components/landing-hero.tsx` |

## 2. The globe canvas: one scene, drawn at art-pixel resolution

- **One camera, one scene, in the earth's frame.** The scene is the planet; the camera orbits it (the view's longitude and latitude) at a distance set by the zoom (`cameraDistance`, field of view 36.87 degrees). The "earth turning" of the idle rotation is the camera going round and the earth rotation angle (ERA) going up by the same amount, so the stars do not move (`stepSpin`).
- **The drawing buffer IS the art grid.** The canvas is rendered at 1/`pixelSize` of the screen (about 2 to 3 CSS px per art pixel, `TUNING.pixelSize`, always a whole number of device pixels) and scaled up with no smoothing, so every shader pixel is a pixel-art cell. Nothing is anti-aliased; tones come from a shared grey ramp (`palette.ts`), and "fades" are an ordered 4x4 dither (`dither4`, in `materials.ts`) or a staircase of tones, never an alpha blend.
- **Layers are `renderOrder`s over a depth buffer.** The planet is an opaque sphere of radius 0.998 in the page's colour that writes depth (so the far side's lines and stars are hidden by the depth test). On it, in order: the moon (0.4), the atmosphere shell (0.5, only in the interlude), the sky (0.5 and 0.6, at the far plane), the land picture on a skin at 1.002 (0.6), graticule (1), borders (2), coastlines (3), routes, mist, the horizon outline (6), the cities' lights (7). Routes hide behind the planet by an analytic ray-sphere test instead of the depth buffer (a one-pixel line would z-fight).
- **The land is a shader, not a texture-mapped sphere.** `surfaceMaterial` reads the Blue Marble grey (`earth-grey.png`) by direction, cuts it into three tones (0.42 / 0.62), keeps half the pixels by the dither, and cuts the land/sea edge with a 4096 x 2048 mask baked from the very coastline polylines that are drawn, so the fill sits exactly under the outline.
- **The sky** is a full-screen triangle (the Milky Way, from a baked 256 x 64 map looked up by galactic coordinates, Bayer-dithered to two tones) plus 20,000 one-pixel points at infinity. It lives in the inertial frame; one 3x3 matrix per frame (`viewToGalactic`) turns the camera's view into it. It is only drawn where the planet does not cover the picture.
- **Frames are on demand.** Nothing animates at rest; a frame is asked for by input, a timed fade, the idle rotation (paced to 10 a second), the caption, or (now) the moon. Holds (30 s idle, blurred window, off screen, data saver, reduced motion) stop them all.

## 3. Space view and street view

They are not blended in 3D; they are **one camera driving two renderers**. The globe keeps the view in one number, the unified zoom `zu`. Up to 6.5 it is the globe's zoom; above that the same number is the street map's (Web Mercator, `zoom_map = zu + log2 cos(lat)`). The globe canvas stays the pointer target throughout, so a gesture that crosses the threshold is the same gesture.

At `cutZoom` 3.7 (back under 3.45, a hysteresis) the controller renders the street map for the exact camera, waits for its tiles (at most 1.2 s), then swaps in one task: street shown, globe suspended, with a ~300 ms **tone cross-fade** of the picture (a dither dissolve exists and is parked: `HANDOVER.dissolve`). The two are registered to under a pixel, so only the line style changes. So the "blend" you describe is a registered cut with a short fade, by design: both are drawn in the same 1-bit pixel look to make it unnoticeable. Details: web-architecture.md "Handover", `handover/controller.ts`.

## 4. The text

### The ring of type: you were right that it is not 3D
A flat circle of text concentric with the planet's silhouette, `r (1 + 0.06)`, running clockwise, all upright to the outside. **One 2D `<canvas>` in the DOM** (not DOM text: it would be a couple of hundred elements with a rotation each every frame), above the WebGL canvas, `aria-hidden`, no pointer events. Glyphs are not drawn with `fillText` (turned text is outlines on the main thread: measured 6 to 13 ms a frame); each character is drawn once, upright, into a per-tone atlas, and a frame is `drawImage` of one atlas cell per glyph (a couple of hundred) with a rotation. It turns on its own clock (3 degrees a second) and draws inside the globe's frames when the camera moves. It has no depth: since the moon, a moon that is in front of the planet's centre plane knocks a disc out of it (`knockout`), so the ring is not painted over a body in front of it.

### The caption ("orbiting text"): genuinely 3D, in a second renderer
Each line is a strip of the sphere on a **real parallel** at radius 1.25 (floating 25 % above the surface), with a texture of its words (serif, italic, mono, a script) drawn once into a small canvas. The strip is stacked 28 times from the front face down toward the planet: the front slice shows the letters and a thin outline, the ones behind are the side of the letters, so the lettering has a thickness that shows wherever the face is oblique to the view. A frame is only a rotation per line about the earth's axis; nothing is laid out or rasterised. It is drawn by a **second `WebGLRenderer`** onto a canvas of its own at the device's resolution (up to 2x, antialiased: an outlined serif is unreadable in the art-pixel buffer), over the globe's, with the same camera. That scene contains the planet (and now the moon) as **depth-only spheres**, so the planet hides what is behind it and a letter past the horizon curls behind it. Rows enter from behind the planet, roll through the central meridian at 2.9 degrees a second, and leave round the limb; phrase sets take turns.

### The "UNIVERSAL" Easter egg: the same machinery, one bigger row
It is not a separate system. The caption engine gets an extra row, the **egg**: one word in the heavy sans, white with a BSoD-blue outline, on its own shell of radius 2 (well in front of the planet, its ends curving away round the limb), as large as the picture allows. The sequence is a pure function of a seeded plan (`planCinematic`, about 21 s): the rows leave round the orbit, the stage is empty for 0.4 s, the word rises from the planet's shadow, holds and rolls, and goes on round. Meanwhile **the globe pulls back to 62 %** (the renderer subtracts the interlude's value from the zoom it draws with: `drawView()`, so the planet, ring and word shrink together) and **leans 12 degrees** (a `roll` on the drawn view). There is a sound (`cinematic-sound.ts`). It shows to returning visitors, once a session, 12 % of the time, never under reduced motion; or on demand from the palette's hidden "I like surprises".

## 5. The moon (this change)

My first version was a flat 2D disc laid over the globe and moved around an ellipse. That was the wrong thing. It is now an object in the scene:

- **A sphere of radius 1/6 of the earth's** on a circular orbit about its centre, in the **inertial frame** like the stars (so the idle rotation leaves it where it is, and turning the globe shows the same orbit from another side). The orbit's plane is laid once against the camera the page opens with, so from there its near half passes over the planet's north and its far half goes behind (`engine/moon.ts`).
- **Real occlusion, both ways, by the depth buffer**: drawn after the planet's disc (0.4), writing depth, so the planet hides it when it is behind and it hides the coastlines, graticule, sky and stars when it is in front. In the caption canvas it is a depth-only sphere too, so caption letters go behind it; the ring is knocked out where it is in front.
- **The Earth's picture treatment, in the same shader code path**: the Moon's grey map (`moon-grey.png`) read by direction, three tones by the same cuts and the same tone steps (`SURFACE`), half the pixels by the globe's own dither on the buffer's pixel, the page colour as the body, a one-pixel rim in the coastlines' colour (computed in the view-ray's angle, so it is exact off-axis). One face to the planet, as the real one.
- **Clickable by a real link laid over its projection** (`moon-overlay.ts`): keyboard, screen reader, middle click, a card on hover and focus, two taps on touch. It holds the moon still while the card is out. Not a target where the planet hides most of it.
- **Cost**: the moon asks for frames at 10 a second while it may move (the same pace as the idle rotation), none under reduced motion or the energy holds. The camera's near and far planes widen to hold the orbit while it is shown.

What it is not yet: **lit** (the Earth has no light at rest either; a `uSun` and a terminator are the next step, and the interlude already has a sun direction to borrow); at a **real distance** (60 earth radii is behind the camera at this zoom: the orbit is 1.7 radii, the body keeps the 1/6 ratio, so it is large when in front and small behind, a strong perspective); **under the markers and labels** (those are a 2D overlay, so a label drawn at a world view with the labels on is painted over a moon in front of it; at the home screen's resting view they are out).

## 6. What is not 3D, and what is true in 3D but looks flat

- **Not 3D**: the ring, the markers and boxes and their labels (placed from the camera by `projectLonLat`, the pixel overlay), the street map, the hero.
- **3D, drawn flat on purpose**: the planet's lines (one-pixel line segments on the sphere, drawn without lighting), the land (a shader reading a picture by direction, no geometry).
- **The caption is 3D but cannot be seen from the side**: it lives on a shell, and the camera is always on the planet's axis at the home screen.

## 7. Where to start reading

`engine/renderer.ts` (`syncCamera`, `renderNow`), `engine/scene.ts` (the layers and their orders), `engine/materials.ts` (all the GLSL but the sky's and the caption's), `engine/sky-layer.ts`, `engine/caption-layer.ts`, `engine/ring-layer.ts`, `engine/cinematic.ts`, `handover/controller.ts`, `engine/moon.ts`, `engine/moon-layer.ts`.
