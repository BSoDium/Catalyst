/**
 * ShaderMaterials for the 1-bit look. All of them write raw sRGB (no lighting, no tone mapping), see the
 * `ColorManagement` note in renderer.ts. Visibility of borders is ordered-dither coverage, not alpha, so the
 * output never contains a blended pixel.
 */
import { AddEquation, BackSide, Color, CustomBlending, DstColorFactor, FrontSide, NormalBlending, ShaderMaterial, ZeroFactor } from "three";
import { CELL_PATTERN, LEG_MODES, MODE_STYLE } from "../paths/modes";
import { STRAIGHT_FADE_MIX, STRAIGHT_FADE_STEPS } from "../paths/thin";
import { SPARK, TRAIL_BANDS, TRAIL_ENTRIES, TRAIL_PER_PALETTE } from "../paths/trail";
import { RIM, SUN } from "./moon";
import { WARM_GLSL } from "./sun-flare";
import { NIGHT, NIGHT_GLSL, SURFACE } from "./surface";

/** The lines' vertex shader: the ground point (the scene is in the earth's frame, a line's vertices are on the unit sphere) goes to the fragment. */
const LIT_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** The globe disc is a hair inside the lines (radius 1) so lines on the near side never z-fight with it. */
export const OCCLUDER_RADIUS = 0.998;

export const DITHER_GLSL = /* glsl */ `
  float dither2(vec2 a) { return fract(a.x * 0.5 + a.y * a.y * 0.75); }
  float dither4(vec2 a) { return dither2(0.5 * a) * 0.25 + dither2(a); }
  // Discard fragments so that roughly \`coverage\` of pixels survive (ordered dither, stays 1-bit).
  void ditherDiscard(float coverage) { if (dither4(floor(gl_FragCoord.xy)) >= coverage) discard; }
`;

