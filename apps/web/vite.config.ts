import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import { devAllowedHosts, resolveDevHost } from "./scripts/dev-host.mjs";

/**
 * Chrome DevTools asks every page for `/.well-known/appspecific/com.chrome.devtools.json` (its workspace feature). No route matches, and the dev server
 * logged a full 404 error with its stack for each request. Answered empty here, before the router (dev server only: `configureServer` is not run by builds).
 */
const quietDevtoolsProbe = (): Plugin => ({
  name: "quiet-devtools-probe",
  configureServer(server) {
    server.middlewares.use("/.well-known/appspecific/com.chrome.devtools.json", (_req, res) => {
      res.statusCode = 204;
      res.end();
    });
  },
});

export default defineConfig({
  plugins: [quietDevtoolsProbe(), tailwindcss(), reactRouter()],
  // The dependencies the client reaches only through lazy imports (the globe, the street map, the activity picture, the animation and icon libraries) are declared, so
  // the dev server bundles them at start. Found on demand, each wave re-optimised, reloaded the page and answered the open one with 504 "Outdated Optimize Dep".
  optimizeDeps: { include: ["motion/react", "clsx", "tailwind-merge", "@radix-ui/react-slot", "lucide-react", "three", "maplibre-gl", "pmtiles", "neon-activity-graph", "neon-activity-graph/react", "neon-activity-graph/layout", "@carbon/icons-react"] },
  resolve: { alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) } },
  // Dev server only (builds ignore `server`). Reachable from a phone on the LAN or the tailnet unless CATALYST_DEV_HOST=localhost;
  // the Host names it accepts are in scripts/dev-host.mjs. HMR needs no setting: the client connects back to the page's own host.
  server: { port: 5173, strictPort: true, host: resolveDevHost(process.env).host, allowedHosts: devAllowedHosts(process.env, [hostname()]) },
});
