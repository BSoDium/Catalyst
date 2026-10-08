/**
 * ShaderMaterials for the 1-bit look. All of them write raw sRGB (no lighting, no tone mapping), see the
 * `ColorManagement` note in renderer.ts. Visibility of borders is ordered-dither coverage, not alpha, so the
 * output never contains a blended pixel.
 */
import { Color, ShaderMaterial } from "three";

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
    uniforms: { uColor: { value: new Color() }, uCoverage: { value: coverage }, uStipple: { value: stipple } },
    vertexShader: PASS_THROUGH_VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uCoverage; uniform float uStipple;
      ${DITHER_GLSL}
      void main() {
        ditherDiscard(uCoverage);
        // Regular stipple (every n-th pixel on the diagonal) reads as a dotted line at any angle.
        if (uStipple > 0.0 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), uStipple) > 0.5) discard;
        gl_FragColor = vec4(uColor, 1.0);
      }
    `,
  });
}

/** The globe disc: writes the page colour and depth, so everything behind it is hidden and the ocean is invisible. */
export function occluderMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color() } },
    vertexShader: PASS_THROUGH_VERTEX,
    fragmentShader: "uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }",
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/**
 * Route: great-circle arcs drawn as a 2x2 px dashed stroke. The dash period is set per frame in world units so
 * dashes keep a constant on-screen length at any zoom; `uProgress` is the draw-on front (radians).
 *
 * Hidden behind the globe by an analytic test on the line itself (does the ray from the camera to this point
 * enter the occluder sphere first?), NOT by the depth buffer: the stroke's off-centre pixels carry the centre line's
 * depth, so on a tilted surface the depth test cut part of a 2x2 dash. The test depends only on the position along
 * the line, so a dash is cut across its length or not at all. Depth test and write are off.
 */
export function routeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color() },
      uProgress: { value: 0 },
      uOffset: { value: 0 },
      uPeriod: { value: 0.016 },
      uPixel: { value: [0.01, 0.01] },
      uLift: { value: 1 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aDist; attribute vec2 aOff; uniform vec2 uPixel; uniform float uLift; varying float vDist; varying vec3 vPos;
      void main() {
        vDist = aDist;
        // uLift scales the arc's height above the surface: 1 = lifted arc, 0 = on the ground (street scale).
        vec3 p = normalize(position) * (1.0 + (length(position) - 1.0) * uLift);
        vPos = p;
        vec4 c = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        c.xy += aOff * uPixel * c.w;
        gl_Position = c;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uProgress; uniform float uOffset; uniform float uPeriod;
      varying float vDist; varying vec3 vPos;
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
        if (vDist > uProgress) discard;
        if (fract((vDist - uOffset) / uPeriod) > 0.62) discard;
        if (behindGlobe(vPos)) discard;
        gl_FragColor = vec4(uColor, 1.0);
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