export function lineMaterial(coverage: number, stipple = 0): ShaderMaterial {
  return new ShaderMaterial({
    // `uAlt` / `uAltAmt`: the colour the line is taken towards (the borders, over the land the interlude fills, are the page's colour: the fill is the ink's)
    uniforms: { uColor: { value: new Color() }, uCoverage: { value: coverage }, uStipple: { value: stipple }, uAlt: { value: new Color() }, uAltAmt: { value: 0 }, uSunN: { value: [0, 0, 1] }, uNight: { value: 0 }, uFlip: { value: 0 }, uNightTo: { value: new Color() } },
    vertexShader: LIT_VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uCoverage; uniform float uStipple; uniform vec3 uAlt; uniform float uAltAmt; uniform vec3 uSunN; uniform float uNight; uniform float uFlip; uniform vec3 uNightTo;
      varying vec3 vDir;
      ${DITHER_GLSL}
      ${NIGHT_GLSL}
      void main() {
        ditherDiscard(uCoverage);
        // the night: the colour goes towards the page's in whole steps (a flat grey per step)
        float dark = floor(washOf(normalize(vDir), uSunN, uNight, uFlip) * ${NIGHT.lineSteps.toFixed(1)} + 0.5) / ${NIGHT.lineSteps.toFixed(1)};
        if (uStipple > 0.0 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), uStipple) > 0.5) discard;
        gl_FragColor = vec4(mix(mix(uColor, uAlt, uAltAmt), uNightTo, dark * mix(${NIGHT.lineDim.toFixed(2)}, ${NIGHT.lineDimLight.toFixed(2)}, uFlip)), 1.0);
      }
    `,
  });
}

/** The globe disc: writes the page colour and depth, so everything behind it is hidden and the ocean is invisible. */
export function occluderMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    // The disc is the page's colour (the sea), and, for the cinematic interlude, a 1-bit picture of a planet lit by one sun (`uSun`, the direction towards it in
    // the earth's frame; the letters of the word are lit from the same side):
    //  - the LAND (`uLandMap`, engine/land.ts, equirectangular, 255 on land; looked up by the direction of the fragment, the scene being in the earth's frame)
    //    is `uFill` (the ink) in an ordered dither whose density follows the light: solid on the day side, falling across the terminator to a fifth at night,
    //    so the continents stay legible in the dark;
    //  - the SEA near the limb on the lit side has a thin dithered glow (the atmosphere), in the same ink, thinning to nothing.
    // The dither is the one the lines use (`dither4` on the buffer's own pixels, which are the art's). `uLand` is how much of all this is there (0: none, the
    // globe as it always was).
    uniforms: { uColor: { value: new Color() }, uFill: { value: new Color() }, uLand: { value: 0 }, uLandMap: { value: null }, uSun: { value: [0, 0, 1] }, uNight: { value: 0 }, uSunN: { value: [0, 0, 1] }, uFlip: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uFill; uniform float uLand; uniform sampler2D uLandMap; uniform vec3 uSun;
      uniform float uNight; uniform vec3 uSunN; uniform float uFlip;
      varying vec3 vDir;
      ${DITHER_GLSL}
      ${NIGHT_GLSL}
      bool lit(float coverage) { return dither4(floor(gl_FragCoord.xy)) < coverage; }
      void main() {
        vec3 col = uColor;
        // the light page's shadow: the sea on the night side is darkened in flat steps, and the step between two is the art's ordered dither (a stipple across the terminator, as the land has)
        float sv = clamp(washOf(normalize(vDir), uSunN, uNight, uFlip), 0.0, 1.0) * ${NIGHT.lineSteps.toFixed(1)};
        float shadow = (floor(sv) + (fract(sv) > dither4(floor(gl_FragCoord.xy)) ? 1.0 : 0.0)) / ${NIGHT.lineSteps.toFixed(1)};
        col *= 1.0 - ${NIGHT.shadow.toFixed(2)} * uFlip * shadow;
        if (uLand > 0.001) {
          vec3 n = normalize(vDir);
          float d = dot(n, uSun);
          vec2 uv = vec2(atan(n.x, n.z) * 0.15915494 + 0.5, asin(clamp(n.y, -1.0, 1.0)) * 0.31830989 + 0.5);
          float land = smoothstep(0.42, 0.58, texture2D(uLandMap, uv).r);
          // the light: solid above 0.10, down to a fifth below -0.20
          float day = mix(0.2, 1.0, smoothstep(-0.20, 0.10, d));
          float ink = land > 0.5 ? day : 0.0;
          // the atmosphere: the sea within a few degrees of the limb, on the lit side, in a dither that thins outwards (0.45 at the limb)
          float towardsEye = clamp(dot(n, normalize(cameraPosition - vDir)), 0.0, 1.0);
          float rim = smoothstep(0.34, 0.0, towardsEye) * smoothstep(-0.1, 0.45, d) * 0.45;
          ink = max(ink, land > 0.5 ? 0.0 : rim);
          if (lit(ink * uLand)) col = uFill;
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/**
 * The MIST of the cinematic interlude: a haze that lies on the planet, thickest at the horizon and thinning smoothly upward, in GREY pixels (not the ink's black and
 * white: its colour is a step from the page's towards its ink, at a low alpha) on the art's own pixels. The haze's density is quantised to a few levels, each a flat grey, and
 * the steps between them are the lines' ordered dither: a pixelated gradient, not a smooth one. Three layers, one material each:
 *  - `atmosphereMaterial`: ABOVE the limb. The inside of a shell a little over the surface (a fixed height: it is a layer of the planet, so it shrinks with it), so it is seen
 *    only beyond the disc (the disc's depth hides its far side across the middle). Its density is 1 at the planet's own edge and falls to 0 at the shell's top (`uPower`: the
 *    shape of the fall), a little thicker on the sunward side. `uCover` is its alpha at the edge, `uAmt` (0..1) how much of it is there.
 *  - `mistMaterial`: ON the planet. A shell a hair over the surface (the lines are drawn at the surface), whose density grows towards the horizon: where the ground is seen
 *    at a grazing angle the mist is deep and veils the coastlines and the borders, and it BLEEDS inwards, a good part of the way to the middle, as the glow's own continuation.
 *  (and `surfaceMaterial`, below: the land's own picture, which is there outside the interlude too, fainter, and fades with the zoom)
 * None of them is drawn at all outside the interlude (`GlobeScene.setAtmosphere`).
 */
const MIST_GLSL = /* glsl */ `
  float dither2(vec2 a) { return fract(a.x * 0.5 + a.y * a.y * 0.75); }
  float dither4(vec2 a) { return dither2(0.5 * a) * 0.25 + dither2(a); }
  // n (0..1) in "levels" flat steps, the step between two taken by the ordered dither on the art's pixels
  float stepped(float n, float levels) {
    float v = clamp(n, 0.0, 1.0) * levels;
    return (floor(v) + (fract(v) > dither4(floor(gl_FragCoord.xy)) ? 1.0 : 0.0)) / levels;
  }
`;

export function atmosphereMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color() }, uAmt: { value: 0 }, uSun: { value: [0, 0, 1] }, uShell: { value: 1.03 }, uPower: { value: 1.6 }, uCover: { value: 0.5 }, uNight: { value: 0 }, uSunN: { value: [0, 0, 1] }, uFlip: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAmt; uniform float uShell; uniform float uPower; uniform float uCover;
      uniform float uNight; uniform vec3 uSunN; uniform float uFlip;
      varying vec3 vPos;
      ${MIST_GLSL}
      ${NIGHT_GLSL}
      void main() {
        // (the shell is the unit sphere scaled to uShell: the vertex is in the unit sphere's frame, so its direction is its position)
        vec3 n = normalize(vPos);
        vec3 toEye = normalize(cameraPosition - n * uShell);
        // on the far side of the shell the outward normal turns away from the eye: |n . eye| is 0 at the shell's outer edge and reaches "edge" where the sight line
        // just grazes the planet; normalised by that, the height above the limb is 1 - h (1 at the planet's edge, 0 at the top of the shell)
        float edge = sqrt(max(1.0 - 1.0 / (uShell * uShell), 1e-4));
        float h = clamp(abs(dot(n, toEye)) / edge, 0.0, 1.0);
        // lit as the ground under it is: the same terminator (washOf), in the same whole steps as the lines', so that the glow is the ground's own light and nothing
        // else: dark where the ground is dark, brighter only towards the limb (h)
        float lit = 1.0 - floor(washOf(n, uSunN, uNight, uFlip) * ${NIGHT.lineSteps.toFixed(1)} + 0.5) / ${NIGHT.lineSteps.toFixed(1)} * ${NIGHT.atmosphereDim.toFixed(2)};
        float a = stepped(pow(h, uPower) * uAmt * lit, 3.0) * uCover;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    side: BackSide,
    blending: NormalBlending,
    depthTest: true,
    depthWrite: false,
    transparent: true,
  });
}

/**
 * What the rim's two layers (the atmosphere's lining and the light on the ground) know of the sun: `rimAligned()` is how near the sun is to the limb on the picture (1 on it, 0 beyond `RIM.align` of the planet's angular
 * radius, or in front of the planet), and `rimSide(n)` the cosine, for the limb point `n`, of the angle to the sun's side of the outline. `uSunN` is the sun's direction in the earth's frame.
 */
const RIM_SUN_GLSL = /* glsl */ `
  // how far the sun's centre is outside the limb on the picture, radians (negative: behind it), and the width of the alignment
  float rimAbove() {
    vec3 axis = normalize(-cameraPosition);
    return acos(clamp(dot(uSunN, axis), -1.0, 1.0)) - asin(clamp(1.0 / length(cameraPosition), 0.0, 1.0));
  }
  float rimWidth() { return ${RIM.align.toFixed(2)} * asin(clamp(1.0 / length(cameraPosition), 0.0, 1.0)); }
  float rimAligned() { return 1.0 - smoothstep(0.0, rimWidth(), abs(rimAbove())); }
  // the same, for the GROUND: only while the sun is above the horizon (outside the limb), whole a little way out and zero where its centre is on the limb, so a set sun lights none of the surface
  float rimLit() {
    float w = rimWidth();
    float above = rimAbove();
    return smoothstep(0.0, ${RIM.ground.peak.toFixed(2)} * w, above) * (1.0 - smoothstep(${RIM.ground.peak.toFixed(2)} * w, w, above));
  }
  float rimSide(vec3 n) {
    vec3 axis = normalize(-cameraPosition);
    vec3 perp = uSunN - axis * dot(uSunN, axis);
    float pl = length(perp);
    return pl > 1e-4 ? dot(n, perp / pl) : -1.0;
  }
  // the sun's own light along the limb: its pale gold nearest the sun (side 1), through yellow and orange to red and violet away from it
  vec3 rimTint(float side, float from, float flip) {
    vec3 w = warm(mix(0.05, 1.0, pow(smoothstep(from, 0.995, side), 0.8)));
    // (the light page: the lining is as WHITE as the sun, with only a hint of the ramp in it; what shows it is the grey veil behind it, which it is drawn over)
    return flip > 0.5 ? mix(vec3(${SUN.light.lining.grey.toFixed(3)}), w, ${SUN.light.lining.warm.toFixed(3)}) : w;
  }
`;

/**
 * The RIM (`RIM`, engine/moon.ts): the atmosphere as a thin skin on the limb, a smooth film of haze, and the SILVER LINING where the sun is aligned with the limb. The same shell as the interlude's glow (the
 * inside of a sphere a little over the surface, seen only beyond the disc). `uNight` is the night's amount (the rim is there while the sun is), `uAmt` how much of it the interlude's own glow leaves.
 */
export function rimMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color() }, uSet: { value: 0 }, uAmt: { value: 1 }, uShell: { value: 1 + RIM.shell }, uCover: { value: RIM.cover.dark }, uNight: { value: 0 }, uSunN: { value: [0, 0, 1] }, uFlip: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAmt; uniform float uShell; uniform float uCover;
      uniform float uNight; uniform vec3 uSunN; uniform float uFlip;
      varying vec3 vPos;
      ${MIST_GLSL}
      ${WARM_GLSL}
      ${RIM_SUN_GLSL}
      void main() {
        vec3 n = normalize(vPos);
        vec3 toEye = normalize(cameraPosition - n * uShell);
        // the height over the limb, as the glow's: 1 at the planet's edge, 0 at the shell's top
        float edge = sqrt(max(1.0 - 1.0 / (uShell * uShell), 1e-4));
        float h = clamp(abs(dot(n, toEye)) / edge, 0.0, 1.0);
        // the haze: smooth and faint, on the lit limb
        float haze = pow(h, ${RIM.hazePower.toFixed(2)}) * ${RIM.haze.toFixed(3)} * smoothstep(-0.2, 0.6, dot(n, uSunN)) * uNight * uAmt;
        // the silver lining: the sun aligned with the limb, on the limb point nearest its projection. Its strength rises in density (the dither) AND in opacity: the pixels the dither leaves out keep a share of it
        float side = rimSide(n);
        float v = pow(h, ${RIM.thick.toFixed(2)}) * rimAligned() * smoothstep(${RIM.arc[0].toFixed(2)}, ${RIM.arc[1].toFixed(2)}, side) * uNight * uAmt;
        float on = v > dither4(floor(gl_FragCoord.xy)) ? 1.0 : 0.0;
        float lin = v * mix(${RIM.grain.toFixed(2)}, 1.0, on) * uCover;
        if (haze < 0.003 && lin < 0.004) discard;
        gl_FragColor = lin > haze ? vec4(rimTint(side, ${RIM.arc[0].toFixed(2)}, uFlip), lin) : vec4(uColor, haze);
      }
    `,
    side: BackSide,
    blending: NormalBlending,
    depthTest: true,
    depthWrite: false,
    transparent: true,
  });
}

