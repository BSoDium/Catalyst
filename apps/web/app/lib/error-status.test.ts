import { describe, expect, it } from "vitest";
import { errorStatus } from "./error-status";

describe("errorStatus", () => {
  it("reports an error response's own status", () => {
    expect(errorStatus({ status: 404, statusText: "Not Found", data: null })).toBe(404);
    expect(errorStatus({ status: 405 })).toBe(405);
    expect(errorStatus({ status: 503 })).toBe(503);
  });
  it("is 500 for anything else, including a malformed status", () => {
    expect(errorStatus(new Error("boom"))).toBe(500);
    expect(errorStatus("boom")).toBe(500);
    expect(errorStatus(null)).toBe(500);
    expect(errorStatus({ status: "404" })).toBe(500);
    expect(errorStatus({ status: 200 })).toBe(500);
    expect(errorStatus({ status: 99999 })).toBe(500);
  });
});
