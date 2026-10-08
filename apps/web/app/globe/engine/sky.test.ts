import { describe, expect, it } from "vitest";
import { lonLatToVec3, viewBasis, DEG, type ViewBasis } from "./geo";
import {
  BAYER4,
  EQ_TO_GAL,
  GALACTIC_INCLINATION_DEG,
  bakeBand,
  bandValue,
  bayerThreshold,
  equatorialToGalactic,
  fbm,
  galacticToEquatorial,
  galacticLonLat,
  galacticVec,
  hash3,
  makeStars,
  mulMat3,
  mulVec3,
  rotateLon,
  sampleBand,
  skyFade,
  skyGeometry,
  skyTones,
  skyTop,
  skyWanted,
  starTier,
  starTones,
  starTop,
  toneAt,
  transpose,
  viewToGalactic,
} from "./sky";
import { buildRamp, contrastRatio, roleColor, roleLevel } from "./palette";
import { SKY } from "./tuning";

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);
const angle = (a: readonly number[], b: readonly number[]) => {
  const cx = a[1]! * b[2]! - a[2]! * b[1]!, cy = a[2]! * b[0]! - a[0]! * b[2]!, cz = a[0]! * b[1]! - a[1]! * b[0]!;
  return Math.atan2(Math.hypot(cx, cy, cz), a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) / DEG;
};

describe("frames: galactic <-> equatorial", () => {
  it("the matrix is a rotation", () => {
    const p = mulMat3(EQ_TO_GAL, transpose(EQ_TO_GAL));
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => near(p[i]!, v, 1e-8));
  });
  it("the galactic centre is toward RA 266.40, Dec -28.94", () => {
    const { ra, dec } = galacticToEquatorial(0, 0);
    near(ra, 266.4, 0.01);
    near(dec, -28.94, 0.01);
  });
  it("the north galactic pole is at RA 192.86, Dec +27.13", () => {
    const { ra, dec } = galacticToEquatorial(0, 90);
    near(ra, 192.86, 0.01);
    near(dec, 27.13, 0.01);
  });
  it("round trips", () => {
    for (const [l, b] of [[10, 20], [200, -40], [359, 5]] as const) {
      const { ra, dec } = galacticToEquatorial(l, b);
      const back = equatorialToGalactic(ra, dec);
      near((((back.l - l + 540) % 360) - 180), 0, 1e-6);
      near(back.b, b, 1e-6);
    }
  });
  it("the plane is inclined about 62.9 degrees to the earth's equator", () => {
    // the angle between the two planes is the angle between their poles: the galactic pole and the celestial pole (dec 90)
    const pole = galacticToEquatorial(0, 90);
    near(90 - pole.dec, GALACTIC_INCLINATION_DEG, 0.01);
    near(GALACTIC_INCLINATION_DEG, 62.9, 0.05);
    // the galactic equator reaches declination +-62.87 at most
    let max = -90;
    for (let l = 0; l < 360; l += 1) max = Math.max(max, galacticToEquatorial(l, 0).dec);
    near(max, GALACTIC_INCLINATION_DEG, 0.05);
  });
});