/**
 * The sunset's light on the GROUND (`RIM.ground`): the other half of the picture the footage shows. A skin a hair over the surface (like the mist's), warm where the ground is seen at a grazing angle on the sun's side
 * of the limb, brightest at the planet's edge and dimming inward, in the dark side's own dithered levels: while the sun is just above the limb it lights the surface as well as the atmosphere, the surface goes dim before the edge does, and it is dark once the sun has set (`rimLit`).
 */
export function rimGroundMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color() }, uSet: { value: 0 }, uAmt: { value: 1 }, uNight: { value: 0 }, uSunN: { value: [0, 0, 1] }, uFlip: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAmt; uniform float uNight; uniform vec3 uSunN; uniform float uFlip;
      varying vec3 vPos;
      ${MIST_GLSL}
      ${WARM_GLSL}
      ${RIM_SUN_GLSL}
      void main() {
        vec3 n = normalize(vPos);
        vec3 toEye = normalize(cameraPosition - vPos);
        // how grazing the ground is seen: 0 looking straight down, 1 at the horizon
        float g = 1.0 - clamp(dot(n, toEye), 0.0, 1.0);
        float side = rimSide(n);
        // in flat levels, ordered-dithered into each other on the art's pixels, as the planet's dark side is
        float v = pow(g, ${RIM.ground.power.toFixed(2)}) * rimLit() * smoothstep(${RIM.ground.arc[0].toFixed(2)}, ${RIM.ground.arc[1].toFixed(2)}, side) * uNight * uAmt;
        float a = stepped(v, ${RIM.ground.steps.toFixed(1)}) * ${RIM.ground.alpha.toFixed(2)} * mix(1.0, ${RIM.ground.light.toFixed(2)}, uFlip);
        if (a < 0.004) discard;
        gl_FragColor = vec4(rimTint(side, ${RIM.ground.arc[0].toFixed(2)}, uFlip), a);
      }
    `,
    side: FrontSide,
    blending: NormalBlending,
    depthTest: true,
    depthWrite: false,
    transparent: true,
  });
}

/**
 * The TWILIGHT (`RIM.twilight`): a faint red band on the ground either side of the lit side's halfway edge, where the atmosphere has scattered the sun's light a little past the terminator and the light is redder for the air it
 * has been through. It only TINTS what is under it: it MULTIPLIES the colours there (a black ocean stays black), in dithered levels on the art's pixels (the dark side's own texture), on a skin a hair over the surface (the mist's).
 */
export function twilightMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uAmt: { value: 1 }, uNight: { value: 0 }, uSunN: { value: [0, 0, 1] }, uFlip: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAmt; uniform float uNight; uniform vec3 uSunN; uniform float uFlip;
      varying vec3 vPos;
      ${MIST_GLSL}
      void main() {
        float d = dot(normalize(vPos), uSunN);
        float band = smoothstep(${RIM.twilight.band[0].toFixed(2)}, ${RIM.twilight.band[1].toFixed(2)}, d) * (1.0 - smoothstep(${RIM.twilight.band[2].toFixed(2)}, ${RIM.twilight.band[3].toFixed(2)}, d));
        float k = stepped(band * uNight * uAmt, ${RIM.twilight.steps.toFixed(1)}) * ${RIM.twilight.strength.toFixed(2)} * mix(1.0, ${SUN.light.twilight.toFixed(2)}, uFlip);
        if (k < 0.004) discard;
        // the colour under it times this: white (nothing) to the tint
        gl_FragColor = vec4(mix(vec3(1.0), vec3(${RIM.twilight.rgb.map((x) => x.toFixed(3)).join(", ")}), k), 1.0);
      }
    `,
    side: FrontSide,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: DstColorFactor,
    blendDst: ZeroFactor,
    depthTest: true,
    depthWrite: false,
    transparent: true,
  });
}

