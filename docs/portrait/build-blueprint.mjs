import { readFileSync, writeFileSync } from "node:fs";
const [, , src, out] = process.argv;
const svg = readFileSync(src, "utf8");
const get = (id) => svg.match(new RegExp(`id="${id}"\\s+d="([^"]+)"`))[1];

// seeded pen: same drawing every run
let s = 7;
const rnd = () => ((s = (s + 0x6d2b79f5) | 0), (((t) => ((t ^ (t >>> 15)) * (1 | t)))(s) >>> 0) / 4294967296);
const range = (a, b) => a + rnd() * (b - a);
const f = (n) => +n.toFixed(1);
// mostly a short flick, now and then a long one
const flick = (cap) => Math.min(rnd() < 0.3 ? range(20, 44) : range(4, 16), cap);

function parse(d) {
  const tk = d.match(/[MLHVCZ]|-?\d*\.?\d+/g);
  const segs = [];
  let i = 0, cur = [0, 0], start = [0, 0];
  const num = () => parseFloat(tk[i++]);
  let cmd;
  while (i < tk.length) {
    if (/[A-Z]/.test(tk[i])) cmd = tk[i++];
    if (cmd === "M") { cur = start = [num(), num()]; cmd = "L"; continue; }
    if (cmd === "Z") { if (cur[0] !== start[0] || cur[1] !== start[1]) segs.push({ a: cur, b: start }); cur = start; continue; }
    let n;
    if (cmd === "L") n = [num(), num()];
    else if (cmd === "H") n = [num(), cur[1]];
    else if (cmd === "V") n = [cur[0], num()];
    else if (cmd === "C") { const c1 = [num(), num()], c2 = [num(), num()]; n = [num(), num()]; segs.push({ a: cur, c1, c2, b: n }); cur = n; continue; }
    segs.push({ a: cur, b: n }); cur = n;
  }
  if (cur[0] !== start[0] || cur[1] !== start[1]) segs.push({ a: cur, b: start });
  return segs;
}
const unit = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const tin = (g) => unit(sub(g.b, g.c2 && (g.c2[0] !== g.b[0] || g.c2[1] !== g.b[1]) ? g.c2 : g.c1 || g.a));
const tout = (g) => unit(sub(g.c1 && (g.c1[0] !== g.a[0] || g.c1[1] !== g.a[1]) ? g.c1 : g.c2 || g.b, g.a));
const len = (g) => Math.hypot(...sub(g.b, g.a));
// a segment lying on the frame (the shirt's hem sits 0.5 unit above it) is not penned: it would double the frame's own line
const onEdge = (g) => [0, 1].some((k) => [0, 500].some((e) => Math.abs(g.a[k] - e) <= 1 && Math.abs(g.b[k] - e) <= 1));

// An overshoot is its own path with a gradient stroke: solid at the corner, fading to nothing at its tip, so it vanishes softly.
const fades = [];
const P = (q) => `${f(q[0])} ${f(q[1])}`;
// the face's own marks: an overshoot stops short of them rather than cutting through (it would break the illusion)
const KEEP_OUT = [[172, 116, 206, 164], [222, 116, 258, 164], [180, 142, 202, 194], [198, 196, 235, 216], [270, 170, 306, 198]];
function tail(from, to, w, ink = "--line") {
  const L = Math.hypot(to[0] - from[0], to[1] - from[1]);
  for (let i = 1; i <= 60; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / 60, y = from[1] + ((to[1] - from[1]) * i) / 60;
    if (KEEP_OUT.some(([x0, y0, x1, y1]) => x > x0 && x < x1 && y > y0 && y < y1)) {
      const keep = (L * i) / 60 - 6;
      if (keep < 4) return "";
      to = [from[0] + ((to[0] - from[0]) * keep) / L, from[1] + ((to[1] - from[1]) * keep) / L];
      break;
    }
  }
  const id = `fade-${fades.length}`;
  fades.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(from[0])}" y1="${f(from[1])}" x2="${f(to[0])}" y2="${f(to[1])}"><stop offset="0" style="stop-color:var(${ink})" /><stop offset=".25" style="stop-color:var(${ink})" /><stop offset="1" style="stop-color:var(${ink});stop-opacity:0" /></linearGradient>`);
  return `<path d="M${P(from)}L${P(to)}" style="stroke:url(#${id});stroke-width:${w}" />`;
}

