# The dark theme's glass and rods: how it got to the current look

The dark picture is **clear glass with neon gas inside**. The glass adds nothing of its own: where no light comes through it is as dark as the page, and all the colour comes from the rods (the gas). Everything below is in `src/graph.ts` unless it says otherwise. A look at the state of things: `/?hold` (the left half of the picture held off), `/?hold=0.3` (off half at 30 %), hover a block (the others dim to `FOCUS_OFF`).

## What a block is made of

- a **shell**: a `MeshPhysicalMaterial` glass (transmission, roughness 0.04) per layer and tier;
- a **rod** in it (`glowMaterial`, a `MeshBasicMaterial`), the neon gas, lit by the neon's level (0 to 1, one number a block, from `neon.ts`, times the hover's dimming).

## The path (what was tried, and what it taught)

1. **The rod stayed an opaque dark bar when dim.** A gas tube that is off is clear glass. The rod is now translucent by *its own brightness* (not only the neon's on/off level, which is 1 for every block once lit): its colour scaled by its opacity (no dither: a dithered translucency, even averaged over samples, flickers whenever the lights move), opacity `smoothstep(0, 2.5, B)`, and thinner, `mix(0.08, 1, smoothstep(0, 3.5, B))` of its width about its own axis (`aCtr`), where `B` is the rod's brightest channel (baked colour, 0.08 to 6.6 across the 409 rods) times the level. Median rod 0.5, 75 % are under 1.3.
2. **Dimmed (hovered-away) blocks were grey.** The cause was *not* the glass colour. Three things added a grey light to a glass block: (a) the glass's glow (`emissive`) blended toward one cool grey when the level fell, by design, (b) the room's reflections: the glass is mirror-smooth and reflects `RoomEnvironment`, a bright grey room, so every face got a grey sheen, and (c) a small floor of glow and reflection kept when a rod is off. Tinting the sheen only changed its colour.
3. **Wrong turns, so as not to take them again.** Taking the glass's colour toward *white* made it lighter, hence washed out. Taking it toward the *grey of the same lightness* made it grey. Removing all reflections and the clear coat made the glass flat. Colouring the glow of dim glass (to "tint it") made all the blocks look tinted. A whitened glow is a grey glow.
4. **What worked** (the current state):
   - the glass is **plain white, no filter** (`attenuationColor` white, distance 1000: it does not absorb what is seen through it), the shell's vertex colour white;
   - **reflections** kept but faint: `envMapIntensity` × 0.1 of the tier's value, clear coat 0.15, specular white; the room's sheen is no longer visible as grey;
   - **nothing kept when a rod is off**: `OFF_EMISSIVE` 0.0012, `OFF_ENV` 0.004, so an unlit glass is nearly the page's colour;
   - **the blue glass** keeps a faint glow of its own in its colour (`emissiveIntensity` tier × 0.6): that is the slight blue tint; **the green** the same, much fainter (`DARK_GREEN_GLOW`, 0.2 against 0.6), in pure green, never whitened;
   - the glow's colour is the layer's own where there is a light (`offGrey` is for a rod that is right off only, below 35 % of its level) and gets darker faster than the level (`pow(level, 2)`);
   - the **rods give the colour**, so they are saturated: a quiet day's rod has little of the white-cyan lift (`stockRod`: `0.06 + 1.32 t²` for the blue, `0.05 + 0.8 t²` for the green), a busy one still goes white-hot, and in the vertex shader a rod's saturation is boosted `1.3 + 1.8 × (1 − level)` (more as it dims, so a dimmed rod is its gas colour and not a grey).
5. **Hover**: the other blocks dim to `FOCUS_OFF` = 0.34.
6. **A glass in front dims the rods behind it** (`glassShades`, `view.ts`): `GLASS_ABSORB` 0.45, `GLASS_FLOOR` 0.3, so that a clump of bright blocks is not one blob.

## The rod is the block's core (geometry)

The rod keeps **the same gap to the glass all round**: `gap = (0.92 − rodWidth) / 2` at the sides, and the same above and below, so its height is `h − 2 × gap` (never under 0.1; if the block is too short for the full gap the gap shrinks to what fits). A tall block has a column; at `h = rodWidth + 2 × gap` it is a **cube**; a shorter block has a **flat core**, still with as much glass as possible above and below. (The light theme keeps its rod at 80 % of the block.) The brightness is shown mostly by **opacity** (`smoothstep(0, 3, B)`) and only a little by **width** (`mix(0.6, 1, smoothstep(0, 2.5, B))`, it was 8 % to 100 %).

## Knobs

| What | Where | Now |
| --- | --- | --- |
| Rod opacity / thickness ranges | rod shader, `smoothstep(0, 2.5, rodB)` / `mix(0.08, 1, smoothstep(0, 3.5, rodB))` | as said |
| Rod saturation | rod shader `1.3 + 1.8 * (1 - level)` | |
| Reflections | `envMapIntensity` × 0.1, `clearcoat` 0.15 | |
| Glass glow, blue / green | `emissiveIntensity` tier × 0.6 / `DARK_GREEN_GLOW` | 0.6 / 0.2 |
| What an off rod keeps | `OFF_EMISSIVE`, `OFF_ENV` | 0.0012, 0.004 |
| Hover dimming | `FOCUS_OFF` | 0.34 |

## Method

Judge it on screenshots, not by reasoning: the demo at `/` with a block hovered (dimmed neighbours are where grey shows), and `/?hold` for the off state. Zoom with a CSS `transform: scale(3)` on `#graph` for a close look.

## Noise and cost (what we learned)

- **No stochastic translucency.** `alphaHash` and our own per-sample dither both looked right once settled but flickered whenever the lights moved (few samples). The rod's translucency is now its colour scaled by its opacity: noise-free, and against a dark glass the look is the same.
- **Light updates are one sample, averaged** (`ema` in `graph.ts`): the camera is still, so the last picture is a start for the next; the new sample weighs at least 30 %. A fifth of the cost of 5 samples drawn from nothing, and no restart from a single noisy sample.
- **Frosted glass**: `DARK_GLASS_ROUGHNESS` back to the clear 0.04 (frosting, 0.22 and 0.08, did not solve what it was meant for and made the edges, which refract more, differ from the faces): the glass's transmission is a blurred mip of the picture seen through it, so the glow of the rods spreads a little in the glass. It costs next to nothing.

## Glass with lamps behind it

Glass with lamps **behind** it, as the camera sees it, glows with their light and is not pitch black; glass against the dark does not (it stays clear and dark, so an isolated block or one at the picture's edge is not milky). The camera never moves, so `lightBehind` (`view.ts`) works it out once: for each block, the brightness of the blocks farther from the camera whose outline it covers, times the share of its own outline they fill. The glow is `1 - e^-(light behind / BEHIND_SCALE)` (1.6): it **saturates**, so a stack of bright blocks does not add up to a blob; a block whose **own rod is bright** gets none (`smoothstep(0.5, 2, brightness)` takes it away); the glow is in the colour of the neighbours' light (`aInc`), times the neighbours' current level, times `NEIGHBOUR_GLOW` (0.22), and capped at 0.1 in the shader. Tries that did not work: a flat glow everywhere (opaque, washed out), then a gate on neighbour density (it lit the edge blocks with a bright neighbour on one side only).

## Green over bright blue

A quiet green block on a bright blue one was lit mostly by the blue light and did not read green. Two physical fixes, not a cheat on the colour: (1) the **least a green rod gives out** is raised (`GREEN_MIN_LEVEL` 1.1: a quiet green day still has a lamp of its own), and (2) **the light that comes from the neighbours is tinted by the block's own colour** as it passes the gas (`GLOW_TINT` 0.75: `aInc` is multiplied by the block's colour normalised to its brightest channel, so a green block lit by a white or blue one is lit green).

The tint is **weighted by the glow's own brightness** (shader, `aTint` + `GLOW_TINT_FAINT` 0.15): the bright part of the light is tinted in full (`GLOW_TINT` 1), the faint part (the shadows) only 15 %, smoothly between 0.02 and 0.1 of glow.

The tint on the *glow* alone was not enough: the bright light that actually gets through a green glass is the rods behind it, seen through clear glass. So the green glass now **filters** what goes through it (the GitHub layer's own palette colour (`shellHue`, so it follows any palette), `LAYER_FILTER_DISTANCE` 1.2, weaker the less saturated the colour, none for white or grey, Beer-Lambert: it multiplies, so bright light turns green and the dark parts stay dark). Blue glass stays clear.

`lightBehind` measures the overlap with the blocks' **real outlines** (convex hull of the 8 projected corners, 7×7 sample points), not their bounding rectangles: a rectangle counted the neighbours beside a block, and the blocks at the top edge, against the black, got a grey glow.

The filter is **not pure**: its colour is the layer colour taken 60 % of the way from white (`LAYER_FILTER_PURITY`), distance 2. A pure red filter (Technicolor pink) stopped cyan light dead; now some of it goes through, tinted.

**Dimmed blocks went milky** (hover): `FOCUS_OFF` 0.34 is just under the 0.35 at which the shader treated a rod as "right off" and swapped the glass glow for the cool grey (`offGrey`), so every dimmed block glowed grey. Found by switching glow, reflections, clear coat, specular and the sun off one by one: with the glow off the dimmed glass was clear and dark. `offGrey` now only applies below 0.12.

**Milk of the wrong colour**: the neighbours' light (`inc`) is the *sum* of their colours, so red and cyan neighbours add up to grey. In the shader the glow is now pushed back from grey to its colour (`GLOW_SATURATION` 2.5, about its luminance) and the faint part takes 35 % of the block's own tint (`GLOW_TINT_FAINT`).

**No milk while everything is dimmed** (hover): the neighbours' glow follows the cube of the neighbours' level (`lv.g³`), so at the hover's dimming (0.34) it is down to 4 % and the dimmed blocks are plain glass; at full level it is unchanged.

## The empty days are pits

An empty day is a soft square **pit** dug in the ground (`graph.ts`, `tileShape`): a rounded-square extrusion sunk 0.07 below the ground with a rounded lip, drawn from inside (back faces): the walls are a little lighter than the page near the rim, the floor darker, and the baked glow of the neighbours lies over it, so it reflects their light. A thin ring round the opening takes a **soft highlight on the left edge, and a hint on the lower one**: the light is the scene's own sun, from the top right on the screen, and the lip of a pit catches it where its slope faces the top right (the left edge in full; the lower edge is turned away from the camera, so only a hint). Not a real lighting calculation: a vertex colour. The place-holder (`placeholder.ts`) draws the same squares as darker-than-the-page pits with a hairline rim.

### Pits, second pass
- **They really are below the ground now.** The (invisible) ground plane wrote depth at y 0.06 and hid everything sunk under it; it no longer writes depth (`depthWrite: false`), so the pit's walls and floor are drawn.
- **Recess**: the glow that lies over the ground would light a pit's floor like the ground, a flat plate. Each pit gets an inner shadow in the contact-shadow layer (`recess`, on the side that faces the light: the lamps around the pit in the dark theme (their strength and direction, summed; none if they surround it), the sun from the top right in the light theme. The lit wall is the opposite one, where the lip's highlight is, so shadow, wall and lip agree), so the floor reads as lower.
- **The lip's highlight** in the dark theme is no longer a fixed direction: there is no sun at night, the light is the neon's, so each lip edge is lit by the lamps on its opposite side, in their colour, falling off with distance (computed once, after all the blocks are known). In the light theme the highlight is the sun's, from the top right: the left edge, a hint on the lower one.
- **No hover light**: a looked-at empty day does not light up (tried, taken out).
- The hover outline of an empty day is the pit's own rounded square, flat on the ground.

## Light theme: clear glass, a soft core, coloured shadows

- The glass is perfectly clear (roughness 0.04, its tint mixed 40 % toward white: `LIGHT_SHELL_WHITE`) with faint reflections (`LIGHT_ENV` 0.3, `LIGHT_COAT` 0.1, `LIGHT_SPECULAR` 0.35) so the refraction and the caustics are what is seen.
- The core is an unlit, slightly lifted lamp, narrower (0.38), whose colour fades toward a pale haze at its silhouette (`coreMaterial.onBeforeCompile`, haze 0.5, deepened by `LIGHT_CORE_DEPTH` 0.78): a blurred glow in the middle, with the glass around it untouched.
- Shadows follow the glass's colour: stronger absorption (`ABSORB` 2.6, `STRAIGHT` 0.92), deeper shade (`SHADOW` 0.72) pushed away from grey (`SHADE_SATURATION` 2.4), stronger caustics (`GLEAM` 3.4), and the contact shadow of a column is tinted by its layers' colours (`LIGHT_SHADOW_DEPTH`).
- The title's CRT scan in the light page is paper-coloured, so it only thins the ink and is invisible on the paper (no strike-through look).

(Tried and removed: shading light-theme glass by the blocks behind it. It only made blocks darker for no reason.)