export function mistMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color() }, uAmt: { value: 0 }, uCover: { value: 0.85 }, uNight: { value: 0 }, uSunN: { value: [0, 0, 1] }, uFlip: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAmt; uniform float uCover;
      uniform float uNight; uniform vec3 uSunN; uniform float uFlip;
      varying vec3 vPos;
      ${MIST_GLSL}
      ${NIGHT_GLSL}
      void main() {
        vec3 n = normalize(vPos);
        vec3 toEye = normalize(cameraPosition - vPos);
        // how grazing the ground is seen: 0 looking straight down, 1 at the horizon. The haze begins well in (about a fifth of the way in from the limb, a third of the
        // way round) and is deepest at the edge, where it meets the glow above it: the glow bleeds onto the planet
        float g = 1.0 - clamp(dot(n, toEye), 0.0, 1.0);
        float deep = smoothstep(0.18, 1.0, g);
        float lit = 1.0 - floor(washOf(n, uSunN, uNight, uFlip) * ${NIGHT.lineSteps.toFixed(1)} + 0.5) / ${NIGHT.lineSteps.toFixed(1)} * ${NIGHT.atmosphereDim.toFixed(2)};
        float a = stepped(deep * deep * (3.0 - 2.0 * deep) * uAmt * lit, 3.0) * uCover;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    side: FrontSide,
    blending: NormalBlending,
    depthTest: true,
    depthWrite: false,
    transparent: true,
  });
}

