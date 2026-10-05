// usage: node scripts/probe.mjs "query" "js expression using s (street) and map"
import { launch, open } from "./lib.mjs";
const [query, js] = process.argv.slice(2);
const { browser, page } = await launch({});
try {
  await open(page, query);
  console.log(JSON.stringify(await page.evaluate(`(async()=>{const s=window.__app.street;const map=s.map;${js}})()`), null, 1));
} finally { await browser.close(); }
