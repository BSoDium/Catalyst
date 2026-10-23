/**
 * ShaderMaterials for the 1-bit look. All of them write raw sRGB (no lighting, no tone mapping), see the
 * `ColorManagement` note in renderer.ts. Visibility of borders is ordered-dither coverage, not alpha, so the
 * output never contains a blended pixel.
 */
import { Color, ShaderMaterial } from "three";
import { LEG_MODES, MODE_STYLE } from "../paths/modes";
import { STRAIGHT_FADE_MIX, STRAIGHT_FADE_STEPS } from "../paths/thin";
import { SPARK, TRAIL_BANDS, TRAIL_ENTRIES, TRAIL_PER_PALETTE } from "../paths/trail";

const PASS_THROUGH_VERTEX = /* glsl */ `
  void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** The globe disc is a hair inside the lines (radius 1) so lines on the near side never z-fight with it. */
export const OCCLUDER_RADIUS = 0.998;

const DITHER_GLSL = /* glsl */ `
  float dither2(vec2 a) { return fract(a.x * 0.5 + a.y * a.y * 0.75); }
  float dither4(vec2 a) { return dither2(0.5 * a) * 0.25 + dither2(a); }
  // Discard fragments so that roughly \`coverage\` of pixels survive (ordered dither, stays 1-bit).
  void ditherDiscard(float coverage) { if (dither4(floor(gl_FragCoord.xy)) >= coverage) discard; }
`;

export function lineMaterial(coverage: number, stipple = 0): ShaderMaterial {
  return new ShaderMaterial({
    // `uAlt` / `uAltAmt`: the colour the line is taken towards (the borders, over the land the interlude fills, are the page's colour: the fill is the ink's)
    uniforms: { uColor: { value: new Color() }, uCoverage: { value: coverage }, uStipple: { value: stipple }, uAlt: { value: new Color() }, uAltAmt: { value: 0 } },
    vertexShader: PASS_THROUGH_VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uCoverage; uniform float uStipple; uniform vec3 uAlt; uniform float uAltAmt;
      ${DITHER_GLSL}
      void main() {
        ditherDiscard(uCoverage);
        if (uStipple > 0.0 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), uStipple) > 0.5) discard;
        gl_FragColor = vec4(mix(uColor, uAlt, uAltAmt), 1.0);
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
    uniforms: { uColor: { value: new Color() }, uFill: { value: new Color() }, uLand: { value: 0 }, uLandMap: { value: null }, uSun: { value: [0, 0, 1] } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uFill; uniform float uLand; uniform sampler2D uLandMap; uniform vec3 uSun;
      varying vec3 vDir;
      ${DITHER_GLSL}
      bool lit(float coverage) { return dither4(floor(gl_FragCoord.xy)) < coverage; }
      void main() {
        vec3 col = uColor;
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
      uniform vec3 uTrail[${TRAIL_ENTRIES}]; uniform vec3 uPage; uniform float uFinal; uniform float uPresence; uniform float uFront; uniform float uMarch; uniform float uCell; uniform float uFar; uniform float uTickOn;
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
        bool lit = vState > 0.25;
        float t = vLen > 0.0 ? vDist / vLen : 0.0;
        float frac = t;                          // 0 at the origin, 1 at the destination: the trail's gradient runs this way
        if (vState > 0.75) t = 1.0 - t;         // a leg that ends at the place draws on from the place
        bool inked = lit && t <= uFront;
        if (!inked && vFade < 0.01) discard;
        float cells = vDist / uCell - (lit ? uMarch : 0.0);
        // mode ids (paths/modes.ts): 0 road, 1 rail, 2 ferry, 3 flight, 4 walk, 5 unknown
        float m = floor(vMode + 0.5);
        float period = ${modeChain((k) => MODE_STYLE[k].period)};
        float on = ${modeChain((k) => MODE_STYLE[k].on)};
        // the head's spark: cells back from the destination (paths/trail.ts SPARK); the draw-on has not reached a lit head yet when t < 1
        float h = (vLen - vDist) / uCell - (inked ? ${f(SPARK.lit.clear)} : ${f(SPARK.faint.clear)});   // 0 where the spark begins, outside the place's box
        float sparkLine = inked ? ${f(SPARK.lit.line)} : ${f(SPARK.faint.line)};
        float crossFrom = inked ? ${f(SPARK.lit.crossFrom)} : ${f(SPARK.faint.crossFrom)};
        float crossTo = inked ? ${f(SPARK.lit.crossTo)} : ${f(SPARK.faint.crossTo)};
        bool sparkOn = false; // the sparks are not drawn from space: the street map has them, up close
        if (false) sparkOn = vCopy < 0.5 ? (h >= 0.0 && h < sparkLine) : (h >= crossFrom && h < crossTo);
        bool tick = false;
        if (period > 0.5) {
          float u = mod(cells, period);
          // the rail's tick: one cell across the line at the middle of each dash
          if (vCopy > 0.5) tick = uTickOn > 0.5 && abs(vMode - 1.0) < 0.5 && u >= on * 0.5 - 0.5 && u < on * 0.5 + 0.5;
          else if (u >= on && !sparkOn) discard;
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
    },
    vertexShader: /* glsl */ `
      attribute float aAngle; uniform vec3 uC; uniform vec3 uE; uniform vec3 uN; uniform float uInvD;
      void main() {
        float rad = sqrt(max(0.0, 1.0 - uInvD * uInvD));
        vec3 p = uC * uInvD + rad * (cos(aAngle) * uE + sin(aAngle) * uN);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: "uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }",
    depthTest: false,
  });
}