/**
 * The SURFACE: the planet's own picture, a satellite view of the land (NASA's Blue Marble, public domain, smoothed) as FLAT PATCHES in a palette of a few colours, 8-bit
 * style: the sea is the page's colour, and the land is one of three tones, by how bright the ground is (`uEarth`: the picture's brightness, looked up by the fragment's
 * direction, the scene being in the earth's frame so that the patches turn with the planet, with NEAREST sampling at 1024 x 512, so that the patches have square, pixel-art
 * edges, crisp however near the camera comes). `uTone0..2` are the tones (darkest ground first; each a step from the page's colour towards its ink), `uBg` the page's colour,
 * `uStrength` (0..1) how far the tones are taken from `uBg`. The colours are SOLID (no blending): the layer is drawn UNDER the lines, which are drawn over it. `uAmt` (0..1: the
 * scene fades it with the zoom, `engine/surface.ts`) takes pixels out of the patches in the lines' ordered dither, the page's way of a fade.
 */
export function surfaceMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uBg: { value: new Color() },
      uTone0: { value: new Color() },
      uTone1: { value: new Color() },
      uTone2: { value: new Color() },
      uStrength: { value: 1 },
      uAmt: { value: 0 },
      uEarth: { value: null },
      uLandMap: { value: null },
      uSunN: { value: [0, 0, 1] },
      uNight: { value: 0 },
      uFlip: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBg; uniform vec3 uTone0; uniform vec3 uTone1; uniform vec3 uTone2; uniform float uStrength; uniform float uAmt; uniform sampler2D uEarth; uniform sampler2D uLandMap;
      uniform vec3 uSunN; uniform float uNight; uniform float uFlip;
      varying vec3 vDir;
      ${DITHER_GLSL}
      ${NIGHT_GLSL}
      void main() {
        vec3 n = normalize(vDir);
        vec2 uv = vec2(atan(n.x, n.z) * 0.15915494 + 0.5, asin(clamp(n.y, -1.0, 1.0)) * 0.31830989 + 0.5);
        // the land is the coastlines' own fill (the land mask, filtered and cut at a half: its edge falls between the texels, exactly on the drawn outline, at the art's resolution)
        if (texture2D(uLandMap, uv).r < 0.5) discard;
        float v = texture2D(uEarth, uv).r;
        // the night: the stipple thins and the ground steps to its lightest tone, with the light (engine/surface.ts, NIGHT)
        float w = washOf(n, uSunN, uNight, uFlip);
        // (dark page: the stipple thins and the ground steps to its lightest tone; light page, uFlip: it thickens and steps to its darkest)
        ditherDiscard(uAmt * mix(1.0, mix(${NIGHT.landMin.toFixed(2)}, ${NIGHT.landMax.toFixed(2)}, uFlip), w));
        v += w * ${NIGHT.shift.toFixed(2)} * (1.0 - 2.0 * uFlip);
        // the land is dark, middle or light ground (thresholds on the picture's brightness, which the picture lifts to 0.2 and over)
        vec3 tone = v < ${SURFACE.cuts[0].toFixed(2)} ? uTone0 : (v < ${SURFACE.cuts[1].toFixed(2)} ? uTone1 : uTone2);
        // the light page's shadow: the ground on the night side is darkened with the sea, in the same flat steps and the same dither between them
        float sv = clamp(w, 0.0, 1.0) * ${NIGHT.lineSteps.toFixed(1)};
        float shade = 1.0 - ${NIGHT.shadow.toFixed(2)} * uFlip * (floor(sv) + (fract(sv) > dither4(floor(gl_FragCoord.xy)) ? 1.0 : 0.0)) / ${NIGHT.lineSteps.toFixed(1)};
        gl_FragColor = vec4(mix(uBg, tone, uStrength) * shade, 1.0);
      }
    `,
    side: FrontSide,
    depthTest: true,
    depthWrite: false,
  });
}

/**
 * The lights of the places (the studio's frame has the cities' lights on the night side): a dot for each of the owner's places, 3 by 3 art pixels on the
 * night side and 2 by 2 on the day side, in the accent, coming up through the dither as `uCity` goes from 0 to 1. On the sphere a hair above the land, hidden
 * behind the planet by the depth buffer (the disc writes it).
 */
export function cityMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color() }, uCity: { value: 0 }, uSun: { value: [0, 0, 1] } },
    vertexShader: /* glsl */ `
      uniform vec3 uSun;
      void main() {
        gl_PointSize = dot(normalize(position), uSun) < 0.0 ? 3.0 : 2.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uCity;
      ${DITHER_GLSL}
      void main() {
        if (dither4(floor(gl_FragCoord.xy)) >= uCity) discard;
        gl_FragColor = vec4(uColor, 1.0);
      }
    `,
    depthTest: true,
    depthWrite: false,
  });
}

/**
 * Paths: every leg of every route, in one draw call (instanced: three copies of each segment, the second and third for rail's
 * cross-ticks and for the spark at a leg's head). PLANE TRAILS (paths/trail.ts): each leg is coloured by its route's palette, from a
 * pale tail at the origin to a saturated head at the destination in `TRAIL_BANDS` solid bands, the legs of the selected place are
 * the lit head colour along their whole length up to the draw-on front, and every head carries a bright spark. All colours are SOLID
 * entries of one list (`uTrail`, per theme: no alpha, no blend); the only mix is toward the page colour while a short leg fades in
 * (a level of the same staircase as the borders' fade, `paths/lod.ts`). Patterns run along the path in ART PIXELS (a buffer pixel is
 * one: the buffer is the art grid), so they keep their length at any zoom. Mode, leg, length and palette ride in the vertex; the
 * selection is a texel per leg (`uState`): changing it never touches the geometry.
 *
 * Hidden behind the globe by the same analytic test as before (does the ray from the camera to this point enter the occluder
 * sphere first?), NOT by the depth buffer: a line one pixel wide would otherwise z-fight with the disc on a tilted surface, and the
 * test depends only on the position along the line, so a dash is cut across its length or not at all. Depth test and write are off.
 */

/** GLSL chain choosing a number by mode id `m` from the mode table (paths/modes.ts), so shader and style cannot drift. */
function modeChain(pick: (mode: (typeof LEG_MODES)[number]) => number): string {
  const f = (n: number) => n.toFixed(1);
  let out = f(pick(LEG_MODES[LEG_MODES.length - 1]!));
  for (let i = LEG_MODES.length - 2; i >= 0; i--) out = `m < ${f(MODE_STYLE[LEG_MODES[i]!].id + 0.5)} ? ${f(pick(LEG_MODES[i]!))} : ${out}`;
  return out;
}

export function pathMaterial(): ShaderMaterial {
  const f = (n: number) => n.toFixed(1);
  return new ShaderMaterial({
    uniforms: {
      uTrail: { value: Array.from({ length: TRAIL_ENTRIES }, () => new Color()) },
      uPage: { value: new Color() },
      uFinal: { value: 8 },
      uPresence: { value: 1 },
      uFront: { value: 2 },
      uMarch: { value: 0 },
      uCell: { value: 0.01 },
      uDot: { value: 0.01 },
      uPixel: { value: [0.01, 0.01] },
      uLift: { value: 1 },
      uState: { value: null },
      uTexSize: { value: [1, 1] },
      uFar: { value: 0 },
      uTickOn: { value: 1 },
      uFadeFrom: { value: 2 },
      uFadeFull: { value: 14 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aDist; attribute vec4 aInfo; attribute vec3 aTan; attribute float aCopy;
      uniform vec2 uPixel; uniform float uLift; uniform float uCell; uniform sampler2D uState; uniform vec2 uTexSize;
      uniform float uFinal; uniform float uFadeFrom; uniform float uFadeFull;
      varying float vDist; varying float vLen; varying float vMode; varying float vState; varying float vCopy; varying float vFade; varying float vPal; varying float vQuiet;
      varying vec3 vPos;
      void main() {
        float leg = aInfo.x;
        vec2 uv = vec2((mod(leg, uTexSize.x) + 0.5) / uTexSize.x, (floor(leg / uTexSize.x) + 0.5) / uTexSize.y);
        float st = texture2D(uState, uv).r;     // 0 none, ~0.5 starts at the selected place, 1 ends there
        // fade-in: a level that steps up with the leg's length in cells (0 = hidden); the colour mixes toward the page by level / final
        float fd = clamp((aInfo.z / uCell - uFadeFrom) / (uFadeFull - uFadeFrom), 0.0, 1.0);
        float level = fd <= 0.0 ? 0.0 : clamp(ceil(fd * uFinal), 1.0, uFinal);
        vFade = level / uFinal;
        // a straight line quietened up close (paths/thin.ts fadeStraight): the state between hidden and lit, 52 + 4 per step (1..3)
        vQuiet = (st > 0.2 && st < 0.25) ? floor((st * 255.0 - 48.0) / 4.0 + 0.5) : 0.0;
        vDist = aDist; vLen = aInfo.z; vMode = aInfo.y; vPal = aInfo.w; vState = st; vCopy = aCopy;
        // a leg nothing shows is clipped away, and so is one thinned away at this zoom (paths/thin.ts: the state between none and lit)
        if ((level < 0.5 && st < 0.25) || (st > 0.05 && st < 0.2)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        // uLift scales the height above the surface: 1 = lifted arc, 0 = on the ground (street scale).
        vec3 p = normalize(position) * (1.0 + (length(position) - 1.0) * uLift);
        vPos = p;
        vec4 c = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        if (aCopy > 0.5) {
          // across the line by one buffer pixel: along the axis the path is more perpendicular to on screen
          vec4 c1 = projectionMatrix * modelViewMatrix * vec4(p + aTan * 0.0005, 1.0);
          vec2 d = (c1.xy / c1.w - c.xy / c.w) / abs(uPixel);
          vec2 off = abs(d.x) > abs(d.y) ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
          c.xy += (aCopy < 1.5 ? 1.0 : -1.0) * off * uPixel * c.w;
        }
        gl_Position = c;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTrail[${TRAIL_ENTRIES}]; uniform vec3 uPage; uniform float uFinal; uniform float uPresence; uniform float uFront; uniform float uMarch; uniform float uCell; uniform float uDot; uniform float uFar; uniform float uTickOn;
      varying float vDist; varying float vLen; varying float vMode; varying float vState; varying float vCopy; varying float vFade; varying float vPal; varying float vQuiet;
      varying vec3 vPos;
      // True when the occluder sphere lies between the camera and p.
      bool behindGlobe(vec3 p) {
        vec3 v = p - cameraPosition;
        float len = length(v);
        vec3 u = v / len;
        float b = dot(cameraPosition, u);
        float disc = b * b - (dot(cameraPosition, cameraPosition) - ${(OCCLUDER_RADIUS * OCCLUDER_RADIUS).toFixed(6)});
        if (disc <= 0.0) return false;
        float t = -b - sqrt(disc); // first hit
        return t > 0.0 && t < len;
      }
      void main() {
        // How far the pattern runs along the line from one pixel to the next, in dots' cells: 1 for a line along an axis, 1.41 on a diagonal (a line is one
        // pixel per step of its major axis). Taken first: derivatives are only defined while every fragment of the quad is still here.
        vec2 gd = vec2(dFdx(vDist), dFdy(vDist)) / uDot;
        float gm = max(abs(gd.x), abs(gd.y));
        float step1 = gm > 1.0e-6 ? clamp(dot(gd, gd) / gm, 0.5, 4.0) : 1.0;
        bool lit = vState > 0.25;
        float t = vLen > 0.0 ? vDist / vLen : 0.0;
        float frac = t;                          // 0 at the origin, 1 at the destination: the trail's gradient runs this way
        if (vState > 0.75) t = 1.0 - t;         // a leg that ends at the place draws on from the place
        bool inked = lit && t <= uFront;
        if (!inked && vFade < 0.01) discard;
        float cells = vDist / uDot - (lit ? uMarch : 0.0);
        // mode ids (paths/modes.ts): 0 road, 1 rail, 2 ferry, 3 flight, 4 walk, 5 unknown
        float m = floor(vMode + 0.5);
        // the pattern of the street map's cells (a dot is one pixel): paths/modes.ts CELL_PATTERN, so the two renderers draw the same
        float period = ${modeChain((k) => CELL_PATTERN[k]?.period ?? 0)};
        float on = ${modeChain((k) => CELL_PATTERN[k]?.on ?? 0)};
        // the head's spark: cells back from the destination (paths/trail.ts SPARK); the draw-on has not reached a lit head yet when t < 1
        float h = (vLen - vDist) / uCell - (inked ? ${f(SPARK.lit.clear)} : ${f(SPARK.faint.clear)});   // 0 where the spark begins, outside the place's box
        float sparkLine = inked ? ${f(SPARK.lit.line)} : ${f(SPARK.faint.line)};
        float crossFrom = inked ? ${f(SPARK.lit.crossFrom)} : ${f(SPARK.faint.crossFrom)};
        float crossTo = inked ? ${f(SPARK.lit.crossTo)} : ${f(SPARK.faint.crossTo)};
        bool sparkOn = false; // the sparks are not drawn from space: the street map has them, up close
        if (false) sparkOn = vCopy < 0.5 ? (h >= 0.0 && h < sparkLine) : (h >= crossFrom && h < crossTo);
        bool tick = false;
        if (period > 0.5) {
          // Whole pixels: a dash is a whole number of pixels long (at least one) and sits where the middle of the dash is, and a pixel is inked by where its
          // centre falls in the dash, so a dot is one pixel at every angle and offset and moves by whole pixels: at a fixed length it was one pixel or two, and
          // none at some angles, and changed with every sub-pixel of a pan or a zoom.
          float mid = on * 0.5;
          if (vCopy > 0.5) {
            // the rail's tick: the pixel in the middle of each dash
            float u = mod(cells, period);
            tick = uTickOn > 0.5 && abs(vMode - 1.0) < 0.5 && u >= mid - 0.5 * step1 && u < mid + 0.5 * step1;
          } else {
            float len = max(1.0, floor(on / step1 + 0.5)) * step1;
            float u = mod(cells - (mid - 0.5 * len), period);
            if (u >= len && !sparkOn) discard;
          }
        }
        if (vCopy > 0.5 && !tick && !sparkOn) discard;
        if (behindGlobe(vPos)) discard;
        int base = int(vPal + 0.5) * ${TRAIL_PER_PALETTE};
        vec3 col;
        if (sparkOn) col = uTrail[base + ${TRAIL_BANDS + 1}];
        else if (inked) col = uTrail[base + ${TRAIL_BANDS}];
        else col = uTrail[base + int(clamp(floor(frac * ${f(TRAIL_BANDS)}), 0.0, ${f(TRAIL_BANDS - 1)}))];
        // the overlay's presence (boxes and labels share it): a solid mix toward the page in the fade's own levels; nothing at 0
        float pk = ceil(uPresence * uFinal - 1.0e-4) / uFinal;
        if (pk < 0.01) discard;
        // from far away the paths are quieter (a solid mix toward the page, not an opacity); the selected place's legs keep their strength
        col = mix(uPage, col, (inked ? 1.0 : vFade * (1.0 - 0.55 * uFar)) * pk);
        // a straight line up close: a solid mix toward the page by its step
        col = mix(col, uPage, ${f(STRAIGHT_FADE_MIX)} * vQuiet / ${f(STRAIGHT_FADE_STEPS)});
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/** Horizon outline: a circle in view space, drawn without a depth test. */
export function silhouetteMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color() },
      uC: { value: [0, 0, 1] },
      uE: { value: [1, 0, 0] },
      uN: { value: [0, 1, 0] },
      uInvD: { value: 0.2 },
      uSunN: { value: [0, 0, 1] },
      uNight: { value: 0 },
      uFlip: { value: 0 },
      uNightTo: { value: new Color() },
    },
    vertexShader: /* glsl */ `
      attribute float aAngle; uniform vec3 uC; uniform vec3 uE; uniform vec3 uN; uniform float uInvD;
      varying vec3 vDir;
      void main() {
        float rad = sqrt(max(0.0, 1.0 - uInvD * uInvD));
        vec3 p = uC * uInvD + rad * (cos(aAngle) * uE + sin(aAngle) * uN);
        vDir = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    // the planet's outline goes dark with the ground it edges (the same steps as the lines: a flat grey each)
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uSunN; uniform float uNight; uniform float uFlip; uniform vec3 uNightTo;
      varying vec3 vDir;
      ${NIGHT_GLSL}
      void main() {
        float dark = floor(washOf(normalize(vDir), uSunN, uNight, uFlip) * ${NIGHT.lineSteps.toFixed(1)} + 0.5) / ${NIGHT.lineSteps.toFixed(1)};
        gl_FragColor = vec4(mix(uColor, uNightTo, dark * mix(${NIGHT.limbDim.toFixed(2)}, ${NIGHT.limbDimLight.toFixed(2)}, uFlip)), 1.0);
      }`,
    depthTest: false,
  });
}
