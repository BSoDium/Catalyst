# @catalyst/geodata

Compact world coastline and country-border polylines for the globe, in one wire format (`src/format.ts`: quantised to 1/100 degree, delta-coded integers) with two lazy loaders (`loadCoastlines`, `loadBorders`). Only `data/coastlines-110m.json` and `data/borders-50m.json` are loaded by the web app.

## What the borders are

**Solid, de-facto land borders only**, the same rule the street map applies to OpenStreetMap (`admin_level` 2, not disputed, not maritime; `apps/web/app/globe/street/style/street-style.ts`). The globe and the street map must show the same frontiers on both sides of the hand-over, so a line that OpenStreetMap carries only as a disputed or maritime line is not in this dataset (the Moroccan wall, Kashmir's line of control and line of actual control, Arunachal, the Crimean isthmus, the Golan line, the Cyprus buffer zone, Somaliland, the Haro and Johor straits, Hong Kong and Macao, ...).

The source is Natural Earth's classified boundary lines (public domain), not a mesh of country polygons (the previous source, which cannot tell a disputed line from a real one).

### Class allowlist (`scripts/borders.ts`)

`FEATURECLA` of `ne_50m_admin_0_boundary_lines_land`:

| class | features | globe |
| --- | --- | --- |
| `International boundary (verify)` | 355 | drawn |
| `Disputed (please verify)` | 21 | dropped |
| `Line of control (please verify)` | 7 | dropped |
| `Indefinite (please verify)` | 5 | dropped |
| `Indeterminant frontier` | 2 | dropped |
| `Claim boundary`, `Overlay limit` | 0 in the 50m file | dropped |

Then the class rule is corrected where it disagrees with OpenStreetMap, measured by `apps/web/scripts/geo/border-osm.mjs` against the street map's own tiles (OpenFreeMap planet z5, 2026-10-06, tolerance one art cell) and committed in `scripts/osm-evidence.json` (feature number, `NE_ID` guard, pair, percentages; no OpenStreetMap geometry): 14 features classed disputed / indefinite / line of control that OpenStreetMap draws as a plain land border are kept (Ethiopia / Somalia, North Korea / South Korea, Israel / Palestine and Lebanon, Algeria / Morocco, Guyana, Suriname, Malawi / Tanzania, Brazil / Uruguay, Argentina / Chile, Ethiopia / Kenya), 5 `International boundary` features that it has no land border for are dropped (Haro Strait, Johor Strait, Hong Kong, Macao, one Ladakh stretch), and 21 runs of kept features that it carries only as a disputed or maritime line are cut out (Hala'ib, Arunachal / Bhutan, Olivenza, Dixon Entrance, ...). `generate -- --strict-classes` applies the class rule alone.

### Shaping

Antimeridian-safe (`splitArtificial`), lines joined end to end, Douglas-Peucker 0.03 degrees, and **no segment longer than 4 degrees** (`cutLongSegments`, same geometry): a simplified 49th parallel is otherwise one 28 degree segment, and a renderer drawing straight chords sinks it into the globe (the USA / Canada and Alaska / Canada borders vanished from far zoom; the engine also cuts chords now, `engine/geometry.ts`).

## Provenance

- Repository: https://github.com/nvkelso/natural-earth-vector, tag `v5.1.2`, commit `f1890d9f152c896d250a77557a5751a93d494776` (2022-05-13); downloaded 2026-10-06. Nothing from it is committed: only the generated output.
- `ne_50m_admin_0_boundary_lines_land.geojson`, sha256 `2faac4f6b34386f3d21b6e018cf151f241f00e5c936d44dd17d7d9bfb147fa48` (the dataset)
- `ne_110m_admin_0_boundary_lines_land.geojson`, sha256 `d42479fd79552cca4eec7f85fcdca717a790d29ff06be7676f1af0568c6d3f7c` (size report only, not loaded: `--report`)
- `ne_50m_admin_0_countries.geojson`, sha256 `3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb` (labels each line with its country pair for reports and tests)
- URLs and checksums: `scripts/sources.json` (raw.githubusercontent.com at the pinned commit); the generator refuses a file whose sha256 differs.
- Coastlines: `world-atlas` 2.0.2 (Natural Earth land, TopoJSON), unchanged.

## Regenerate

```
pnpm --filter @catalyst/geodata generate                       # downloads the pinned files, checks sha256, writes data/*.json
pnpm --filter @catalyst/geodata generate -- --borders <path|url> [--countries <path|url>] [--no-verify]
pnpm --filter @catalyst/geodata generate -- --countries <ne_50m_admin_0_countries> --report-json out.json --fixture src/frontier-reference.json
pnpm --filter @catalyst/geodata generate -- --report           # sizes of every candidate
pnpm --filter @catalyst/geodata test typecheck
```

`src/frontier-reference.json` (written by `--fixture`) is what `src/borders.test.ts` checks the data against: a point every 40 km along 20 frontiers that must be complete (USA / Canada including Alaska / Canada, USA / Mexico, Kazakhstan / Russia, Argentina / Chile, China / Mongolia and Russia, ...) and 45 stretches that must be absent. Check against the street map: `node apps/web/scripts/geo/border-register.mjs --ne <ne lines> --report <report.json>` (registration across the hand-over, country pairs that differ; needs network for the tiles).

## Size

`borders-50m.json`: 40.9 kB raw, 15.3 kB gzip (13.5 kB brotli), 187 polylines, 6 393 vertices; before: 37.0 kB raw, 13.95 kB gzip. `coastlines-110m.json`: 37.2 kB raw, 14.9 kB gzip.

## Licences

Natural Earth: public domain (https://www.naturalearthdata.com/about/terms-of-use/), so the generated data in `data/` carries no obligation. The generator, loaders and tests: MIT (`LICENSE`). `scripts/osm-evidence.json` records measurements (feature numbers and percentages) made against OpenStreetMap-derived tiles; it holds no OpenStreetMap geometry.
