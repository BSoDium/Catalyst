# syntax=docker/dockerfile:1.7
#
# @catalyst/api: read-only Hono API, esbuild-bundled into one self-contained file
# (workspace sources, hono, zod and the content JSON are inlined), run by plain node.
# Build from the repo root:
#   docker build -f deploy/docker/api.Dockerfile -t catalyst-api .
#
# Runtime env:
#   CATALYST_CONTENT  "published" (default) or "demo" (placeholder fixture). The API refuses
#                     to start on invalid content.
#   PORT              default 3001

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
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=catalyst-pnpm-store,target=/pnpm/store \
    pnpm fetch --store-dir /pnpm/store

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
    pnpm install --offline --frozen-lockfile --store-dir /pnpm/store --filter "@catalyst/api..."
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @catalyst/api build

# ---------------------------------------------------------------- runtime
# dist/server.mjs needs no node_modules, so the runtime stage is just node + one file.
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    CATALYST_CONTENT=published
WORKDIR /app
COPY --from=build /repo/apps/api/dist/server.mjs ./server.mjs
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.mjs"]
