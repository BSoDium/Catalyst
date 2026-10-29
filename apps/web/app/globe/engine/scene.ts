import type { Polylines } from "@catalyst/geodata";
import {
  BufferAttribute,
  BufferGeometry,
  LineLoop,
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  NearestFilter,
  LineSegments,
  Mesh,
  NoColorSpace,
  Points,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
  type PerspectiveCamera,
  Scene,
  SphereGeometry,
  type ShaderMaterial,
  type Texture,
  TextureLoader,
} from "three";
import type { GlobePlace, GlobeRoute } from "../types";
import type { GlobeTheme, Rgb } from "./colors";
import { FadeArray, clockStep } from "./fade";
import { borderLevel, bordersWanted } from "./palette";
import type { ViewBasis } from "./geo";
import { zoomToRadiusPx } from "./geo";
import { landMask } from "./land";
import { GRATICULE_STEP_DEG, graticuleSegments, polylinesToSegments } from "./geometry";
import { OCCLUDER_RADIUS, lightsMaterial, atmosphereMaterial, rimMaterial, rimGroundMaterial, twilightMaterial, cityMaterial, surfaceMaterial, mistMaterial, lineMaterial, occluderMaterial, silhouetteMaterial } from "./materials";
import { RIM } from "./moon";
import { MoonLayer } from "./moon-layer";
import { SunLayer } from "./sun-layer";
import { RouteLayer } from "./route-layer";
import { SKY_STATE, type Mat3 } from "./sky";
import { SkyLayer } from "./sky-layer";
import { perfEnd, perfStart } from "./perf";
import { routeLift } from "./view";
import { TUNING } from "./tuning";
import { CINEMATIC } from "./cinematic";
import { LIGHTS, surfaceTones } from "./surface";


/** How much of the ink the filled land has (the rest is the page's colour): near the ink, as the letters' metal is. */
const LAND_SHARE = 0.86;
/** The land mask's grid (7 ms to make, 8 MB): fine enough that the fill is on the drawn outline down to a pixel or two at the flight's closest shots. */
const MASK_W = 4096;
const MASK_H = 2048;
/** The mist: the glow stands `SHELL` radii over the surface (a layer of the planet: it shrinks with it). */
const SHELL = 0.022;
/** The most lights (places) the planet shows at the chord. */
const CITY_LIGHTS = 16;

function segmentGeometry(positions: Float32Array): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  return g;
}

/**
 * Everything drawn: sky, disc, graticule, borders, coastlines, routes, markers, horizon outline.
 * Owns its GL-side resources (`dispose` frees them all). Knows nothing about input, DOM or scheduling.
 */
export class GlobeScene {
  readonly scene = new Scene();
  readonly routes: RouteLayer;
  /** The Milky Way and the stars behind the earth (engine/sky-layer.ts), or null when the page switched them off (`applySkyFlags`). */
  readonly sky: SkyLayer | null;
  /** The moon, a body on an orbit about the earth (engine/moon-layer.ts), or null when the page has none (no `GlobeProps.moon`, `?no-moon`, a debug page without `?moon`). */
  readonly moon: MoonLayer | null;
  /** The sun: a sprite in the sky on the side the light comes from (engine/sun-layer.ts); with the moon's flag. */
  readonly sun: SunLayer | null;

  private geometries: BufferGeometry[] = [];
  private materials: ShaderMaterial[] = [];
  private occluder = occluderMaterial();
  private city = cityMaterial();
  private atmosphere = atmosphereMaterial();
  private rim = rimMaterial();
  private rimMesh: Mesh | null = null;
  private rimGround = rimGroundMaterial();
  private twilight = twilightMaterial();
  private mist = mistMaterial();
  private lights = lightsMaterial();
  private lightsMesh: Mesh | null = null;
  private lightsReady = false;
  private lightsLoading = false;
  private lightsTex: Texture | null = null;
  private nightNow = 0;
  private surface = surfaceMaterial();
  private surfaceMesh: Mesh | null = null;
  private surfaceReady = false;
  private surfaceNow = 0;
  private surfaceStrength = 1;
  private surfaceLoading = false;
  private disposed = false;
  private surfaceTex: Texture | null = null;
  private mistMesh: Mesh | null = null;
  private atmosphereMesh: Mesh | null = null;
  private atmosphereNow = 0;
  private cityNow = 0;
  private coastData: Polylines | null = null;
  private landTex: DataTexture | null = null;
  private landNow = 0;
  private landFill: Rgb = [0, 0, 0];
  private graticule = lineMaterial(1, 3);
  private borders = lineMaterial(1);
  private bordersLines: LineSegments | null = null;
  private coastLines: LineSegments | null = null;
  private ramp: readonly Rgb[] = [];
  private borderLevelNow = -1;
  /** The borders are ON or OFF (decided from the zoom with a hysteresis), and their tone runs to it by time: a timed fade, never a resting grey. */
  private borderFade = new FadeArray(1);
  private bordersOn = false;
  private bordersSeen = false;
  private lastClock = 0;
  private coast = lineMaterial(1);
  private silhouette = silhouetteMaterial();

