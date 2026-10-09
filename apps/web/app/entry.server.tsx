import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import type { EntryContext, HandleDataRequestFunction, HandleErrorFunction } from "react-router";
import { ServerRouter } from "react-router";
import { applyDataHeaders, applyDocumentHeaders, createNonce, isCacheableData, originOf, parseOrigins } from "~/lib/security-headers";
import { isIndexableRequest } from "~/lib/site.server";
import { getTilesConfig } from "~/lib/tiles-config.server";

export const streamTimeout = 5_000;

const isDev = import.meta.env.DEV;

/** The hosts the browser may fetch tiles from: what `getTilesConfig()` says (read at request time, like the config itself) plus `CATALYST_CSP_CONNECT_EXTRA`. */
function connectOrigins(): string[] {
  const tiles = getTilesConfig();
  return [originOf(tiles.primaryUrl), originOf(tiles.fallbackPmtilesUrl), ...parseOrigins(process.env.CATALYST_CSP_CONNECT_EXTRA)].filter((o): o is string => o !== null);
}

/** `https` when the page was reached over it (Vercel's proxy says so in `x-forwarded-proto`): only then `upgrade-insecure-requests` makes sense. */
const cameOverHttps = (request: Request) => (request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? new URL(request.url).protocol.replace(":", "")) === "https";

export default function handleRequest(request: Request, responseStatusCode: number, responseHeaders: Headers, routerContext: EntryContext) {
  // One nonce per response: the inline scripts React Router writes carry it, the Content-Security-Policy names it.
  const nonce = createNonce();
  // The dev server sends no CSP, so no nonce either (the client never has one to hydrate against: browsers hide it from the DOM).
  const scriptNonce = isDev ? undefined : nonce;
  applyDocumentHeaders(responseHeaders, {
    nonce,
    connectOrigins: connectOrigins(),
    upgradeInsecure: cameOverHttps(request),
    indexable: isIndexableRequest(request),
    dev: isDev,
  });

  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") return new Response(null, { status: responseStatusCode, headers: responseHeaders });

  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");

    // Crawlers (and SPA mode) get the whole page in one piece; people get the shell as soon as it is ready.
    const readyOption: keyof RenderToPipeableStreamOptions = (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";

    // Abort rendering after `streamTimeout` so there is time to flush the rejected boundaries.
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort(), streamTimeout + 1000);

    const { pipe, abort } = renderToPipeableStream(<ServerRouter context={routerContext} url={request.url} nonce={scriptNonce} />, {
      // React's own inline scripts (the instructions that complete a streamed Suspense boundary) need the nonce too.
      nonce: scriptNonce,
      [readyOption]() {
        shellRendered = true;
        const body = new PassThrough({
          final(callback) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
            callback();
          },
        });
        responseHeaders.set("Content-Type", "text/html; charset=utf-8");
        pipe(body);
        resolve(new Response(createReadableStreamFromReadable(body), { headers: responseHeaders, status: responseStatusCode }));
      },
      onShellError(error: unknown) {
        clearTimeout(timeoutId);
        reject(error);
      },
      onError(error: unknown) {
        responseStatusCode = 500;
        // Errors inside the shell reject above and are logged by React Router; only streamed ones are logged here.
        if (shellRendered) console.error(error);
      },
    });
  });
}

/** Client navigations' data responses: the static security headers and a short shared cache (see `DATA_CACHE_CONTROL`). */
export const handleDataRequest: HandleDataRequestFunction = (response) => {
  applyDataHeaders(response.headers, { cache: isCacheableData(response.status, isDev) });
  return response;
};

/** Log server errors, but not the aborted requests of visitors who navigated away. Nothing of the error reaches the page (see `ErrorPage`). */
export const handleError: HandleErrorFunction = (error, { request }) => {
  if (!request.signal.aborted) console.error(error);
};
