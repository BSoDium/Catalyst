# syntax=docker/dockerfile:1.7
#
# @catalyst/web: React Router (framework mode, SSR) served by react-router-serve.
# Build from the repo root:
#   docker build -f deploy/docker/web.Dockerfile -t catalyst-web .
#
# Runtime env:
#   CATALYST_CONTENT  "published" (default) or "demo" (placeholder fixture)
#   CATALYST_API_URL  optional, e.g. http://api:3001 (falls back to the bundled snapshot)
#   PORT              default 3000

ARG NODE_VERSION=22.23.3
ARG PNPM_VERSION=10.5.2

# ---------------------------------------------------------------- base
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    CI=true \
    npm_config_update_notifier=false
RUN npm install --global --no-fund --no-audit pnpm@${PNPM_VERSION}
WORKDIR /repo

# ---------------------------------------------------------------- fetch
# Downloads every locked package into the pnpm store using ONLY the lockfile, so this
# layer is reused until pnpm-lock.yaml changes. The store lives in a BuildKit cache mount.
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=catalyst-pnpm-store,target=/pnpm/store \
    pnpm fetch --store-dir /pnpm/store

# Workspace manifests only (so source edits do not invalidate the install layers).
FROM fetch AS manifests
COPY package.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/geodata/package.json packages/geodata/
COPY packages/published/package.json packages/published/
COPY packages/schemas/package.json packages/schemas/
COPY prototypes/globe/package.json prototypes/globe/
COPY prototypes/street-zoom/package.json prototypes/street-zoom/

# ---------------------------------------------------------------- build
FROM manifests AS build
RUN --mount=type=cache,id=catalyst-pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --store-dir /pnpm/store --filter "@catalyst/web..."
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
# CATALYST_CONTENT is read at runtime; the bundled snapshots for both modes are in the build.
RUN pnpm --filter @catalyst/web build

# ---------------------------------------------------------------- prod deps
# Production dependencies of @catalyst/web only. The workspace file is narrowed to the web app
# and its workspace dependencies: with the full workspace pnpm also pulls the other projects'
# packages (maplibre, playwright, vite, ...) into the virtual store, which more than doubles
# the image. The lockfile still verifies (--frozen-lockfile); extra importers are ignored.
# "pnpm fetch" also leaves a full virtual store in node_modules/.pnpm, so start from a clean one.
FROM fetch AS prod-deps
RUN rm -rf node_modules && printf 'packages:\n  - apps/web\n  - packages/*\n' > pnpm-workspace.yaml
COPY package.json ./
COPY apps/web/package.json apps/web/
COPY packages/geodata/package.json packages/geodata/
COPY packages/published/package.json packages/published/
COPY packages/schemas/package.json packages/schemas/
RUN --mount=type=cache,id=catalyst-pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --prod --store-dir /pnpm/store --filter "@catalyst/web..."

# ---------------------------------------------------------------- runtime
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    CATALYST_CONTENT=published
WORKDIR /app
# The node image ships an unprivileged "node" user (uid/gid 1000); files stay root-owned
# and read-only for it.
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /repo/apps/web/package.json ./apps/web/package.json
COPY --from=build /repo/apps/web/build ./apps/web/build
WORKDIR /app/apps/web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Exec form with node directly: PID 1 receives SIGTERM for clean shutdown.
CMD ["node", "node_modules/@react-router/serve/bin.js", "./build/server/index.js"]