  constructor(data: {
    places: readonly GlobePlace[];
    routes: readonly GlobeRoute[];
    coastlines: Polylines;
    borders: Polylines;
    /** The page has a moon (`GlobeProps.moon`, and the flags allow it). */
    moon?: boolean;
  }) {
    this.materials.push(this.occluder, this.city, this.atmosphere, this.rim, this.rimGround, this.twilight, this.mist, this.lights, this.surface, this.graticule, this.borders, this.coast, this.silhouette);
    this.coastData = data.coastlines;

    const disc = new SphereGeometry(OCCLUDER_RADIUS, 96, 48);
    this.geometries.push(disc);
    this.add(new Mesh(disc, this.occluder), 0);

    // Each layer is drawn in a fixed order (renderOrder) over the disc: grid, borders, coast, routes, horizon outline,
    // markers (last, so nothing can draw over a marker).
    // the atmosphere shell (the cinematic interlude's: hidden, and not drawn at all, outside it)
    const shell = new SphereGeometry(1, 96, 48); // (scaled to its height: `SHELL`)
    this.geometries.push(shell);
    this.atmosphereMesh = new Mesh(shell, this.atmosphere);
    this.atmosphereMesh.visible = false;
    this.atmosphereMesh.frustumCulled = false;
    this.atmosphereMesh.scale.setScalar(1 + SHELL);
    this.atmosphere.uniforms.uShell!.value = 1 + SHELL;
    this.add(this.atmosphereMesh, 0.5);
    // the rim: the atmosphere as a thin skin on the limb, there while the sun is (the interlude's glow takes over from it)
    const skinRim = new Mesh(shell, this.rim);
    this.rimMesh = skinRim;
    skinRim.frustumCulled = false;
    skinRim.scale.setScalar(1 + RIM.shell);
    // (after the sun, 0.65: the sun's halo is behind the atmosphere, not over it)
    this.add(skinRim, 0.66);
    // and the mist on the ground itself, over the lines (a hair above the surface, which the lines are drawn on)
    const skin = new SphereGeometry(1.004, 96, 48);
    this.geometries.push(skin);
    this.mistMesh = new Mesh(skin, this.mist);
    this.mistMesh.visible = false;
    this.mistMesh.frustumCulled = false;
    this.add(this.mistMesh, 5);
    // (the twilight: a faint red tint just past the lit side's edge, over the mist's veil)
    const twilightBand = new Mesh(skin, this.twilight);
    twilightBand.frustumCulled = false;
    this.add(twilightBand, 5.05);
    // (and the sunset's light on the ground, over the mist: while the sun is aligned with the limb it lights the surface too)
    const groundGlow = new Mesh(skin, this.rimGround);
    groundGlow.frustumCulled = false;
    this.add(groundGlow, 5.1);
    // and the land's own picture (satellite, flat patches in a few tones), over the sea and under the lines
    // (ON the surface, not a hair above it, like the coastlines and the borders it lies under: a layer above the lines is displaced from them by its height over the sine of the angle the camera looks along the ground
    // at, which is nothing from the page's views and a great shift on the interlude's low shots, where the land's picture floated up off its outlines; the disc under it is at `OCCLUDER_RADIUS`, below, and the
    // layer writes no depth, so there is nothing for it to fight with)
    const surfaceSkin = new SphereGeometry(1, 96, 48);
    this.geometries.push(surfaceSkin);
    this.surfaceMesh = new Mesh(surfaceSkin, this.surface);
    this.surfaceMesh.visible = false;
    this.surfaceMesh.frustumCulled = false;
    // (under the lines, which are drawn over it: its colours are solid)
    this.add(this.surfaceMesh, 0.6);
    // and the planet's lights on its dark side, over the ground and under the lines (solid colours, faint)
    this.lightsMesh = new Mesh(new SphereGeometry(1, 96, 48), this.lights); // (on the surface too: see the land's picture)
    this.geometries.push(this.lightsMesh.geometry);
    this.lightsMesh.visible = false;
    this.lightsMesh.frustumCulled = false;
    this.add(this.lightsMesh, 0.62);

    this.add(new LineSegments(this.track(segmentGeometry(graticuleSegments(GRATICULE_STEP_DEG, 3))), this.graticule), 1);
    this.bordersLines = new LineSegments(this.track(segmentGeometry(polylinesToSegments(data.borders, 1))), this.borders);
    this.add(this.bordersLines, 2);
    this.coastLines = new LineSegments(this.track(segmentGeometry(polylinesToSegments(data.coastlines, 1))), this.coast);
    this.add(this.coastLines, 3);

    // the places' lights: a dot for each of the owner's places, one for those within two degrees of another (a city and its districts are one light), a few
    const lights: number[] = [];
    const taken = new Set<string>();
    for (const pl of data.places) {
      const key = `${Math.round(pl.lon / 2)},${Math.round(pl.lat / 2)}`;
      if (taken.has(key) || lights.length >= CITY_LIGHTS * 3) continue;
      taken.add(key);
      const cl = Math.cos((pl.lat * Math.PI) / 180);
      const lam = (pl.lon * Math.PI) / 180;
      lights.push(1.003 * cl * Math.sin(lam), 1.003 * Math.sin((pl.lat * Math.PI) / 180), 1.003 * cl * Math.cos(lam));
    }
    if (lights.length) {
      const cityPoints = new Points(this.track(segmentGeometry(new Float32Array(lights))), this.city);
      cityPoints.frustumCulled = false;
      this.add(cityPoints as unknown as Mesh, 7);
    }
    this.routes = new RouteLayer(this.scene, data.routes);
    this.sky = SKY_STATE.enabled ? new SkyLayer(this.scene) : null;
    this.moon = data.moon ? new MoonLayer(this.scene) : null;
    this.sun = data.moon ? new SunLayer(this.scene) : null;

    const N = 360;
    const angle = new Float32Array(N);
    for (let i = 0; i < N; i++) angle[i] = (i / N) * Math.PI * 2;
    const ring = this.track(new BufferGeometry());
    ring.setAttribute("position", new BufferAttribute(new Float32Array(N * 3), 3));
    ring.setAttribute("aAngle", new BufferAttribute(angle, 1));
    const outline = new LineLoop(ring, this.silhouette);
    outline.frustumCulled = false;
    this.add(outline, 6);
  }