// one hand-drawn run of segments, overshooting past both corners
function pen(run, over) {
  const first = run[0], last = run[run.length - 1];
  const w = f(range(2.3, 3.1));
  let d = `M${P(first.a)}`;
  for (const g of run) {
    if (g.c1) d += `C${P([g.c1[0] + range(-.9, .9), g.c1[1] + range(-.9, .9)])} ${P([g.c2[0] + range(-.9, .9), g.c2[1] + range(-.9, .9)])} ${P(g.b)}`;
    else if (len(g) > 45) {
      const m = [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2], n = unit([-(g.b[1] - g.a[1]), g.b[0] - g.a[0]]), k = range(-1.6, 1.6);
      d += `Q${P([m[0] + n[0] * k, m[1] + n[1] * k])} ${P(g.b)}`;
    } else d += `L${P(g.b)}`;
  }
  let out = `<path d="${d}" style="stroke-width:${w}" />`;
  if (over) {
    const o1 = flick(len(first) * 0.9 + 2), t1 = tout(first), o2 = flick(len(last) * 0.9 + 2), t2 = tin(last);
    out += tail(first.a, [first.a[0] - t1[0] * o1, first.a[1] - t1[1] * o1], w);
    out += tail(last.b, [last.b[0] + t2[0] * o2, last.b[1] + t2[1] * o2], w);
  }
  return out;
}

function outline(d) {
  const segs = parse(d), n = segs.length;
  const cut = segs.map((g, i) => {
    const prev = segs[(i + n - 1) % n];
    if (onEdge(g) || onEdge(prev)) return true;
    const a = tin(prev), b = tout(g);
    return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) > 0.44;
  });
  const real = segs.map((g, i) => ({ g, i })).filter(({ g }) => !onEdge(g));
  if (!cut.some(Boolean)) return pen(segs, false).replace("<path d=\"", "<path d=\"").replace(/" style/, 'Z" style');
  let k = segs.findIndex((_, i) => cut[i]), out = [], run = [];
  for (let c = 0; c < n; c++) {
    const i = (k + c) % n;
    if (cut[i] && run.length) { out.push(run); run = []; }
    if (!onEdge(segs[i])) run.push(segs[i]);
  }
  if (run.length) out.push(run);
  return out.map((r) => pen(r, true)).join("\n      ");
}

const F = 0; // the frame is the 500-unit square; the pen runs past it into the margin (MX at the sides, MY above and below)
const MX = 220, MY = 70; // the margin the pen may run into: wide at the sides, short above and below
const ids = ["jacket", "neck", "collar", "shirt", "head", "chin-shadow", "hair"];
const D = Object.fromEntries(ids.map((i) => [i, get(i)]));
const open = (id) => svg.match(new RegExp(`<path id="${id}"[^>]*?d="([^"]+)"`))[1];

// Construction lines: each one is the prolongation of a straight edge of the drawing (the slanted edge of a shoulder, the long side of the face,
// the neck, the shirt, the hair, an eye, the nose bridge...), run right across the frame, then a short way out of it and faded.
const EDGES = [
  [[0, 373.5], [54.1249, 311.165]], // left shoulder
  [[500, 401.276], [406.747, 298.198]], // right shoulder
  [[187, 81.5], [156.5, 175]], // the face's left side
  [[186.5, 343.5], [195.5, 246]], // the neck's left side
  [[279.5, 338], [279.5, 499.5]], // the shirt's right edge
  [[171.5, 499.5], [186.5, 343.5]], // the shirt's left edge
  [[278.5, 256], [142.027, 266.803]], // the jacket's edge at the neck
  [[195.5, 246], [280, 233]], // the line of the chin
  [[181.5, 60.5], [276, 56.5]], // the top of the hair
  [[313.5, 84.5], [329.5, 126]], // the back of the hair
  [[185, 140], [184, 159]], // the left eye
  [[234, 140], [233, 159]], // the right eye
  [[194.709, 146], [187.209, 181.5]], // the nose bridge
];
// (the old free-hand guides drew 44 numbers from the pen; they are spent here so that the outlines and the frame keep the drawing they had)
for (let i = 0; i < 44; i++) rnd();
let gs = 23;
const grnd = () => ((gs = (gs + 0x6d2b79f5) | 0), (((t) => ((t ^ (t >>> 15)) * (1 | t)))(gs) >>> 0) / 4294967296);
const gr = (a, b) => a + grnd() * (b - a);
const inner = [], outer = [];
for (const [a, b] of EDGES) {
  const u = unit([b[0] - a[0], b[1] - a[1]]);
  // where the line is inside the 500-unit frame (slab method)
  let t0 = -Infinity, t1 = Infinity;
  for (const k of [0, 1]) {
    if (Math.abs(u[k]) < 1e-9) continue;
    const s = [(0 - a[k]) / u[k], (500 - a[k]) / u[k]].sort((x, y) => x - y);
    t0 = Math.max(t0, s[0]); t1 = Math.min(t1, s[1]);
  }
  const at = (t) => [a[0] + u[0] * t, a[1] + u[1] * t];
  inner.push(`<path d="M${P(at(t0))}L${P(at(t1))}" />`);
  // out of the frame by the side it leaves through: far past the sides, a little past the top and the bottom (always less than the frame's own lines)
  for (const [t, dir] of [[t0, -1], [t1, 1]]) {
    const e = at(t), sideExit = e[0] < 1 || e[0] > 499, len = sideExit ? gr(35, 95) : gr(10, 28);
    const o = [e[0] + u[0] * dir * len, e[1] + u[1] * dir * len];
    outer.push(tail(e, o, 1.5, "--frame"));
  }
}
const G = inner.join("\n      ");
const guideTails = outer.join("\n      ");

