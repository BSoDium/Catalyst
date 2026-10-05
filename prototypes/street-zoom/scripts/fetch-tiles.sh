#!/usr/bin/env bash
# Fetch the Ho Chi Minh City PMTiles extract used by the street-zoom spike.
# One extract, ~21 MB transferred, from the public Protomaps basemap build. Not committed (*.pmtiles is git-ignored).
#
#   brew install pmtiles            # or: https://github.com/protomaps/go-pmtiles/releases
#   ./scripts/fetch-tiles.sh [BUILD_DATE]
#
# Latest builds are listed at https://maps.protomaps.com/builds (metadata: https://build-metadata.protomaps.dev/builds.json).
# Protomaps asks not to hotlink their builds; mirror what you need once. This script makes 47 range requests in total.
# Data: (c) OpenStreetMap contributors, ODbL. Basemap schema v4 (Protomaps).
set -euo pipefail

BUILD="${1:-20261004}"        # build used for the spike (published 2026-10-04, basemap version 4.15.2)
BBOX="106.50,10.55,106.95,11.00"   # lon_min,lat_min,lon_max,lat_max (about 49 x 50 km around Ho Chi Minh City)
MAXZOOM=15
OUT="$(dirname "$0")/../public/hcmc.pmtiles"

command -v pmtiles >/dev/null || { echo "pmtiles CLI not found (brew install pmtiles)"; exit 1; }
if [ -f "$OUT" ]; then echo "$OUT already exists, delete it to fetch again"; exit 0; fi

pmtiles extract "https://build.protomaps.com/${BUILD}.pmtiles" "$OUT" --bbox="$BBOX" --maxzoom="$MAXZOOM"
pmtiles show "$OUT" | head -12
ls -l "$OUT"
