# syntax=docker/dockerfile:1.7
#
# Fallback tile server: nginx serving one read-only PMTiles file with HTTP Range.
# Build context is this directory:
#   docker build -t catalyst-tiles deploy/docker/tiles
#
# Run (read-only root fs, mount a DIRECTORY containing places.pmtiles at /data):
#   docker run -d --read-only --tmpfs /tmp -p 8080:8080 -v "$PWD/data:/data:ro" catalyst-tiles
#
# Env:
#   CORS_ALLOW_ORIGINS  "*" (default) or comma separated exact origins

FROM nginxinc/nginx-unprivileged:1.28.2-alpine

USER root
# Drop the stock site config and templates; ship ours. Nothing under /etc/nginx is writable at runtime.
RUN rm -rf /etc/nginx/conf.d /etc/nginx/templates /docker-entrypoint.d \
    && mkdir -p /data \
    && chown root:root /data
COPY nginx.conf /etc/nginx/nginx.conf
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/tiles-entrypoint.sh
USER 101

VOLUME ["/data"]
EXPOSE 8080

# HEAD request for the real file (busybox wget --spider): fails if the mount is missing or nginx is wedged.
# (Not a Range GET: busybox wget treats 206 as an error.)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/places.pmtiles || exit 1

ENTRYPOINT ["/usr/local/bin/tiles-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
