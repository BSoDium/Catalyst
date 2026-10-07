import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INSET_EASE, TUNING } from "~/globe/engine/tuning";
import { duration, easeStandard } from "./tokens";

const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");

describe("motion tokens", () => {
  it.each(Object.entries(duration))("%s matches --duration-%s in app.css", (name, seconds) => {
    const match = css.match(new RegExp(`--duration-${name}:\\s*(\\d+)ms`));
    expect(match, `--duration-${name} missing`).not.toBeNull();
    expect(Number(match?.[1]) / 1000).toBe(seconds);
  });
});

describe("globe re-centring", () => {
  it("runs as long as the panel slide and with the same easing", () => {
    expect(TUNING.insetMs / 1000).toBe(duration.slow);
    expect([...INSET_EASE]).toEqual([...easeStandard]);
  });
});
