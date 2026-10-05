# Self-hosting: fallback tile server and containers

Status: 2026-10-05. Vercel stays the primary deployment of `apps/web` and `apps/api`. Everything here is the alternative path: containers for the whole app, and above all the **fallback tile server** that the street-zoom chain falls back to when OpenFreeMap is unavailable (see [street-zoom-spike.md](street-zoom-spike.md), "Home server as the fallback").

The chain, in order: OpenFreeMap (primary) -> your own PMTiles file (this document) -> the bundled globe (floor, always works). The fallback being down costs nothing but the street layer.

What lives where:

| Path | What |
| --- | --- |
| `deploy/docker/tiles/` | nginx image that serves one `places.pmtiles` with HTTP Range |
| `deploy/docker/web.Dockerfile`, `api.Dockerfile` | multi-stage images for the app (build context = repo root, `.dockerignore` at the root) |
| `deploy/docker-compose.yml`, `deploy/.env.example` | services `tiles`, `api`, `web`, selected with profiles |
| `deploy/tiles/extract-places.mjs` | builds `places.pmtiles` for all published places |

## 1. Quick start: the tile fallback alone

On the machine that has the repo (a laptop is fine; extraction is the only step that needs the `pmtiles` CLI and the repo):

```sh
brew install pmtiles                      # or a release binary: https://github.com/protomaps/go-pmtiles/releases
pnpm tiles:plan                           # dry run: estimated tiles and size, downloads nothing
pnpm tiles:extract                        # writes deploy/data/tiles/places.pmtiles
```

Until real places are published, `projection.json` is empty and both commands say so; add `--demo` to try the placeholder fixture (`pnpm tiles:plan --demo`).

Then, on the server (copy `deploy/` and the extracted file, or clone the repo there):

```sh
cd deploy
cp .env.example .env                      # adjust TILES_DIR / TILES_PORT / CORS_ALLOW_ORIGINS
mkdir -p data/tiles && cp /path/to/places.pmtiles data/tiles/
docker compose --profile tiles up -d --build
curl -sI http://127.0.0.1:8080/places.pmtiles          # 200, Accept-Ranges: bytes
curl -s -o /dev/null -w '%{http_code}\n' -H 'Range: bytes=0-99' http://127.0.0.1:8080/places.pmtiles   # 206
```

`--profile tiles` starts the tile server and nothing else. `--profile app` is web + api, both profiles together is everything.

The images are built for the CPU of the machine that builds them. The Optiplex is x86-64: build on it (`docker compose ... --build` there), or from an Apple Silicon machine with `docker buildx build --platform linux/amd64`.

## 2. Building `places.pmtiles`

`deploy/tiles/extract-places.mjs` (Node, no dependencies):

1. reads the projection (`packages/published/data/projection.json`, or `--demo` for the fixture, or `--projection <file>`);
2. writes `places.region.geojson` next to the output: a GeoJSON **MultiPolygon with one box per place**, half-size 10 km by default (`--radius-km`), widened by 1/cos(latitude) so the box stays square on the ground, split at the antimeridian;
3. finds the newest Protomaps daily build: `https://build.protomaps.com/YYYYMMDD.pmtiles`, listed at <https://maps.protomaps.com/builds> and <https://docs.protomaps.com/basemaps/downloads>. The script sends `HEAD` requests for today (UTC), yesterday, ... up to 10 days back and stops at the first that answers (today's file usually appears some hours after midnight UTC, so a miss is normal). Override with `--build YYYYMMDD` or `--source <url-or-local-file>`, which skips discovery;
4. runs **one** `pmtiles extract <source> places.pmtiles.partial --region=<geojson> --maxzoom=14 --download-threads=2`, then renames the result to `places.pmtiles`. The rename is atomic, so the running server never sees a half-written file.

Be polite to Protomaps: they ask not to hotlink their builds. The script makes one extract (a few hundred range requests, no loops, 2 threads) and you only run it when the set of places changes, not on a schedule.

Size and cost. `pnpm tiles:plan --demo` against build `20261005` (11 placeholder places spread over the world, 20 km boxes, z0-14) reported: 2,409 region tiles, 2,234 tile entries to fetch, **about 68 MB archive, 72 MB transferred, 255 requests, 19 s**. That is about 6 MB per place, in line with the spike's 5 to 10 MB per city. To shrink it: `--radius-km 5` (roughly a quarter of the area), or `--maxzoom 13` (about half; the client over-zooms line work cleanly). If you lower `--maxzoom`, set `CATALYST_TILES_MAX_FALLBACK_ZOOM` to the same value.