  private track(g: BufferGeometry): BufferGeometry {
    this.geometries.push(g);
    return g;
  }

  private add(object: Mesh | LineSegments | LineLoop, renderOrder: number) {
    object.renderOrder = renderOrder;
    this.scene.add(object);
  }

  applyTheme(t: GlobeTheme) {
    // The disc is the ocean: exactly the page colour, so the far side stays hidden without a visible body.
    this.occluder.uniforms.uColor!.value.setRGB(...t.background);
    // the land the interlude fills: the ink, taken a little towards the page (a fill of the full ink is the loudest thing on the page), and the borders over it the page's
    this.landFill = [0, 1, 2].map((i) => t.background[i]! + (t.ink[i]! - t.background[i]!) * LAND_SHARE) as unknown as Rgb;
    this.occluder.uniforms.uFill!.value.setRGB(...this.landFill);
    this.borders.uniforms.uAlt!.value.setRGB(...t.background);
    // (what the night does to the lines goes the page's way: towards the page on the dark one, towards the ink on the light one)
    const nightTo = t.scheme === "dark" ? t.background : t.ink;
    for (const m of [this.graticule, this.borders, this.coast]) m.uniforms.uNightTo!.value.setRGB(...nightTo);
    // the accent, as the page has it in this scheme (app.css `--palette-blue`; the lighter step on the dark page)
    if (t.scheme === "dark") this.city.uniforms.uColor!.value.setRGB(0.29, 0.64, 0.96);
    else this.city.uniforms.uColor!.value.setRGB(0, 0.47, 0.84);
    // The mist is MONOCHROME and quiet: a grey, a step from the page's colour towards its ink (no accent), at a low density. The glow above the limb is that grey; the
    // veil on the ground is the page's own colour with a trace of ink, so it covers the lines without painting anything.
    const bg = t.background;
    const mixTo = (k: number) => [0, 1, 2].map((i) => bg[i]! + (t.ink[i]! - bg[i]!) * k) as [number, number, number];
    this.atmosphere.uniforms.uColor!.value.setRGB(...mixTo(CINEMATIC.atmosphere.glow[t.scheme].tone));
    this.mist.uniforms.uColor!.value.setRGB(...mixTo(t.scheme === "dark" ? 0.3 : 0.18));
    // the land's three tones: darker ground, middle, lighter, each a step from the page's colour towards its ink (the page's own two ends, no hue)
    const tones = surfaceTones(t.scheme);
    this.surface.uniforms.uBg!.value.setRGB(...bg);
    // the lights: the sodium colour, faint, a step from the page's colour
    this.lights.uniforms.uColor!.value.setRGB(...([0, 1, 2].map((i) => bg[i]! + (LIGHTS.color[i]! - bg[i]!) * LIGHTS.strength) as [number, number, number]));
    this.lights.uniforms.uBg!.value.setRGB(...bg);
    this.lights.uniforms.uCover!.value = LIGHTS.cover;
    this.lights.uniforms.uCore!.value.setRGB(...([0, 1, 2].map((i) => bg[i]! + (LIGHTS.core[i]! - bg[i]!) * LIGHTS.coreStrength) as [number, number, number]));
    this.surface.uniforms.uTone0!.value.setRGB(...mixTo(tones[0]!));
    this.surface.uniforms.uTone1!.value.setRGB(...mixTo(tones[1]!));
    this.surface.uniforms.uTone2!.value.setRGB(...mixTo(tones[2]!));
    this.atmosphere.uniforms.uCover!.value = CINEMATIC.atmosphere.glow[t.scheme].cover;
    // the rim: a soft grey close to the page's colour (the haze and the lining's base)
    this.rim.uniforms.uColor!.value.setRGB(...mixTo(t.scheme === "dark" ? 0.45 : 0.3));
    this.rim.uniforms.uCover!.value = RIM.cover[t.scheme === "dark" ? "dark" : "light"];
    // (the light page's lining is WHITE, shown by the grey veil of the lens flare (0.9): it is drawn over it; the dark page's is under the flare, as it was)
    if (this.rimMesh) this.rimMesh.renderOrder = t.scheme === "dark" ? 0.66 : 0.95;
    this.rimGround.uniforms.uColor!.value.setRGB(...mixTo(t.scheme === "dark" ? 0.45 : 0.3));
    this.mist.uniforms.uCover!.value = t.scheme === "dark" ? 0.36 : 0.24;
    this.graticule.uniforms.uColor!.value.setRGB(...t.grid);
    this.ramp = t.ramp;
    this.borderLevelNow = -1;
    this.coast.uniforms.uColor!.value.setRGB(...t.coast);
    this.silhouette.uniforms.uColor!.value.setRGB(...t.outline);
    this.silhouette.uniforms.uNightTo!.value.setRGB(...nightTo);
    this.routes.applyTheme(t);
    this.sky?.applyTheme(t);
    this.sun?.applyTheme(t);
    this.moon?.applyTheme(t);
    // the light page's night thickens (`uFlip`: the stipple, the tones, in the surface's shader) where the dark page's fades
    for (const m of [this.occluder, this.surface, this.graticule, this.borders, this.coast, this.silhouette, this.atmosphere, this.rim, this.rimGround, this.twilight, this.mist, this.lights]) m.uniforms.uFlip!.value = t.scheme === "dark" ? 0 : 1;
  }

