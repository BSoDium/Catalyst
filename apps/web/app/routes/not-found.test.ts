import { describe, expect, it } from "vitest";
import routes from "~/routes";
import { loader } from "./not-found";

describe("the catch-all route", () => {
  it("answers 404, so the root boundary draws the not-found page with the root loader's data", () => {
    let thrown: { init?: { status?: number } } | undefined;
    try {
      loader();
    } catch (e) {
      thrown = e as typeof thrown;
    }
    expect(thrown?.init?.status).toBe(404);
  });

  it("is the last route, after every real address", () => {
    const list = routes as unknown as { path?: string }[];
    expect(list[list.length - 1]?.path).toBe("*");
  });
});
