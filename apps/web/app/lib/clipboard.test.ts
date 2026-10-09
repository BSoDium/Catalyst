import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, shareUrl } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());

describe("copyText", () => {
  it("uses the Clipboard API when it exists", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });
  it("falls back to execCommand when the API is missing", async () => {
    const area = { value: "", style: { cssText: "" }, setAttribute: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn(), remove: vi.fn() };
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", { createElement: () => area, body: { appendChild: vi.fn() }, execCommand, activeElement: null });
    expect(await copyText("hello")).toBe(true);
    expect(area.value).toBe("hello");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(area.remove).toHaveBeenCalled();
  });
  it("falls back when the API rejects, and reports a failure without throwing", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    vi.stubGlobal("document", undefined);
    expect(await copyText("x")).toBe(false);
  });
  it("reports false when the fallback refuses", async () => {
    const area = { value: "", style: { cssText: "" }, setAttribute: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", { createElement: () => area, body: { appendChild: vi.fn() }, execCommand: () => false, activeElement: null });
    expect(await copyText("x")).toBe(false);
  });
});

describe("shareUrl", () => {
  it("joins the origin and the path without a double slash", () => {
    expect(shareUrl("https://example.org/", "/articles/a")).toBe("https://example.org/articles/a");
    expect(shareUrl("https://example.org", "/articles/a")).toBe("https://example.org/articles/a");
  });
});
