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

## Glass inside a dense group of lamps

Glass inside a crowd of lit blocks should not be pitch dark, but a block at the edge of the picture, with light on one side only, must stay clear. The glass gets a **glow from the light of its neighbours** (`aInc`, the neighbours' colour and brightness already worked out for the rods, times the neighbours' current level), scaled by `NEIGHBOUR_GLOW` (0.16) and by a **density gate** (`smoothstep(0.3, 0.8, neighbour light)`): none at the edge, full inside a group. A flat glow everywhere (first try, 0.35, no gate) made the glass look opaque and washed out.
