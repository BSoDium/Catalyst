// Experiment for #511 (paused): the dark avatar lit by one hard key light, computed by an SVG lighting filter instead of drawn shadows.
// `node night-light.mjs ../portrait.svg out.svg [azimuth elevation blur scale levels]`, then render with `../render.mjs out.svg out.png dark 2`.
// The figure's shapes (jacket, face, hair) are blurred into a height map, lit by `feDistantLight`, thresholded into a few flat tones and multiplied
// over the picture, clipped to the figure. The height map runs past the frame so the blur does not fall off at the picture's edge.
// Parameters of the version the owner found interesting: 195 26 14 34 0.4,0.4,0.7,1 (light from the left, a little above).
import { readFileSync, writeFileSync } from "node:fs";
const [, , src, out, az = "195", el = "26", blur = "14", scale = "34", levels = "0.4,0.4,0.7,1"] = process.argv;
const svg = readFileSync(src, "utf8");
const d = (id) => svg.match(new RegExp(`<clipPath id="${id}"><path d="([^"]+)"`))[1];
const [face, jacket, hair] = [d("c-face"), d("c-jacket"), d("h-hair")];
const table = (k) => levels.split(",").map((x) => +(parseFloat(x) * k).toFixed(2)).join(" ");
const defs = `
    <clipPath id="c-figure"><path d="${jacket}"/><path d="${face}"/><path d="${hair}"/></clipPath>
    <filter id="lit" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${blur}" result="h"/>
      <feDiffuseLighting in="h" surfaceScale="${scale}" diffuseConstant="1.15" lighting-color="#fff" result="lt"><feDistantLight azimuth="${az}" elevation="${el}"/></feDiffuseLighting>
      <feGaussianBlur in="lt" stdDeviation="3" result="ls"/>
      <feComponentTransfer in="ls"><feFuncR type="discrete" tableValues="${table(1)}"/><feFuncG type="discrete" tableValues="${table(1)}"/><feFuncB type="discrete" tableValues="${table(1.15)}"/></feComponentTransfer>
    </filter>`;
const layer = `<g id="night" clip-path="url(#c-figure)" style="mix-blend-mode:multiply"><g filter="url(#lit)"><path d="${jacket}" fill="#000"/><rect x="-80" y="373" width="80" height="200" fill="#000"/><rect x="500" y="401" width="80" height="200" fill="#000"/><rect x="0" y="500" width="500" height="80" fill="#000"/><path d="${face}" fill="#000"/><path d="${hair}" fill="#000"/></g></g>`;
writeFileSync(out, svg.replace("<defs>", "<defs>" + defs).replace(/(?=<g id="guide-tails")/, layer + "\n    "));
