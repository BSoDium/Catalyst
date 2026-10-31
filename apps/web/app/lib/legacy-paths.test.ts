import { describe, expect, it } from "vitest";
import { loader } from "~/routes/legacy-poems";
import { loader as projectsLoader } from "~/routes/legacy-projects";
import { KIND_PATHS } from "./entries";
import { loader as resumeLoader } from "~/routes/legacy-resume";
import { LEGACY_REDIRECT_STATUS, legacyPoemsTarget, legacyProjectsTarget, legacyResumeTarget, withoutDataRequest } from "./legacy-paths";

const answer = async (path: string, method = "GET") => {
  try {
    return (await loader({ request: new Request(`https://v2.bsodium.fr${path}`, { method }) })) as Response;
  } catch (thrown) {
    return thrown as Response;
  }
};

describe("legacyPoemsTarget", () => {
  it("moves the list and every entry under /poetry, the query string kept as it was", () => {
    expect(legacyPoemsTarget("/poems", "")).toBe("/poetry");
    expect(legacyPoemsTarget("/poems/", "")).toBe("/poetry");
    expect(legacyPoemsTarget("/poems", "?tag=night")).toBe("/poetry?tag=night");
    expect(legacyPoemsTarget("/poems", "?tag=night&tag=rain&x=%20y")).toBe("/poetry?tag=night&tag=rain&x=%20y");
    expect(legacyPoemsTarget("/poems/demo-poem", "")).toBe("/poetry/demo-poem");
    expect(legacyPoemsTarget("/poems/demo-poem/", "")).toBe("/poetry/demo-poem");
    expect(legacyPoemsTarget("/poems/demo-poem", "?view=full&tag=y")).toBe("/poetry/demo-poem?view=full&tag=y");
    // the segment goes through as the request carried it (percent-encoding is not touched, nothing is decoded and re-encoded)
    expect(legacyPoemsTarget("/poems/caf%C3%A9", "")).toBe("/poetry/caf%C3%A9");
  });
  it("is the new address of the kind: the target of the list is KIND_PATHS.poem", () => {
    expect(legacyPoemsTarget("/poems", "")).toBe(KIND_PATHS.poem);
  });
  it("leaves every other address alone, and anything deeper than an entry (a 404 before, a 404 now)", () => {
    for (const path of ["/", "/poetry", "/poetry/x", "/articles", "/poem", "/poemsx", "/x/poems", "/poems/a/b", "/poems/a/b/c"]) expect(legacyPoemsTarget(path, ""), path).toBeNull();
  });
  it("never leaves the site: the target always starts with a single slash and /poetry", () => {
    for (const path of ["/poems//evil.example", "/poems/%2F%2Fevil.example", "/poems///", "/poems/..%2f..%2fx"]) {
      const target = legacyPoemsTarget(path, "");
      expect(target, path).toMatch(/^\/poetry(\/[^/]+)?$/);
    }
  });
});

describe("the legacy route's loader", () => {
  it("answers /poems with a permanent redirect to /poetry", async () => {
    const res = await answer("/poems");
    expect(res.status).toBe(LEGACY_REDIRECT_STATUS);
    expect(LEGACY_REDIRECT_STATUS).toBe(301);
    expect(res.headers.get("Location")).toBe("/poetry");
  });
  it("keeps the query on the list and on an entry", async () => {
    expect((await answer("/poems?tag=night")).headers.get("Location")).toBe("/poetry?tag=night");
    const entry = await answer("/poems/demo-poem?view=full");
    expect(entry.status).toBe(301);
    expect(entry.headers.get("Location")).toBe("/poetry/demo-poem?view=full");
  });
  it("carries the security headers and a cache policy, and no body", async () => {
    const res = await answer("/poems/demo-poem");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Cache-Control")).toMatch(/s-maxage=\d+/);
    expect(await res.text()).toBe("");
  });
});

