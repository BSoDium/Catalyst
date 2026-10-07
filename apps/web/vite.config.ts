import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { devAllowedHosts, resolveDevHost } from "./scripts/dev-host.mjs";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: { alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) } },
  // Dev server only (builds ignore `server`). Reachable from a phone on the LAN or the tailnet unless CATALYST_DEV_HOST=localhost;
  // the Host names it accepts are in scripts/dev-host.mjs. HMR needs no setting: the client connects back to the page's own host.
  server: { port: 5173, strictPort: true, host: resolveDevHost(process.env).host, allowedHosts: devAllowedHosts(process.env, [hostname()]) },
});
