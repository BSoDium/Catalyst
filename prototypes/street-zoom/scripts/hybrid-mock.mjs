// Hybrid evaluation helper. Takes two screenshots of the same view (Three.js globe and the MapLibre + pixel pass),
// (1) measures the globe disc radius in each to see how well the two cameras register, and
// (2) composes a dither-dissolve at 50% between them (art-pixel cells, Bayer thresholds) to judge the look of a crossfade.
// usage: node scripts/hybrid-mock.mjs three.png ours.png out.png [cellDevicePx=6] [coverage=0.5]
import { readFileSync, writeFileSync } from "node:fs";
import { launch } from "./lib.mjs";

const [a, b, out, cell = "6", cov = "0.5"] = process.argv.slice(2);
const { browser, page } = await launch({ w: 800, h: 600, dpr: 1 });
try {
  await page.goto("about:blank");
  const res = await page.evaluate(
    async ([A, B, cell, cov]) => {
      const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
      const [ia, ib] = await Promise.all([load(A), load(B)]);
      const w = ia.width, h = ia.height;
      const get = (img) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h); };
      const da = get(ia), db = get(ib);
      // disc extents: brightest-ish pixels along the row at 55% height, outside the control panel (x > 0.3w)
      const extent = (d) => {
        const y = Math.floor(h * 0.55); let lo = -1, hi = -1;
        for (let x = Math.floor(w * 0.2); x < w; x++) { const i = (y * w + x) * 4; if (d.data[i] > 60) { if (lo < 0) lo = x; hi = x; } }
        return { lo, hi, radius: (hi - lo) / 2 };
      };
      const bayer = (x, y) => { const aa = x & 7, bb = (x ^ y) & 7; let v = 0; for (let i = 0; i < 3; i++) v = (v << 2) | (((bb >> (2 - i)) & 1) << 1) | ((aa >> (2 - i)) & 1); return ((v & 1) << 5) | ((v & 2) << 3) | ((v & 4) << 1) | ((v & 8) >> 1) | ((v & 16) >> 3) | ((v & 32) >> 5); };
      const o = document.createElement("canvas"); o.width = w; o.height = h; const ox = o.getContext("2d"); const od = ox.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
        const useB = cov > (bayer(cx, cy) + 0.5) / 64;
        const src = useB ? db : da; const i = (y * w + x) * 4;
        od.data[i] = src.data[i]; od.data[i + 1] = src.data[i + 1]; od.data[i + 2] = src.data[i + 2]; od.data[i + 3] = 255;
      }
      ox.putImageData(od, 0, 0);
      return { three: extent(da), ours: extent(db), png: o.toDataURL("image/png") };
    },
    [`data:image/png;base64,${readFileSync(a).toString("base64")}`, `data:image/png;base64,${readFileSync(b).toString("base64")}`, Number(cell), Number(cov)],
  );
  writeFileSync(out, Buffer.from(res.png.split(",")[1], "base64"));
  console.log(JSON.stringify({ three: res.three, ours: res.ours, radiusRatio: +(res.ours.radius / res.three.radius).toFixed(4) }));
} finally {
  await browser.close();
}