describe("legacyProjectsTarget", () => {
  it("moves the list and every entry under /software, the query string kept as it was", () => {
    expect(legacyProjectsTarget("/projects", "")).toBe("/software");
    expect(legacyProjectsTarget("/projects/", "")).toBe("/software");
    expect(legacyProjectsTarget("/projects", "?tag=rail")).toBe("/software?tag=rail");
    expect(legacyProjectsTarget("/projects", "?tag=rail&tag=web&x=%20y")).toBe("/software?tag=rail&tag=web&x=%20y");
    expect(legacyProjectsTarget("/projects/demo-project", "")).toBe("/software/demo-project");
    expect(legacyProjectsTarget("/projects/demo-project/", "")).toBe("/software/demo-project");
    expect(legacyProjectsTarget("/projects/demo-project", "?view=full&tag=y")).toBe("/software/demo-project?view=full&tag=y");
    expect(legacyProjectsTarget("/projects/caf%C3%A9", "")).toBe("/software/caf%C3%A9");
  });
  it("follows the section's current address", () => {
    expect(legacyProjectsTarget("/projects", "")).toBe(KIND_PATHS.project);
  });
  it("is null for anything else, deeper paths and the poems' old address included", () => {
    for (const path of ["/", "/software", "/software/x", "/articles", "/project", "/projectsx", "/x/projects", "/projects/a/b", "/poems", "/poems/x"]) {
      expect(legacyProjectsTarget(path, ""), path).toBeNull();
    }
    expect(legacyPoemsTarget("/projects", "")).toBeNull();
  });
  it("never leaves the site: the target always starts with a single slash and /software", () => {
    for (const path of ["/projects//evil.example", "/projects/%2F%2Fevil.example", "/projects///", "/projects/..%2f..%2fx"]) {
      expect(legacyProjectsTarget(path, ""), path).toMatch(/^\/software(\/[^/]+)?$/);
    }
  });
});

describe("the projects' legacy route's loader", () => {
  const answerProjects = async (path: string, method = "GET") => {
    try {
      return (await projectsLoader({ request: new Request(`https://v2.bsodium.fr${path}`, { method }) })) as Response;
    } catch (thrown) {
      return thrown as Response;
    }
  };
  it("answers /projects with a permanent redirect to /software", async () => {
    const res = await answerProjects("/projects");
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/software");
  });
  it("keeps the query on the list and on an entry", async () => {
    expect((await answerProjects("/projects?tag=rail")).headers.get("Location")).toBe("/software?tag=rail");
    const entry = await answerProjects("/projects/demo-project?view=full");
    expect(entry.status).toBe(301);
    expect(entry.headers.get("Location")).toBe("/software/demo-project?view=full");
  });
  it("carries the security headers and a cache policy, and no body", async () => {
    const res = await answerProjects("/projects/demo-project");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Cache-Control")).toMatch(/s-maxage=\d+/);
    expect(await res.text()).toBe("");
  });
  it("is a 404 for a shape that is not a legacy one", async () => {
    expect((await answerProjects("/projects/a/b")).status).toBe(404);
  });
});

describe("a client-side navigation to a legacy address (its data request, React Router 8 pass-through)", () => {
  it("redirects to the address, not to the data request's", () => {
    expect(legacyProjectsTarget("/projects/amaze-me.data", "?_routes=routes%2Flegacy-projects")).toBe("/software/amaze-me");
    expect(legacyPoemsTarget("/poems.data", "?tag=a&_routes=routes%2Flegacy-poems")).toBe("/poetry?tag=a");
  });
  it("leaves a document request's query string as it came", () => {
    expect(withoutDataRequest("/projects/x", "?tag=rail&view=full")).toEqual({ pathname: "/projects/x", search: "?tag=rail&view=full" });
  });
});

describe("legacyResumeTarget (the first version's CV)", () => {
  it("moves /resume to the career page, the query string kept", () => {
    expect(legacyResumeTarget("/resume", "")).toBe("/career");
    expect(legacyResumeTarget("/resume/", "")).toBe("/career");
    expect(legacyResumeTarget("/resume", "?x=1")).toBe("/career?x=1");
  });
  it("is null for anything else: deeper paths, other pages, other cases", () => {
    for (const path of ["/resume/a", "/resumes", "/career", "/", "/Resume", "/projects"]) expect(legacyResumeTarget(path, ""), path).toBeNull();
  });
  it("follows a client-side navigation's data request", () => {
    expect(legacyResumeTarget("/resume.data", "?_routes=routes%2Flegacy-resume")).toBe("/career");
  });
  it("is answered by the route with a permanent redirect, the security headers and a cache policy, and a 404 for any other shape", async () => {
    const res = (await resumeLoader({ request: new Request("https://bsodium.fr/resume?x=1") })) as Response;
    expect(res.status).toBe(LEGACY_REDIRECT_STATUS);
    expect(res.headers.get("Location")).toBe("/career?x=1");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Cache-Control")).toMatch(/s-maxage=\d+/);
    let thrown: unknown;
    try {
      await resumeLoader({ request: new Request("https://bsodium.fr/resume/a/b") });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as Response).status).toBe(404);
  });
});
