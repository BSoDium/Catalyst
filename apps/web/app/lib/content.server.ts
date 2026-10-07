import { EMPTY_PROJECTION, parsePublishedProjection, type PublishedProjection } from "@catalyst/schemas";
import { loadProjection, type ContentMode } from "@catalyst/published";

/**
 * Server-side content layer. Loaders call `getProjection()` and nothing else.
 *
 * Source order: `CATALYST_API_URL` (if set) -> bundled snapshot. The API path is
 * best-effort: any failure (network, timeout, HTTP status, invalid payload)
 * logs one short warning and serves the bundled snapshot. It never throws.
 *
 * Modes (`CATALYST_CONTENT`): `published` (default, the only one a deployment serves), `preview` (the owner's
 * local, git-ignored file with real places incl. drafts; dev only, never uses the API) and `demo` (placeholder
 * fixture; explicit opt-in only).
 */
export interface ContentSource {
  getProjection(): Promise<PublishedProjection>;
}

export interface ContentSourceOptions {
  mode?: ContentMode;
  /** Injectable for tests. Default: `loadProjection` from @catalyst/published. */
  load?: (mode: ContentMode) => PublishedProjection;
  apiUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** How long a validated API projection is reused. */
  ttlMs?: number;
  /** How long the fallback is served before the API is retried. */
  failureTtlMs?: number;
  now?: () => number;
  warn?: (message: string) => void;
}

const DEFAULTS = { timeoutMs: 2000, ttlMs: 60_000, failureTtlMs: 15_000 } as const;

/** Anything but an explicit `demo` or `preview` is `published`: demo and preview are never the default. */
export function contentModeFromEnv(env: Record<string, string | undefined>): ContentMode {
  if (env.CATALYST_CONTENT === "demo") return "demo";
  if (env.CATALYST_CONTENT === "preview") return "preview";
  return "published";
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    // Validation errors are multi-line; keep the log to the first line.
    return (error.name === "AbortError" ? "timeout" : error.message).split("\n")[0] ?? "unknown error";
  }
  return "unknown error";
}

export function createContentSource(options: ContentSourceOptions = {}): ContentSource {
  const {
    mode = "published",
    fetch: fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULTS.timeoutMs,
    ttlMs = DEFAULTS.ttlMs,
    failureTtlMs = DEFAULTS.failureTtlMs,
    now = Date.now,
    warn = (message: string) => console.warn(message),
  } = options;
  // A preview is local data only: it never comes from (or is mixed with) the API.
  const apiUrl = mode === "preview" ? undefined : options.apiUrl?.trim().replace(/\/+$/, "") || undefined;
  const load = options.load ?? loadProjection;

  let snapshot: PublishedProjection | undefined;
  let lastError: string | undefined;
  const getSnapshot = (): PublishedProjection => {
    // The preview file is re-read on every call (dev only, ~150 small records) so a fresh `export:preview`
    // shows up on reload without restarting the server. Bundled modes are loaded once.
    if (snapshot && mode !== "preview") return snapshot;
    try {
      snapshot = load(mode);
      lastError = undefined;
    } catch (error) {
      const message = describeError(error);
      if (message !== lastError) console.error(`[content] bundled "${mode}" projection is invalid: ${message}`);
      lastError = message;
      snapshot = EMPTY_PROJECTION;
    }
    return snapshot;
  };

  if (!apiUrl) return { getProjection: async () => getSnapshot() };

  let cached: { value: PublishedProjection; expiresAt: number } | undefined;
  let inflight: Promise<PublishedProjection> | undefined;

  async function fetchRemote(): Promise<PublishedProjection> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${apiUrl}/v1/projection`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parsePublishedProjection(await response.json());
    } finally {
      clearTimeout(timer);
    }
  }

  async function refresh(): Promise<PublishedProjection> {
    try {
      const value = await fetchRemote();
      cached = { value, expiresAt: now() + ttlMs };
      return value;
    } catch (error) {
      warn(`[content] API unavailable (${describeError(error)}); serving bundled snapshot`);
      const value = getSnapshot();
      cached = { value, expiresAt: now() + failureTtlMs };
      return value;
    }
  }

  return {
    getProjection() {
      if (cached && cached.expiresAt > now()) return Promise.resolve(cached.value);
      inflight ??= refresh().finally(() => {
        inflight = undefined;
      });
      return inflight;
    },
  };
}

let defaultSource: ContentSource | undefined;

/** Process-wide source configured from the environment, created on first use. */
function getContentSource(): ContentSource {
  defaultSource ??= createContentSource({
    mode: contentModeFromEnv(process.env),
    apiUrl: process.env.CATALYST_API_URL,
  });
  return defaultSource;
}

/** The mode this server process runs in (from `CATALYST_CONTENT`); used by the dev-only badge. */
export function getContentMode(): ContentMode {
  return contentModeFromEnv(process.env);
}

export function getProjection(): Promise<PublishedProjection> {
  return getContentSource().getProjection();
}
