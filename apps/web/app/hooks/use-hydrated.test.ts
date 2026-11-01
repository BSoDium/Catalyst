import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useHydrated } from "./use-hydrated";

describe("useHydrated", () => {
  it("is false in the server render (and so in the hydration pass), where a history entry's state is not known", () => {
    const Probe = () => createElement("span", null, String(useHydrated()));
    expect(renderToString(createElement(Probe))).toContain(">false<");
  });
});