  /**
   * Make the land mask now (engine/land.ts: a few milliseconds and 2 MB; the interlude is planned, so it is done before it begins and not in the frame
   * that starts it). Idempotent.
   */
  prepareLand() {
    if (this.landTex || !this.coastData) return;
    const tex = new DataTexture(landMask(this.coastData, MASK_W, MASK_H), MASK_W, MASK_H, RedFormat, UnsignedByteType);
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.wrapS = RepeatWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    this.landTex = tex;
    this.occluder.uniforms.uLandMap!.value = tex;
    this.surface.uniforms.uLandMap!.value = tex;
  }

  /**
   * The finer coastline (Natural Earth 50m, a lazy chunk of `@catalyst/geodata`) in place of the first one: the coastlines drawn, and the land's mask they fill (the interlude's
   * continents, the patches' edge), are rebuilt from it. The first coast stays until this is made; one swap, whenever it arrives.
   */
  upgradeCoast(p: Polylines) {
    if (this.disposed || !this.coastLines) return;
    this.coastData = p;
    const old = this.coastLines.geometry;
    this.coastLines.geometry = this.track(segmentGeometry(polylinesToSegments(p, 1)));
    this.geometries = this.geometries.filter((g) => g !== old);
    old.dispose();
    if (this.landTex) {
      this.landTex.dispose();
      this.landTex = null;
      this.prepareLand();
    }
  }