describe("frames: view", () => {
  const basis = (lon: number, lat: number): ViewBasis => viewBasis({ lon, lat, zoom: 3 }, 900);
  /** Galactic direction of the point with right ascension `ra` and declination `dec`. */
  const sky = (ra: number, dec: number) => mulVec3(EQ_TO_GAL, [Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG)]);

  it("the ray through the middle of the picture lands behind the earth: RA = lon + ERA + 180, Dec = -lat", () => {
    for (const [lon, lat, era] of [[15, 28, 70], [-120, -45, 10], [170, 5, 300]] as const) {
      const g = mulVec3(viewToGalactic(basis(lon, lat), era), [0, 0, -1]);
      expect(angle(g, sky(lon + era + 180, -lat))).toBeLessThan(1e-6);
    }
  });
  it("north is up: the celestial pole is up on the screen (and toward the camera's side of the sky) at the equator", () => {
    const g = mulVec3(viewToGalactic(basis(40, 0), 123), [0, 1, 0]);
    expect(angle(g, sky(0, 90))).toBeLessThan(1e-6);
  });
  it("east is to the left behind the earth, as on a sky chart: more right ascension appears on the left of the view", () => {
    const m = transpose(viewToGalactic(basis(0, 0), 0)); // galactic -> view
    const centre = mulVec3(m, sky(180, 0));
    expect(centre[2]).toBeLessThan(-0.999); // straight ahead, behind the earth
    expect(mulVec3(m, sky(190, 0))[0]).toBeLessThan(0);
    expect(mulVec3(m, sky(170, 0))[0]).toBeGreaterThan(0);
  });
  it("the earth's rotation does not move the sky on the screen: view longitude - y with era + y is the same matrix", () => {
    const a = viewToGalactic(basis(30, 20), 70);
    for (const y of [0.3, 12, 95]) {
      const b = viewToGalactic(basis(30 - y, 20), 70 + y);
      for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, -1]] as const) expect(angle(mulVec3(b, axis), mulVec3(a, axis))).toBeLessThan(1e-9);
    }
  });
  it("a camera orbit moves the sky: another view longitude at the same era looks at another part of it", () => {
    const a = mulVec3(viewToGalactic(basis(15, 28), 70), [0, 0, -1]);
    const b = mulVec3(viewToGalactic(basis(75, 28), 70), [0, 0, -1]);
    expect(angle(a, b)).toBeGreaterThan(40);
  });
  it("rotateLon turns a longitude by the given angle", () => {
    const v = mulVec3(rotateLon(25), lonLatToVec3(10, 30));
    const w = lonLatToVec3(35, 30);
    expect(angle(v, w)).toBeLessThan(1e-9);
  });
});

