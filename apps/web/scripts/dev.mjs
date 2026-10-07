// `pnpm dev`: the dev server with the right content mode (see scripts/dev-content.mjs) and a hint of where other devices can reach
// it (scripts/dev-host.mjs; the bind address and allowed hosts are in vite.config.ts). Extra args go to `react-router dev`,
// e.g. `pnpm dev --port 5180`.
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { devArgs, resolveDevContent } from "./dev-content.mjs";
import { lanAddresses, parseTailscaleStatus, portFromArgs, reachableHint, resolveDevHost } from "./dev-host.mjs";

const previewFile = fileURLToPath(new URL("../../../packages/published/data/preview.projection.json", import.meta.url));
const { content, message } = resolveDevContent({ env: process.env, previewExists: existsSync(previewFile) });
if (message) console.log(message);

const args = devArgs(process.argv.slice(2));
const { exposed } = resolveDevHost(process.env);

/** This machine's Tailscale identity, or null when `tailscale` is not installed, not running or slow (never an error). */
function tailscale() {
  try {
    return parseTailscaleStatus(execFileSync("tailscale", ["status", "--json"], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
}
console.log(reachableHint({ port: portFromArgs(args), exposed, content, lan: lanAddresses(networkInterfaces()), tailscale: exposed ? tailscale() : null }));

const child = spawn("react-router", args, {
  stdio: "inherit",
  env: { ...process.env, CATALYST_CONTENT: content },
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