  /**
   * The planet's night (engine/surface.ts, `NIGHT`): `night` 0..1 is how much of it there is (0: the globe as it always was), `sun` the direction towards the light in the earth's
   * frame. The land's ground thins in the dither and steps to its faintest tone, and the lines and the planet's own outline go towards the page's colour in grey steps, on the dark side.
   */
  setNight(night: number, x: number, y: number, z: number) {
    for (const m of [this.occluder, this.surface, this.graticule, this.borders, this.coast, this.silhouette, this.atmosphere, this.rim, this.rimGround, this.twilight, this.mist, this.lights]) {
      m.uniforms.uNight!.value = night;
      m.uniforms.uSunN!.value = [x, y, z];
    }
    this.nightNow = night;
    if (this.lightsMesh) this.lightsMesh.visible = this.lightsReady && night > 0.01;
  }

  /** The sun's direction in the earth's frame (the planet's light; the letters have the same one in the camera's frame). */
  setSun(x: number, y: number, z: number) {
    this.atmosphere.uniforms.uSun!.value = [x, y, z];
    this.occluder.uniforms.uSun!.value = [x, y, z];
    this.city.uniforms.uSun!.value = [x, y, z];
  }

  /**
   * Load the land's picture (`surfaceMaterial`), once; `done` is called when it is in (the frame is drawn again). Nothing is drawn of it before that, and a failure leaves none.
   */
  loadSurface(url: string, done: () => void) {
    if (this.surfaceReady || this.surfaceLoading || this.disposed) return;
    this.surfaceLoading = true;
    this.fetchSurface(
      url,
      (tex) => {
        this.surfaceTex = tex;
        // (the finer picture, if it came first, stays: it is the one in the shader until the interlude gives it back)
        this.surface.uniforms.uEarth!.value = this.surfaceHiTex ?? tex;
        this.surfaceReady = true;
        this.prepareLand(); // (the coastlines' fill, for the patches' edge)
        this.setSurface(this.surfaceNow, this.surfaceStrength);
        done();
      },
      () => {
        this.surfaceLoading = false;
      },
    );
  }

  /**
   * The finer picture of the land (`SURFACE.hiUrl`), in place of the first while it is there (the interlude's close shots); the first is kept, and stays if this one fails. It is big (8192 x 4096,
   * about 134 MB of RGBA on the GPU), so it is held only for an interlude: `releaseSurfaceHi` gives it back. It may arrive before the first picture: that one then waits in `surfaceTex` (`loadSurface`).
   */
  loadSurfaceHi(url: string, done: () => void) {
    if (this.surfaceHi || this.disposed) return;
    this.surfaceHi = true;
    this.fetchSurface(
      url,
      (tex) => {
        if (!this.surfaceHi) {
          tex.dispose(); // (released while it was on its way)
          return;
        }
        this.surfaceHiTex = tex;
        this.surface.uniforms.uEarth!.value = tex;
        done();
      },
      () => {
        this.surfaceHi = false;
      },
    );
  }

  /** The interlude is over: the finer picture goes (its GPU memory is freed) and the first is the ground again; the next interlude loads it anew. */
  releaseSurfaceHi(): void {
    this.surfaceHi = false;
    if (!this.surfaceHiTex) return;
    if (this.surfaceTex) this.surface.uniforms.uEarth!.value = this.surfaceTex;
    this.surfaceHiTex.dispose();
    this.surfaceHiTex = null;
  }