Data licence: (c) OpenStreetMap contributors (ODbL), basemap by Protomaps. The site keeps the credit visible (see the spike's attribution section).

## 3. Running it on the home server

### Compose

`deploy/docker-compose.yml`, service `tiles`:

- image `catalyst-tiles:local`, built from `deploy/docker/tiles/` (nginx-unprivileged 1.28, Alpine, about 54 MB);
- the directory `TILES_DIR` (default `deploy/data/tiles`) is mounted **read-only** at `/data`; only `places.pmtiles` from it is ever served;
- port `${TILES_BIND:-127.0.0.1}:${TILES_PORT:-8080}`. The default only listens on the host's loopback, which is what you want with a reverse proxy on the same host; set `TILES_BIND=0.0.0.0` only if something on another machine must reach it directly;
- `restart: unless-stopped`, 128 MB / 1 CPU limit, `read_only` root filesystem with a 16 MB tmpfs on `/tmp`, all capabilities dropped, `no-new-privileges`, logs capped at 15 MB total;
- healthcheck: a `HEAD /places.pmtiles` from inside the container every 30 s. It turns unhealthy if the file is missing or nginx is wedged.

Why a directory and not a single-file mount: replacing the file with `mv` gives it a new inode, and a single-file bind mount keeps pointing at the old one.

### Updating the tiles when places change

```sh
pnpm tiles:extract                                  # on the machine with the repo
scp deploy/data/tiles/places.pmtiles server:/srv/catalyst/tiles/places.pmtiles.new
ssh server 'mv /srv/catalyst/tiles/places.pmtiles.new /srv/catalyst/tiles/places.pmtiles'
```

`mv` within one directory is atomic; no container restart is needed (nginx opens the file per request). The server answers with a new `ETag` immediately, and the PMTiles client detects the change through it. Browsers may reuse cached responses for up to an hour (`Cache-Control: public, max-age=3600, stale-while-revalidate=86400`): after an update a visitor with a cached directory page can briefly see old tiles until the cache expires. Never `cp` over the live file (a reader can see a half-written archive); always write a sibling name and `mv`.

If you want the home server to do the extraction itself, the only requirements are Node 22+ and the `pmtiles` binary; the script has no other dependency.

### Resource use against the Optiplex (i5 7th gen, 16 GB RAM)

Measured on the idle stack (OrbStack, arm64, `docker stats`, 2026-10-05, demo content):

| Container | Idle memory | Idle CPU | Image |
| --- | --- | --- | --- |
| tiles | 3 to 5 MiB | 0.0% | 54 MB |
| api | 21 MiB | 0.0% | 248 MB |
| web | 72 MiB | 0.0% | 364 MB |

The tile server is a static file server: `sendfile`, no database, no tile logic. The page cache will hold the whole archive (tens of MB) in RAM; the 128 MB limit only caps nginx itself. CPU is irrelevant here. Plan for the 68 MB demo archive to be the order of magnitude: 30 places is a few hundred MB, which fits "little storage". The one hard cost is disk for the images (about 670 MB for all three, tiles alone 54 MB) and the Docker build cache; `docker builder prune` reclaims it.

### Bandwidth reality of a home uplink

From the spike: one street session fetches about 3.7 MB (measured, 70 range requests). At an assumed 20 Mbit/s uplink (2.5 MB/s) that is about 1.5 s per session, and a saturated line sustains roughly 2,400 sessions per hour. 1,000 sessions a day is about 110 GB a month: check the ISP's cap, and remember that this is the **fallback**, so it only carries traffic while OpenFreeMap is failing. Residential upstream is the weak link (also power, ISP outages, dynamic IP). The rate limit in the image (40 requests/s per client, burst 120, 30 connections per client, `429` beyond) protects the line from a single noisy client; it is not DDoS protection.

## 4. TLS and reverse proxy

The web app is served over HTTPS, so the tile URL must be HTTPS too (mixed content is blocked). Terminate TLS in a reverse proxy in front of the container, forward **only** 443 (and 80 if the proxy needs it for ACME) on the router, and give the proxy a name that resolves to your home connection (dynamic DNS if the address changes).

Requirements for any proxy: do not compress responses (the archive is already compressed and a recompressed body breaks range arithmetic), pass `Range`, `If-Match`, `If-None-Match` and `Origin` through, do not buffer the whole body before sending, and do not strip `ETag`, `Content-Range` or `Accept-Ranges`. Both examples below are standard configurations that I did not run here.

### Caddy (on the host, tiles bound to loopback)

```caddyfile
tiles.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

Caddy gets and renews the certificate on its own and only compresses when an `encode` directive is present, so the default is already correct. It sends `X-Forwarded-For`, which the tile server trusts from private addresses so the rate limit applies per real client.

### Traefik (Docker provider, same compose project or network)

Put Traefik and the tiles service on a shared network (do not publish the tiles port at all), then label the service, for example in a `docker-compose.override.yml`:

```yaml
services:
  tiles:
    ports: !reset []
    networks: [default, traefik]
    labels:
      - traefik.enable=true
      - traefik.docker.network=traefik
      - traefik.http.routers.tiles.rule=Host(`tiles.example.com`)
      - traefik.http.routers.tiles.entrypoints=websecure
      - traefik.http.routers.tiles.tls.certresolver=letsencrypt   # your resolver name
      - traefik.http.services.tiles.loadbalancer.server.port=8080
networks:
  traefik:
    external: true
```

Do not attach Traefik's `compress` middleware to this router. The entrypoint and certificate resolver names are whatever your Traefik uses.

### Any other proxy

Same rules. The container speaks plain HTTP on 8080 and already sends the CORS headers, so the proxy should not add its own `Access-Control-*` headers (duplicates make browsers reject the response).

### CORS

`CORS_ALLOW_ORIGINS=*` (default) is correct for public, read-only, uncredentialed data and keeps responses cacheable across origins. To restrict to your site, set `CORS_ALLOW_ORIGINS=https://catalyst.example.com,https://www.example.com`; the server then echoes a matching `Origin`, sends `Vary: Origin`, and sends no allow-origin header to anyone else. Note that this does not stop non-browser clients from downloading the file; the tiles are public OSM data.

Behaviour you can rely on (verified with curl against the built image, section 7): `GET`/`HEAD` with `Range: bytes=a-b` returns `206` with `Content-Range`; `OPTIONS` returns `204` with `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`, `Access-Control-Allow-Headers: Range, If-Match, If-None-Match, If-Range`, `Access-Control-Max-Age: 86400`; responses expose `Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified`.

## 5. Monitoring

- `docker compose --profile tiles ps` shows `healthy` or `unhealthy`; `docker inspect --format '{{json .State.Health}}' catalyst-tiles-1` shows the last probes.
- From outside, probe what the browser will do: `curl -s -o /dev/null -w '%{http_code}\n' -H 'Range: bytes=0-15' https://tiles.example.com/places.pmtiles` should print `206`. Point any uptime checker (Uptime Kuma, a cron + curl, a hosted pinger) at that request, not at `/`, which is a `404` by design.
- The access log (`docker compose logs tiles`) is one line per request: client address, time, method, path, status, bytes. No query string, user agent or referer. The container's own healthcheck is not logged. Logs rotate at 3 x 5 MB.
- Add `restart: unless-stopped` (already set) and make Docker start on boot (`systemctl enable docker`) so a power cut recovers by itself.
- Because the web app is meant to probe its sources and degrade to the globe (spike design), a short outage is invisible to visitors; alert on sustained failure, not on a single blip.

## 6. Environment variable contract for tile sources (web app)

These are the settings the web app reads to build its tile chain. The reading side is not implemented yet; this section is the contract it must follow. They are read on the server (`process.env`) and handed to the client in the page data, so they are **public URLs, never secrets**. Set them as Vercel project environment variables, or in `deploy/.env` for the web container (the compose file passes them through when set and leaves them unset otherwise).

| Variable | Default when unset or empty | Meaning |
| --- | --- | --- |
| `CATALYST_TILES_PRIMARY_URL` | OpenFreeMap: `https://tiles.openfreemap.org/planet` (TileJSON, z0 to 14, global) | The primary vector tile source. A TileJSON URL for a `z/x/y` source, or a `.pmtiles` URL. Absolute `https://` only. |
| `CATALYST_TILES_FALLBACK_URL` | none: the fallback is disabled and the chain is primary -> globe | Absolute `https://` URL of the PMTiles archive served by this tile server, e.g. `https://tiles.example.com/places.pmtiles`. Must be CORS-enabled and support Range (this server does). |
| `CATALYST_TILES_MAX_FALLBACK_ZOOM` | `14` | Highest zoom served from the fallback archive: the `--maxzoom` it was extracted with. Integer 0 to 15. Beyond it the map over-zooms the last level instead of requesting missing tiles. |

Expected handling on the reading side:

- Trim the values; treat an empty string as unset (`.env` templates and some dashboards produce empty strings).
- Validate once at startup: URL parses, protocol is `https:` (plain `http:` only for `localhost` in development), zoom is an integer in 0 to 15. An invalid value logs one warning and behaves as unset; it must never break page rendering.
- With only the defaults the site behaves exactly as today (OpenFreeMap, no fallback). Tiles are an enhancement and the globe is the floor.
- The fallback is only used after the primary fails its probe (health chain from the spike, 3 s timeout), and the chain re-probes the primary to recover.
- The tile archive is global within the extracted boxes only. Outside them it has no data, which is correct: the fallback exists for the curated places. A fallback archive cannot carry the world-to-region zoom range.
- Attribution stays visible for whichever source is active: "(c) OpenStreetMap contributors", Protomaps for the fallback, OpenFreeMap's own line for the primary.

## 7. Security notes and what was verified

- **Read-only by construction.** The only location is the exact path `/places.pmtiles`; every other path (`/`, `/index.html`, `/places.pmtiles/`, `/.env`, other files in the mounted directory, directory listings) returns `404`; `POST`/`PUT`/`DELETE` return `405` with `Allow: GET, HEAD, OPTIONS`. No write endpoint, no autoindex, no CGI, no proxying, no upload.
- **Contained.** Non-root (uid 101 for tiles, `node` uid 1000 for web and api), read-only root filesystem, the data volume mounted `:ro`, tmpfs `/tmp` only, all Linux capabilities dropped, `no-new-privileges`, memory/CPU/pid limits. `server_tokens off`.
- **Limits.** Header buffers 1 KB / 4 KB (an oversized header gets `400`), request bodies capped at 1 KB (none are used), 10 s header and body timeouts, 30 s send timeout, per-client rate and connection limits. A single `Range` is served; a multi-range request gets the full body (nginx `max_ranges 1`), never `multipart/byteranges`.
- **No compression** (`gzip off`), no cookies, no authentication, no personal data beyond the client address in the log.
- **Network.** Bind to loopback or a private Docker network and let the proxy be the only public listener. Keep the server off your main LAN VLAN if you can. `CORS_ALLOW_ORIGINS` is validated against a strict character set at startup, so it cannot inject configuration.
- **Supply chain.** Base images are pinned by version tag (`node:22.23.3-bookworm-slim`, `nginxinc/nginx-unprivileged:1.28.2-alpine`); pnpm is pinned to the repo's `packageManager` version and installs run with `--frozen-lockfile`. Bump the tags deliberately and rebuild for security updates.
- **App images.** The web and api containers read only the published projection bundled into the build (`CATALYST_CONTENT=published` by default; `demo` is placeholder data and must never be public). The api has no write endpoint and no secret; the web container needs none either.

Verified on 2026-10-05 with OrbStack (Docker 29, arm64) using `prototypes/street-zoom/public/hcmc.pmtiles` as `places.pmtiles`: all three images build; web `/` and `/locations/lisbon` return 200 (demo content), api `/health` and `/v1/places` return 200; the tile server returns `206` with the right `Content-Range`, `Accept-Ranges`, `ETag` and CORS headers on `GET`/`HEAD`, `204` on a preflight, `304` on `If-None-Match`, `416` on an unsatisfiable range, `404` for any other path, `405` for write methods, `429` on a 400-request burst; all containers run non-root on a read-only root filesystem and report `healthy`.

Not verified: behaviour behind a real Caddy or Traefik with Let's Encrypt, throughput on the Optiplex's CPU and uplink, MapLibre/PMTiles client behaviour against this server end to end (the web side of the contract is not built yet), and an update of the live file while clients are mid-session.
