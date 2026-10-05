#!/bin/sh
# Renders the CORS includes into /tmp (tmpfs, the root fs is read-only), then runs nginx.
#
# CORS_ALLOW_ORIGINS  "*" (default) or a comma/space separated list of exact origins,
#                     e.g. "https://catalyst.example.com,https://www.example.com"
set -eu

ORIGINS="${CORS_ALLOW_ORIGINS:-*}"
MAP=/tmp/cors-map.conf
HEADERS=/tmp/cors-headers.conf

# Only origin-shaped characters are accepted, so the value cannot inject nginx syntax.
case "$ORIGINS" in
  *[!A-Za-z0-9:/.,*_\ -]*)
    echo "tiles: CORS_ALLOW_ORIGINS contains invalid characters" >&2
    exit 64
    ;;
esac

if [ "$ORIGINS" = "*" ]; then
  # Public read-only data, no credentials: a wildcard is correct and cache-friendly.
  printf 'map $http_origin $cors_origin {\n  default "*";\n}\n' > "$MAP"
  printf 'add_header Access-Control-Allow-Origin $cors_origin always;\n' > "$HEADERS"
else
  {
    printf 'map $http_origin $cors_origin {\n  default "";\n'
    for origin in $(printf '%s' "$ORIGINS" | tr ',' ' '); do
      printf '  "%s" "%s";\n' "$origin" "$origin"
    done
    printf '}\n'
  } > "$MAP"
  {
    printf 'add_header Access-Control-Allow-Origin $cors_origin always;\n'
    printf 'add_header Vary Origin always;\n'
  } > "$HEADERS"
fi

if [ ! -f /data/places.pmtiles ]; then
  echo "tiles: warning: /data/places.pmtiles not found; every request will 404 until it is mounted" >&2
fi

nginx -t -q
exec "$@"
