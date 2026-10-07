import { chromium } from "playwright-core";
// usage: node bench.mjs renderer WxH dpr "extra=query" > out.json
const [kind, size = "1440x900", dpr = "2", extra = ""] = process.argv.slice(2);
const [w, h] = size.split("x").map(Number);
const exe = process.env.CHROME_PATH; // e.g. a Playwright "Chrome for Testing" binary
if (!exe) throw new Error("Set CHROME_PATH to a Chrome/Chromium executable");
const b = await chromium.launch({ executablePath: exe, headless: true, args: ["--use-angle=metal","--ignore-gpu-blocklist","--enable-gpu","--enable-precise-memory-info"] });
const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: Number(dpr) })).newPage();
const thr = Number(process.env.THROTTLE ?? 1);
if (thr > 1) { const c = await p.context().newCDPSession(p); await c.send("Emulation.setCPUThrottlingRate", { rate: thr }); }
p.on("pageerror", (e) => console.error("[pageerror]", e.message));
await p.goto(`http://localhost:5180/?renderer=${kind}&bench=1&dur=10&theme=dark${extra ? "&" + extra : ""}`);
await p.waitForFunction(() => window.__bench, null, { timeout: 120000, polling: 500 });
console.log(JSON.stringify(await p.evaluate(() => window.__bench), null, 1));
await b.close();