  private surfaceHiTex: Texture | null = null;
  private surfaceHi = false;

  /** The planet's lights (`LIGHTS`), once, after the first frame; `done` when they are in. A failure leaves none. */
  loadLights(url: string, done: () => void) {
    if (this.lightsReady || this.lightsLoading || this.disposed) return;
    this.lightsLoading = true;
    this.fetchSurface(
      url,
      (tex) => {
        tex.magFilter = tex.minFilter = NearestFilter; // (a light is one hard texel: a point, not a blob)
        this.lights.uniforms.uLights!.value = tex;
        const img = tex.image as { width?: number; height?: number } | undefined;
        if (img?.width && img.height) this.lights.uniforms.uSize!.value = [img.width, img.height];
        this.lightsTex = tex;
        this.lightsReady = true;
        if (this.lightsMesh) this.lightsMesh.visible = this.nightNow > 0.01;
        done();
      },
      () => {
        this.lightsLoading = false;
      },
    );
  }

  private fetchSurface(url: string, ok: (tex: Texture) => void, fail: () => void) {
    new TextureLoader().load(
      url,
      (tex) => {
        if (this.disposed) {
          tex.dispose(); // (the globe went away while it was on its way)
          return;
        }
        tex.magFilter = LinearFilter;
        tex.minFilter = LinearFilter;
        tex.wrapS = RepeatWrapping;
        tex.wrapT = ClampToEdgeWrapping;
        tex.generateMipmaps = false;
        tex.colorSpace = NoColorSpace;
        ok(tex);
      },
      undefined,
      fail,
    );
  }

  /**
   * The land's picture: `fade` is the share of its pixels drawn, 0 (none) to 1 (all), taken out in the lines' ordered dither (`engine/surface.ts`: the zoom's fade times the
   * coverage); `strength` 0..1 how far its tones are from the page's colour (1: the tones themselves).
   */
  setSurface(fade: number, strength = 1) {
    const x = Math.min(1, Math.max(0, fade));
    this.surfaceNow = x;
    this.surfaceStrength = strength;
    this.surface.uniforms.uAmt!.value = x;
    this.surface.uniforms.uStrength!.value = strength;
    if (this.surfaceMesh) this.surfaceMesh.visible = this.surfaceReady && this.landTex !== null && x > 0.01;
  }

  /**
   * The mist, 0 (none: nothing of it is drawn) to 1: a thin grey glow just over the limb, a veil on the ground thickening to the horizon (bleeding in from the limb). Drawn for the length of the interlude only.
   */
  setAtmosphere(k: number) {
    const x = Math.min(1, Math.max(0, k));
    if (Math.abs(x - this.atmosphereNow) < 0.01 && !(x === 0 && this.atmosphereNow !== 0)) return;
    this.atmosphereNow = x;
    this.atmosphere.uniforms.uAmt!.value = x;
    this.rim.uniforms.uAmt!.value = 1 - x;
    this.rimGround.uniforms.uAmt!.value = 1 - x;
    this.twilight.uniforms.uAmt!.value = 1 - x;
    this.mist.uniforms.uAmt!.value = x;
    if (this.atmosphereMesh) this.atmosphereMesh.visible = x > 0;
    if (this.mistMesh) this.mistMesh.visible = x > 0;
  }

  /** The places' lights, 0 (out) to 1: they come up through the dither. */
  setCity(k: number) {
    const x = Math.min(1, Math.max(0, k));
    if (Math.abs(x - this.cityNow) < 0.01 && !(x === 0 && this.cityNow !== 0)) return;
    this.cityNow = x;
    this.city.uniforms.uCity!.value = x;
  }

  /**
   * The continents are filled with the ink, 0 (not at all) to 1: the borders go to the page's colour over it so that they stay seen, the coastlines
   * (the ink's own tone) are the fill's edge. A change of a hundredth or more is written.
   */
  setLand(k: number) {
    const x = Math.min(1, Math.max(0, k));
    if (Math.abs(x - this.landNow) < 0.01 && !(x === 0 && this.landNow !== 0)) return;
    this.landNow = x;
    this.occluder.uniforms.uLand!.value = x;
    this.borders.uniforms.uAltAmt!.value = x;
  }

