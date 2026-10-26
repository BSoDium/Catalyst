import assert from "node:assert/strict";
import test from "node:test";
import { neutralizeTripPages } from "./trip-pages.mjs";

const PAGE = "https://www.polarsteps.com/bsodium/26802872-balkans";

test("the projection accepts a trip page only as the value of a url key", () => {
  assert.equal(neutralizeTripPages(`{ "url": "${PAGE}" }`, "projection"), `{ "url": "<trip page>" }`);
  // the same address as a free text, or on another key, still names the site
  assert.match(neutralizeTripPages(`{ "summary": "see ${PAGE}" }`, "projection"), /polarsteps/);
  assert.match(neutralizeTripPages(`{ "link": "${PAGE}" }`, "projection"), /polarsteps/);
});

test("a bundle accepts the bare address in whatever form the projection was compiled (literal, escaped JSON, minified)", () => {
  for (const text of [`{url:"${PAGE}"}`, `JSON.parse('{\\"url\\":\\"${PAGE}\\"}')`, `{"url":"${PAGE}","id":"trip-01"}`]) {
    assert.doesNotMatch(neutralizeTripPages(text, "bundle"), /polarsteps/i, text);
  }
});

test("only the one shape is accepted: another host, a profile page, an address with odd characters or the bare word still fail", () => {
  for (const kind of ["projection", "bundle"]) {
    for (const bad of [
      "https://polarsteps.com/bsodium/1-x",
      "https://www.polarsteps.com/bsodium",
      "https://www.polarsteps.com/bsodium/abc",
      "https://www.polarsteps.com/bsodium/1-x?token=1",
      "http://www.polarsteps.com/bsodium/1-x",
      "polarsteps",
      "/api/polarsteps/trips",
    ]) {
      const text = kind === "projection" ? `{ "url": "${bad}" }` : `x="${bad}"`;
      assert.match(neutralizeTripPages(text, kind), /polarsteps/i, `${kind}: ${bad}`);
    }
  }
});

test("every address of a text is neutralised, not only the first", () => {
  assert.equal(neutralizeTripPages(`a ${PAGE} b ${PAGE}`, "bundle"), "a <trip page> b <trip page>");
});