const FACE = `${D.head} ${D.neck}`;
const r = (a) => a;
// the frame is dead straight (never skewed) and its lines run well past the corners
const side = (x1, y1, x2, y2) => {
  const t = unit([x2 - x1, y2 - y1]), reach = y1 === y2 ? [90, 205] : [20, 58], a = range(...reach), b = range(...reach), w = f(range(2.3, 3));
  return `<path d="M${P([x1, y1])}L${P([x2, y2])}" style="stroke-width:${w}" />${tail([x1, y1], [x1 - t[0] * a, y1 - t[1] * a], w, "--frame")}${tail([x2, y2], [x2 + t[0] * b, y2 + t[1] * b], w, "--frame")}`;
};
const frame = [
  side(F, F, 500 - F, F), side(500 - F, F, 500 - F, 500 - F), side(500 - F, 500 - F, F, 500 - F), side(F, 500 - F, F, F),
].join("\n      ");

const pens = {};
for (const i of ids) pens[i] = `<g id="pen-${i}" class="pen">\n      ${outline(D[i])}\n      </g>`;
// the shirt's hem sits on the frame: it is penned apart, above the frame, in the figure's own line colour
const hem = parse(D.shirt).find(onEdge);
const penHem = hem ? pen([hem], true) : "";

// Hatching: plain slanted lines at equal intervals, as the paper study has them.
const clips = [];
function hatch(id, d, { angle = -62, gap = 5, w = 1.5 } = {}) {
  const pts = parse(d).flatMap((g) => [g.a, g.b, ...(g.c1 ? [g.c1, g.c2] : [])]);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const R = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 4;
  const a = (angle * Math.PI) / 180, u = [Math.cos(a), Math.sin(a)], n = [-u[1], u[0]], lines = [];
  for (let k = -R; k < R; k += gap) {
    const c = [cx + n[0] * k, cy + n[1] * k];
    lines.push(`<path d="M${P([c[0] - u[0] * R, c[1] - u[1] * R])}L${P([c[0] + u[0] * R, c[1] + u[1] * R])}" />`);
  }
  clips.push(`<clipPath id="h-${id}"><path d="${d}" /></clipPath>`);
  return `<g class="hatch hatch-${id}" style="stroke-width:${w}" clip-path="url(#h-${id})">\n      ${lines.join("\n      ")}\n    </g>`;
}
const hHair = hatch("hair", D.hair, { gap: 5.5, w: 1.7 });
const hShade = hatch("shade", D["chin-shadow"], { gap: 4, w: 1.4 });
const hShirt = hatch("shirt", D.shirt, { gap: 7, w: 1.6 });

