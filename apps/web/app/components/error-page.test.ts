import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ErrorPage } from "./error-page";

const render = (error: unknown, showDetail = false) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ErrorPage, { error, showDetail })));

describe("ErrorPage", () => {
  it("is a 500 page with a code, a way out and a retry, and nothing of the error", () => {
    const error = new Error("database password is hunter2");
    error.stack = "Error: boom\n    at secret (/srv/app/server.js:1:1)";
    const html = render(error);
    expect(html).toContain("ERR / 500");
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Try again");
    expect(html).toContain('href="/"');
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).not.toContain("hunter2");
    expect(html).not.toContain("/srv/app");
    expect(html).toContain('role="alert"');
  });
  it("reports another error response's own status, without a retry for a client error", () => {
    const html = render({ status: 405, statusText: "Method Not Allowed", data: "no" });
    expect(html).toContain("ERR / 405");
    expect(html).not.toContain("Try again");
    expect(html).not.toContain(">no<");
  });
  it("shows the message (never the stack) to a developer only", () => {
    const error = new Error("visible to devs");
    error.stack = "Error: visible to devs\n    at f (/x.ts:1:1)";
    const html = render(error, true);
    expect(html).toContain("visible to devs");
    expect(html).not.toContain("/x.ts");
  });
});