  /** Whether the borders' fade has not reached its end: the frame loop must keep going. */
  get animating(): boolean {
    return this.borderFade.moving || (this.sky?.animating ?? false);
  }

  /** The borders' fade now (0..1) and whether they are wanted (checks). */
  borderState() {
    return { value: this.borderFade.value(0), on: this.bordersOn };
  }

  /** Run the borders' and the sky's fades to their end (checks). */
  settleBorders() {
    this.borderFade.settle();
    this.sky?.settle();
  }

  /**
   * Per-frame sky: the view-to-galactic matrix of this camera (`viewToGal`, `viewToGalactic`: computed once a frame by the renderer, the caption's chrome reads it too; `d` the camera's distance), and where the earth's silhouette is in
   * the buffer. `hold`: the sky stays on whatever the picture reaches (the cinematic interlude's close shots fill the picture with the planet, and the sky above the horizon is the point). Call after the camera's matrices are current. `bufW`, `bufH` and `shiftBuf` are the drawing buffer and the inset's shift (buffer px).
   */
  syncSky(camera: PerspectiveCamera, viewToGal: Mat3, d: number, buf: { w: number; h: number; shift: number; lift?: number }, now: number, instant: boolean, hold = false) {
    this.sky?.sync({ viewToGal, projInv: camera.projectionMatrixInverse, d, bufW: buf.w, bufH: buf.h, shiftBuf: buf.shift, liftBuf: buf.lift ?? 0 }, now, instant, hold);
  }

  /** The keys of the legs that stay at this zoom (`RouteLayer.setThinning`), null: all. */
  kept: ReadonlySet<string> | null = null;

  /** Per-frame uniforms that depend on the camera. `now` is the clock (ms) the border fade runs on; `instant`: reduced motion. */
  syncCamera(basis: ViewBasis, zoom: number, pixel: number, now: number, instant: boolean, lat = 0, view = 0, lon?: number) {
    this.routes.setLift(routeLift(zoom));
    this.routes.setScale(pixel, zoomToRadiusPx(zoom));
    // the Web Mercator zoom with the scale the centre has on the globe (the unified zoom less log2 of the secant of the latitude)
    const tp = perfStart();
    this.kept = this.routes.setThinning(zoom + Math.log2(Math.max(0.05, Math.cos((lat * Math.PI) / 180))), pixel, view, lon === undefined ? undefined : { lon, lat });
    perfEnd("paths.thin", tp);
    // Borders: on from the zoom `TUNING.borderZoom` (a hysteresis), off below. The fade is a timed TONE (a line is always solid): the faintest
    // grey level stepping up through the palette to the coast level (the coastline's, `borderLevel`) over `FADE_MS`, whatever the camera does, so the globe
    // at rest never shows a half-faded border. Never a dither: a low-coverage dither on 1px lines reads as noise instead of a fade.
    // (the cinematic interlude's camera is no exception: the borders come in as it gets close enough, as for a visitor's zoom, and go as it backs away)
    this.bordersOn = bordersWanted(this.bordersOn, zoom, TUNING.borderZoom);
    if (!this.bordersSeen) {
      this.bordersSeen = true; // the first frame starts in its state
      this.borderFade.snap(0, this.bordersOn);
    } else this.borderFade.set(0, this.bordersOn);
    if (this.borderFade.moving) this.borderFade.step(clockStep(this.lastClock, now), instant);
    this.lastClock = now;
    this.setBorderLevel(borderLevel(this.borderFade.value(0), this.ramp.length));
    const u = this.silhouette.uniforms;
    u.uC!.value = basis.c;
    u.uE!.value = basis.east;
    u.uN!.value = basis.north;
    u.uInvD!.value = 1 / basis.d;
  }

  private setBorderLevel(level: number) {
    if (level === this.borderLevelNow || !this.bordersLines) return;
    this.borderLevelNow = level;
    this.bordersLines.visible = level > 0;
    if (level > 0) this.borders.uniforms.uColor!.value.setRGB(...this.ramp[level]!);
  }

  dispose() {
    this.disposed = true;
    this.landTex?.dispose();
    this.surfaceTex?.dispose();
    this.surfaceHiTex?.dispose();
    this.lightsTex?.dispose();
    this.routes.dispose();
    this.sky?.dispose();
    this.sun?.dispose();
    this.moon?.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries = [];
    this.materials = [];
    this.scene.clear();
  }
}