describe("noise and the baked band", () => {
  it("the hash is deterministic and spread over 0..1", () => {
    expect(hash3(3, -4, 5, 9)).toBe(hash3(3, -4, 5, 9));
    expect(hash3(3, -4, 5, 9)).not.toBe(hash3(3, -4, 5, 10));
    let sum = 0;
    for (let i = 0; i < 2000; i++) {
      const h = hash3(i, i * 7, -i, 1);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      sum += h;
    }
    expect(Math.abs(sum / 2000 - 0.5)).toBeLessThan(0.03);
  });
  it("fbm is deterministic, in range and varies with the direction", () => {
    const v = galacticVec(40, 3);
    expect(fbm(v, SKY.seed)).toBe(fbm(v, SKY.seed));
    expect(fbm(v, SKY.seed)).not.toBe(fbm(galacticVec(60, 3), SKY.seed));
    for (let l = 0; l < 360; l += 7) {
      const n = fbm(galacticVec(l, 10), SKY.seed);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
  });
  it("the band is brighter and thicker toward the galactic centre, absent far from the plane", () => {
    const centre = bandValue(0, 6, 0.7); // off the dust lane
    const anti = bandValue(180, 6, 0.7);
    expect(centre).toBeGreaterThan(anti);
    expect(bandValue(0, 30, 0.7)).toBeLessThan(centre * 0.3);
    expect(bandValue(0, SKY.map.bMaxDeg, 1)).toBe(0);
    expect(bandValue(0, -SKY.map.bMaxDeg, 1)).toBe(0);
    // thicker: still above a fixed level at a larger latitude toward the centre than at the anticentre
    const level = 0.12;
    const halfWidth = (l: number) => {
      let b = 0;
      while (b < 44 && bandValue(l, b, 0.7) > level) b += 0.5;
      return b;
    };
    expect(halfWidth(0)).toBeGreaterThan(halfWidth(180));
  });
  it("a dust lane splits the band where the rift runs and not at the anticentre", () => {
    const lane = (l: number) => bandValue(l, 0, 0.7) / Math.max(bandValue(l, 5, 0.7), 1e-9);
    expect(lane(40)).toBeLessThan(lane(180));
  });
  it("bakes the same bytes every time, in range, zero at the latitude edges, symmetric in size", () => {
    const a = bakeBand();
    expect(a.length).toBe(SKY.map.cols * SKY.map.rows);
    expect(bakeBand()).toBe(a);
    const { cols, rows } = SKY.map;
    for (let i = 0; i < cols; i++) {
      expect(a[i]).toBe(0);
      expect(a[(rows - 1) * cols + i]).toBe(0);
    }
    expect(Math.max(...a)).toBeGreaterThan(120);
    expect(Math.max(...a)).toBeLessThanOrEqual(Math.round(255 * SKY.band.gain));
  });
  it("the lookup wraps in longitude and agrees with the texel at its centre", () => {
    const m = bakeBand();
    const { cols, rows, bMaxDeg } = SKY.map;
    near(sampleBand(m, -180 + 0.0001, 3), sampleBand(m, 180 + 0.0001, 3), 1e-9);
    const i = 130, j = rows / 2 + 4;
    const l = ((i + 0.5) * 360) / cols - 180;
    const b = -bMaxDeg + ((j + 0.5) * 2 * bMaxDeg) / rows;
    near(sampleBand(m, l, b), m[j * cols + i]! / 255, 1e-9);
  });
});

describe("stars", () => {
  it("are deterministic: the same seed, the same stars, bit for bit", () => {
    const a = makeStars();
    const b = makeStars();
    expect(Array.from(a.position)).toEqual(Array.from(b.position));
    expect(Array.from(a.keep)).toEqual(Array.from(b.keep));
    expect(Array.from(a.tier)).toEqual(Array.from(b.tier));
    expect(Array.from(makeStars(undefined, undefined, 7).position)).not.toEqual(Array.from(a.position));
  });
  it("are unit vectors, as many as asked, with tiers 0..2 and ranks in [0, 1)", () => {
    const s = makeStars();
    expect(s.count).toBe(SKY.stars.count);
    for (let i = 0; i < s.count; i++) {
      near(Math.hypot(s.position[i * 3]!, s.position[i * 3 + 1]!, s.position[i * 3 + 2]!), 1, 1e-5);
      expect(s.keep[i]).toBeGreaterThanOrEqual(0);
      expect(s.keep[i]).toBeLessThan(1);
      expect([0, 1, 2]).toContain(s.tier[i]);
    }
  });
  it("have a heavy-tailed brightness: many faint, some middling, a few brighter, in the configured shares", () => {
    const shares = SKY.stars.tierShares;
    near(shares.reduce((a, b) => a + b, 0), 1, 1e-9);
    expect(shares[0]).toBeGreaterThan(shares[1]!);
    expect(shares[1]).toBeGreaterThan(shares[2]!);
    expect(shares[0]! / shares[1]!).toBeGreaterThan(2); // each tier is several times rarer than the one below
    expect(shares[1]! / shares[2]!).toBeGreaterThan(2);
    const s = makeStars();
    const n = [0, 0, 0];
    for (let i = 0; i < s.count; i++) n[s.tier[i]!]!++;
    shares.forEach((share, k) => near(n[k]! / s.count, share, 0.03));
    expect(n[2]).toBeGreaterThan(100); // a few, but never none
  });
  it("starTier maps a uniform draw to a tier by the cumulative shares", () => {
    const shares = [0.7, 0.2, 0.1];
    expect([0, 0.3, 0.699].map((u) => starTier(u, shares))).toEqual([0, 0, 0]);
    expect([0.7, 0.85, 0.899].map((u) => starTier(u, shares))).toEqual([1, 1, 1]);
    expect([0.9, 0.99, 0.999999].map((u) => starTier(u, shares))).toEqual([2, 2, 2]);
  });
  it("the brighter stars are scattered at random, not on a grid: nearest-neighbour distances spread like a Poisson field", () => {
    const s = makeStars();
    const pts: number[][] = [];
    for (let i = 0; i < s.count; i++) if (s.tier[i] === 2) pts.push([s.position[i * 3]!, s.position[i * 3 + 1]!, s.position[i * 3 + 2]!]);
    const nn = pts.map((p, i) => {
      let cos = -1;
      pts.forEach((q, j) => {
        if (i !== j) cos = Math.max(cos, p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!);
      });
      return Math.acos(Math.min(1, cos));
    });
    const mean = nn.reduce((a, b) => a + b, 0) / nn.length;
    const sd = Math.sqrt(nn.reduce((a, b) => a + (b - mean) ** 2, 0) / nn.length);
    // a regular lattice has every nearest neighbour at the same distance (sd / mean ~ 0); a Poisson field about 0.5
    expect(sd / mean).toBeGreaterThan(0.35);
    // and the brighter stars are not clustered on one patch of sky either: each octant of the sphere has some
    const octants = new Set(pts.map((p) => (p[0]! > 0 ? 1 : 0) + (p[1]! > 0 ? 2 : 0) + (p[2]! > 0 ? 4 : 0)));
    expect(octants.size).toBe(8);
  });
  it("are denser along the band than away from it", () => {
    const s = makeStars();
    let on = 0;
    let off = 0;
    for (let i = 0; i < s.count; i++) {
      const { b } = galacticLonLat([s.position[i * 3]!, s.position[i * 3 + 1]!, s.position[i * 3 + 2]!]);
      if (Math.abs(b) < 10) on++;
      else if (Math.abs(b) > 40) off++;
    }
    // per unit of sky area: |b| < 10 is a sin(10) share of the sphere, |b| > 40 a 1 - sin(40) share
    const dOn = on / Math.sin(10 * DEG);
    const dOff = off / (1 - Math.sin(40 * DEG));
    expect(dOn / dOff).toBeGreaterThan(1.15);
    expect(dOn / dOff).toBeLessThan(SKY.stars.bandBoost + 0.3);
  });
});

describe("fade, tones, dither", () => {
  it("the fade is the limb strength up to the inner radius, 1 from the outer, monotonic and smooth between", () => {
    const { from, to, limb } = SKY.fade;
    expect(skyFade(0)).toBeCloseTo(limb, 12);
    expect(skyFade(from)).toBeCloseTo(limb, 12);
    expect(skyFade(to)).toBe(1);
    expect(skyFade(9)).toBe(1);
    let last = 0;
    for (let r = from; r <= to; r += 0.01) {
      const f = skyFade(r);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
    near(skyFade((from + to) / 2), (1 + limb) / 2, 1e-9);
  });
  it("the sky is only SLIGHTLY dimmed towards the earth: drawn right up to the silhouette at 50 to 60 % of its strength", () => {
    expect(SKY.fade.from).toBeLessThanOrEqual(1.02); // from the silhouette
    expect(SKY.fade.limb).toBeGreaterThanOrEqual(0.5);
    expect(SKY.fade.limb).toBeLessThanOrEqual(0.6);
    for (const rho of [1.0, 1.001, 1.03]) {
      expect(skyFade(rho)).toBeGreaterThanOrEqual(0.5);
      expect(skyFade(rho)).toBeLessThanOrEqual(0.6 + 0.02);
    }
    // never zero anywhere, and the dimming is gone from the outer radius on
    for (let r = 0.5; r <= 3; r += 0.05) expect(skyFade(r)).toBeGreaterThan(0.49);
    expect(skyFade(SKY.fade.to + 0.001)).toBe(1);
  });
  it("the Bayer thresholds are sixteen distinct values in (0, 1), periodic by 4 in both directions", () => {
    const t = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) t.add(bayerThreshold(x, y));
    expect(t.size).toBe(16);
    expect(BAYER4.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    for (const v of t) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
    expect(bayerThreshold(5, 9)).toBe(bayerThreshold(1, 1));
    expect(bayerThreshold(-1, -3)).toBe(bayerThreshold(3, 1));
  });
  it("quantises to whole tones only: 0 below the first step, the top at 1, and a flat area at v has the tone mix v * top", () => {
    expect(toneAt(0, 0.5)).toBe(0);
    expect(toneAt(1, 0)).toBe(2);
    expect(toneAt(1, 0.99)).toBe(2);
    for (let v = 0; v <= 1; v += 0.037) for (let i = 0; i < 16; i++) expect([0, 1, 2]).toContain(toneAt(v, bayerThreshold(i, i >> 2)));
    for (const v of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      let sum = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) sum += toneAt(v, bayerThreshold(x, y));
      near(sum / 16, v * 2, 1 / 16 + 1e-9);
    }
  });
  it("is monotonic in brightness at every cell", () => {
    for (let c = 0; c < 16; c++) {
      let last = 0;
      for (let v = 0; v <= 1; v += 0.01) {
        const t = toneAt(v, bayerThreshold(c & 3, c >> 2));
        expect(t).toBeGreaterThanOrEqual(last);
        last = t;
      }
    }
  });
  it("the stars add one tone, capped at the graticule's own level: never brighter than it", () => {
    expect(starTop(12)).toBe(3);
    expect(starTop(12)).toBe(roleLevel("faint", 12));
    for (const n of [3, 4, 6, 8, 10, 12]) {
      expect(starTop(n)).toBeGreaterThanOrEqual(skyTop(n));
      expect(starTop(n)).toBeLessThanOrEqual(roleLevel("faint", n));
      const ramp = Array.from({ length: n }, (_, i) => i);
      const [a, b, c] = starTones(ramp);
      expect(a).toBeGreaterThanOrEqual(1);
      expect(b).toBe(skyTop(n));
      expect(c).toBe(starTop(n));
      expect(a).toBeLessThanOrEqual(b);
      expect(b).toBeLessThanOrEqual(c);
    }
    // in colours: the brightest star is the graticule's contrast at most, in both themes
    for (const [bg, ink] of [[[0.984, 0.984, 0.984], [0.039, 0.039, 0.039]], [[0.039, 0.039, 0.039], [0.961, 0.961, 0.961]]] as const) {
      const ramp = buildRamp(bg, ink, 12);
      const top = starTones(ramp)[2];
      const grid = roleColor(ramp, "faint");
      expect(top).toEqual(grid);
      expect(contrastRatio(top, ramp[0]!)).toBeLessThan(1.5);
      expect(contrastRatio(top, ramp[0]!)).toBeGreaterThan(contrastRatio(starTones(ramp)[1], ramp[0]!));
    }
  });
  it("uses only levels below the graticule's for the band, never the page colour for the tones", () => {
    expect(skyTop(12)).toBe(2);
    for (const n of [3, 4, 6, 8, 10, 12]) {
      expect(skyTop(n)).toBeGreaterThanOrEqual(1);
      const ramp = Array.from({ length: n }, (_, i) => i);
      const [dim, bright] = skyTones(ramp);
      expect(dim).toBeGreaterThanOrEqual(1);
      expect(bright).toBe(skyTop(n));
    }
  });
});

describe("the sky on screen", () => {
  it("the silhouette radius is focal / sqrt(d^2 - 1), centred on the picture shifted by the inset", () => {
    const d = 4;
    const g = skyGeometry(d, 600, 360, 20);
    near(g.cx, 280);
    near(g.cy, 180);
    near(g.radius, (360 / 2 / Math.tan((36.87 / 2) * DEG)) / Math.sqrt(15), 1e-9);
    expect(g.rhoMax).toBeGreaterThan(1);
  });
  it("is on while the picture reaches well beyond the globe, off when the globe fills it, with a hysteresis", () => {
    expect(skyWanted(false, 2.1)).toBe(true);
    expect(skyWanted(true, 1.0)).toBe(false);
    const mid = SKY.onRho.rho;
    expect(skyWanted(true, mid)).toBe(true);
    expect(skyWanted(false, mid)).toBe(false);
    expect(skyWanted(false, mid + SKY.onRho.band)).toBe(true);
    expect(skyWanted(true, mid - SKY.onRho.band)).toBe(false);
  });
  it("the whole-globe view on desktop and on a phone has sky; a city-scale view has none", () => {
    const fit = (w: number, h: number) => skyGeometry(1 + 0.5 / 0.25, w, h, 0);
    expect(fit(576, 360).rhoMax).toBeGreaterThan(0);
    // d = 1 + 1 / 3 makes the globe fill most of the picture (radius ~ f / sqrt(d^2 - 1) = 1.5 H / 1.17)
    const zoomed = skyGeometry(1.03, 576, 360, 0);
    expect(zoomed.rhoMax).toBeLessThan(SKY.onRho.rho - SKY.onRho.band);
  });
});
