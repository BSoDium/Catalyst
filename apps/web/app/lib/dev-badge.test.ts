import { describe, expect, it } from "vitest";
import { devBadgeLabel } from "~/lib/dev-badge";

describe("dev content note", () => {
  it("labels preview and demo in dev builds only", () => {
    expect(devBadgeLabel("preview", true)).toBe("PREVIEW · local data · not published");
    expect(devBadgeLabel("demo", true)).toBe("DEMO · placeholder data");
    expect(devBadgeLabel("published", true)).toBeNull();
    expect(devBadgeLabel(null, true)).toBeNull();
    expect(devBadgeLabel(undefined, true)).toBeNull();
    expect(devBadgeLabel("preview", false)).toBeNull();
    expect(devBadgeLabel("demo", false)).toBeNull();
  });
});
