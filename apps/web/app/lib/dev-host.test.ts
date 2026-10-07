import { describe, expect, it } from "vitest";
import { devAllowedHosts, isTailscaleIp, lanAddresses, parseTailscaleStatus, portFromArgs, reachableHint, resolveDevHost } from "../../scripts/dev-host.mjs";

describe("dev server bind address", () => {
  it("binds every interface by default", () => {
    for (const env of [{}, { CATALYST_DEV_HOST: "" }, { CATALYST_DEV_HOST: " " }, { CATALYST_DEV_HOST: "all" }, { CATALYST_DEV_HOST: "0.0.0.0" }]) {
      expect(resolveDevHost(env)).toEqual({ host: true, exposed: true });
    }
  });
  it("CATALYST_DEV_HOST=localhost keeps it on this machine", () => {
    for (const v of ["localhost", "127.0.0.1", "::1"]) expect(resolveDevHost({ CATALYST_DEV_HOST: v })).toEqual({ host: v, exposed: false });
  });
  it("any other value is the bind address, and still exposed", () => {
    expect(resolveDevHost({ CATALYST_DEV_HOST: "192.168.1.20" })).toEqual({ host: "192.168.1.20", exposed: true });
  });
});

describe("dev server allowed Host names", () => {
  it("accepts Tailscale, mDNS and LAN names and this machine's own, full and short", () => {
    const hosts = devAllowedHosts({}, ["Mesh.local"]);
    expect(hosts).toEqual(expect.arrayContaining([".ts.net", ".local", ".lan", ".home.arpa", "mesh.local", "mesh"]));
  });
  it("adds CATALYST_DEV_ALLOWED_HOSTS, trimmed, without duplicates", () => {
    const hosts = devAllowedHosts({ CATALYST_DEV_ALLOWED_HOSTS: " dev.example.test , ,.corp.test,.ts.net" });
    expect(hosts).toEqual(expect.arrayContaining(["dev.example.test", ".corp.test"]));
    expect(hosts.filter((h) => h === ".ts.net")).toHaveLength(1);
  });
  it("allows nothing extra when bound to localhost", () => {
    expect(devAllowedHosts({ CATALYST_DEV_HOST: "localhost", CATALYST_DEV_ALLOWED_HOSTS: "x.test" }, ["mesh"])).toEqual([]);
  });
});

describe("startup hint helpers", () => {
  it("reads the port from the react-router arguments", () => {
    expect(portFromArgs(["dev", "--port", "5183"])).toBe(5183);
    expect(portFromArgs(["dev", "--port=5190", "--open"])).toBe(5190);
    expect(portFromArgs(["dev", "-p", "99999"])).toBe(5173);
    expect(portFromArgs([])).toBe(5173);
  });
  it("lists LAN IPv4 addresses only (no loopback, link-local, IPv6 or Tailscale)", () => {
    const nics = {
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      en0: [
        { address: "192.168.1.20", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
        { address: "169.254.3.4", family: "IPv4", internal: false },
      ],
      utun4: [{ address: "100.67.1.2", family: "IPv4", internal: false }],
      en1: [{ address: "10.0.0.7", family: 4, internal: false }],
    };
    expect(lanAddresses(nics)).toEqual(["192.168.1.20", "10.0.0.7"]);
  });
  it("recognises Tailscale's 100.64.0.0/10", () => {
    expect([isTailscaleIp("100.64.0.1"), isTailscaleIp("100.127.255.254"), isTailscaleIp("100.63.0.1"), isTailscaleIp("100.128.0.1"), isTailscaleIp("10.0.0.1")]).toEqual([true, true, false, false, false]);
  });
  it("parses `tailscale status --json`, and says null for anything that is not a running node", () => {
    const json = JSON.stringify({ BackendState: "Running", Self: { DNSName: "mesh.example-tailnet.ts.net.", TailscaleIPs: ["fd7a::1", "100.67.1.2"] } });
    expect(parseTailscaleStatus(json)).toEqual({ ip: "100.67.1.2", dnsName: "mesh.example-tailnet.ts.net" });
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: "Stopped" }))).toBeNull();
    expect(parseTailscaleStatus("not json")).toBeNull();
    expect(parseTailscaleStatus("")).toBeNull();
  });
  it("prints one URL per route and warns about the preview only when it is served", () => {
    const base = { port: 5173, exposed: true, lan: ["192.168.1.20"], tailscale: { ip: "100.67.1.2", dnsName: "mesh.t.ts.net" } };
    const hint = reachableHint({ ...base, content: "preview" });
    expect(hint).toContain("http://192.168.1.20:5173/");
    expect(hint).toContain("http://100.67.1.2:5173/");
    expect(hint).toContain("http://mesh.t.ts.net:5173/");
    expect(hint).toContain("CATALYST_DEV_HOST=localhost");
    expect(reachableHint({ ...base, content: "demo" })).not.toContain("preview");
    expect(reachableHint({ ...base, content: "published", lan: [], tailscale: null })).toContain("no network address");
    expect(reachableHint({ ...base, exposed: false, content: "preview" })).toContain("this machine only");
  });
});