const result = `<svg width="${500 + 2 * MX}" height="${500 + 2 * MY}" viewBox="${-MX} ${-MY} ${500 + 2 * MX} ${500 + 2 * MY}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Blueprint: the same figure, redrawn as if penned by hand over a construction sketch. The picture has a frame of its own (no
       border or background is added by the page) whose lines cross at the corners. Every outline is a run of pen strokes that
       overshoots a little past each corner and fades out; the hair, the chin's shadow and the shirt are hatched, not solid. Each
       shape's outline is drawn right after its fill, so what lies in front hides it (no line shows through the hair). Generated by
       docs/portrait/build-blueprint.mjs (a seeded pen: the same drawing every run). -->
  <style>
    /* Monochrome greys; the blues are the jacket and the faintly blue skin. The pen's blue-grey sits close to the ground, never black. */
    :root { --bg: #eeeeee; --skin: #86b4ec; --jacket: #1a88e0; --shirt: #4a4a4a; --collar: #ffffff; --ink: #0a0a0a; --mark: #0a0a0a;
            --hair: #3a4a60; --hatch-hair: #0a0a0a; --shade: #5f8fcb; --hatch-shade: #3d6aa3; --hatch-shirt: #2e2e2e;
            --line: #5b6d85; --frame: #d8d8d8; --g-bg: #cdcdcd; --g-skin: #6ea2e2; --g-jacket: #4aa6ee; --g-shirt: #6a6a6a; }
    @media (prefers-color-scheme: dark) { :root { --bg: #161616; --skin: #4f6f96; --jacket: #135086; --shirt: #262626; --collar: #bdbdbd; --ink: #050505; --mark: #eef3f9;
            --hair: #26364a; --hatch-hair: #0a1018; --shade: #3d5a7e; --hatch-shade: #2c4560; --hatch-shirt: #3a3a3a;
            --line: #8398b3; --frame: #313131; --g-bg: #333333; --g-skin: #7f9fc6; --g-jacket: #2a72b4; --g-shirt: #3f3f3f; } }
    .bg { fill: var(--bg) } .skin { fill: var(--skin) } .jacket { fill: var(--jacket) } .shirt { fill: var(--shirt) } .collar { fill: var(--collar) }
    .hair { fill: var(--hair) } .shade { fill: var(--shade) }
    path[stroke] { stroke: var(--mark) }
    .pen path { stroke: var(--line); stroke-linecap: round; stroke-linejoin: round; fill: none }
    #pen-frame path { stroke: var(--frame) }
    .hatch { stroke-linecap: round; fill: none }
    .hatch-hair { stroke: var(--hatch-hair) } .hatch-shade { stroke: var(--hatch-shade) } .hatch-shirt { stroke: var(--hatch-shirt) }
    .guides { stroke-width: 1.5; stroke-linecap: round; fill: none }
    .g-bg { stroke: var(--g-bg) } .g-skin { stroke: var(--g-skin) } .g-jacket { stroke: var(--g-jacket) } .g-shirt { stroke: var(--g-shirt) }
  </style>
  <defs>
    ${fades.join("\n    ")}
    ${clips.join("\n    ")}
    <clipPath id="c-frame"><rect x="${F}" y="${F}" width="${500 - 2 * F}" height="${500 - 2 * F}" /></clipPath>
    <clipPath id="c-face"><path d="${FACE}" /></clipPath>
    <clipPath id="c-jacket"><path d="${D.jacket}" /></clipPath>
    <clipPath id="c-shirt"><path d="${D.shirt}" /></clipPath>
    <g id="guide-lines">
      ${G}
    </g>
  </defs>
  <g id="model">
    <g id="picture" clip-path="url(#c-frame)">
    <rect width="500" height="500" class="bg" />
    <g class="guides g-bg"><use href="#guide-lines" /></g>
    <path id="jacket" d="${D.jacket}" class="jacket" />
    <g class="guides g-jacket" clip-path="url(#c-jacket)"><use href="#guide-lines" /></g>
    ${pens.jacket}
    <path id="neck" d="${D.neck}" class="skin" />
    ${pens.neck}
    <path id="collar" d="${D.collar}" class="collar" />
    ${pens.collar}
    <path id="shirt" d="${D.shirt}" class="shirt" />
    ${hShirt}
    <g class="guides g-shirt" clip-path="url(#c-shirt)"><use href="#guide-lines" /></g>
    ${pens.shirt}
    <path id="head" d="${D.head}" class="skin" />
    <g class="guides g-skin" clip-path="url(#c-face)"><use href="#guide-lines" /></g>
    ${pens.head}
    <path id="chin-shadow" d="${D["chin-shadow"]}" class="shade" />
    ${hShade}
    ${pens["chin-shadow"]}
    <g id="eyes">
      <path id="eye-right" d="M234 140L233 159" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
      <path id="eye-left" d="M185 140L184 159" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
      <path id="eyebrow-left" d="M177.5 130.5C183.5 122.5 191.5 121.5 200.5 125" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
      <path id="eyebrow-right" d="M252 136C251 124 235.5 121.072 227 126.032" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
    </g>
    <path id="nose" d="${open("nose")}" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
    <path id="mouth" d="${open("mouth")}" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
    <path id="hair" d="${D.hair}" class="hair" />
    ${hHair}
    ${pens.hair}
    <path id="ear" d="${open("ear")}" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
    </g>
    <g id="pen-frame" class="pen">
      ${frame}
    </g>
    <g id="pen-hem" class="pen" clip-path="url(#c-frame)">
      ${penHem}
    </g>
    <g id="guide-tails" class="guides">
      ${guideTails}
    </g>
  </g>
</svg>
`;
writeFileSync(out, result);
