// Who can reach `pnpm dev`. Pure helpers (unit-tested in app/lib/dev-host.test.ts) shared by vite.config.ts (the bind address
// and the Host header allow-list) and dev.mjs (the startup hint). Development only: `server.*` is ignored by builds.
//
// Default: bind every interface, so a phone on the LAN or the tailnet can open the dev server (performance testing).
// Opt out with CATALYST_DEV_HOST=localhost (or 127.0.0.1, ::1): nothing but this machine can connect. Any other value is
// used as the bind address as is (one interface's IP). Vite rejects a Host header it does not know (DNS rebinding), and
// answers IP literals and localhost only, so the names of other devices' routes are allowed here: Tailscale MagicDNS,
// mDNS, common LAN suffixes, this machine's own hostname, plus CATALYST_DEV_ALLOWED_HOSTS (comma separated, a leading dot
// allows a domain and its subdomains).

export const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];
/** Domains no one else can register or point at this machine: Tailscale's names, mDNS, the usual home-router suffixes. */
export const LAN_SUFFIXES = [".ts.net", ".local", ".lan", ".home.arpa"];

const clean = (v) => (v ?? "").trim();

/**
 * The `server.host` value of Vite: `true` (all interfaces) or an address.
 * @param {Record<string, string | undefined>} env
 * @returns {{ host: string | true, exposed: boolean }}
 */
export function resolveDevHost(env) {
  const v = clean(env.CATALYST_DEV_HOST);
  if (!v || v === "all" || v === "0.0.0.0" || v === "::") return { host: true, exposed: true };
  return { host: v, exposed: !LOCAL_HOSTS.includes(v) };
}

/**
 * `server.allowedHosts`: names accepted in the Host header besides localhost and IP addresses (which Vite always accepts).
 * Empty when the server is bound to localhost only.
 * @param {Record<string, string | undefined>} env
 * @param {string[]} [machineNames] this machine's hostname (`os.hostname()`)
 * @returns {string[]}
 */
export function devAllowedHosts(env, machineNames = []) {
  if (!resolveDevHost(env).exposed) return [];
  const extra = clean(env.CATALYST_DEV_ALLOWED_HOSTS).split(",").map(clean).filter(Boolean);
  const own = machineNames.map((n) => clean(n).toLowerCase()).filter(Boolean);
  // a bare name ("mesh") is what `tailscale`, mDNS and the router answer to as well as the full one ("mesh.local")
  const short = own.map((n) => n.split(".")[0]);
  return [...new Set([...LAN_SUFFIXES, ...own, ...short, ...extra])];
}

/**
 * The port a `react-router dev` argument list asks for, or `fallback`.
 * @param {string[]} args
 * @param {number} [fallback]
 */
export function portFromArgs(args, fallback = 5173) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const v = a === "--port" || a === "-p" ? args[i + 1] : a.startsWith("--port=") ? a.slice(7) : undefined;
    const n = Number(v);
    if (v !== undefined && Number.isInteger(n) && n > 0 && n < 65536) return n;
  }
  return fallback;
}

/**
 * IPv4 addresses of the network interfaces this machine has, loopback and link-local excluded, Tailscale's 100.64.0.0/10
 * kept apart (labelled by its own line). Takes the `os.networkInterfaces()` object.
 * @param {Record<string, { address: string, family: string | number, internal: boolean }[] | undefined>} interfaces
 * @returns {string[]}
 */
export function lanAddresses(interfaces) {
  const out = [];
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      const v4 = i.family === "IPv4" || i.family === 4;
      if (v4 && !i.internal && !i.address.startsWith("169.254.") && !isTailscaleIp(i.address)) out.push(i.address);
    }
  }
  return [...new Set(out)];
}

/** Tailscale hands out 100.64.0.0/10 (CGNAT) addresses. */
export function isTailscaleIp(ip) {
  const m = /^100\.(\d+)\.\d+\.\d+$/.exec(ip);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

/**
 * What `tailscale status --json` says about this machine: its IPv4 address and MagicDNS name, or null when it is not
 * connected (stopped, logged out, no JSON).
 * @param {string} json
 * @returns {{ ip: string | null, dnsName: string | null } | null}
 */
export function parseTailscaleStatus(json) {
  try {
    const s = JSON.parse(json);
    if (s?.BackendState !== "Running") return null;
    const ips = Array.isArray(s.Self?.TailscaleIPs) ? s.Self.TailscaleIPs : s.TailscaleIPs;
    const ip = (ips ?? []).find((a) => typeof a === "string" && isTailscaleIp(a)) ?? null;
    const dnsName = typeof s.Self?.DNSName === "string" && s.Self.DNSName ? s.Self.DNSName.replace(/\.$/, "") : null;
    return ip || dnsName ? { ip, dnsName } : null;
  } catch {
    return null;
  }
}

/**
 * The startup hint: where another device can open the dev server. One line per route, then what the content mode exposes.
 * @param {{ port: number, exposed: boolean, content: string, lan: string[], tailscale: { ip: string | null, dnsName: string | null } | null }} input
 * @returns {string}
 */
export function reachableHint({ port, exposed, content, lan, tailscale }) {
  if (!exposed) return `[catalyst] dev server: this machine only (CATALYST_DEV_HOST); unset it to test on a phone.`;
  const lines = ["[catalyst] dev server reachable from other devices:"];
  for (const ip of lan) lines.push(`  LAN        http://${ip}:${port}/`);
  if (tailscale?.ip) lines.push(`  Tailscale  http://${tailscale.ip}:${port}/`);
  if (tailscale?.dnsName) lines.push(`  Tailscale  http://${tailscale.dnsName}:${port}/`);
  if (lan.length === 0 && !tailscale) lines.push("  (no network address found)");
  if (content === "preview") lines.push("  The preview (your real places, drafts included) is served to anyone who reaches this port; on an untrusted network use CATALYST_DEV_HOST=localhost.");
  return lines.join("\n");
}
