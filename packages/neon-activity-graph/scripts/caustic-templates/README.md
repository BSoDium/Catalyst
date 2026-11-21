# Caustic templates

`assets/caustic-templates.png` is the baked light one glass block casts on the ground (the dark theme, see `ground-light.ts`; embedded in `src/templates-data.ts` by `pnpm embed:templates`). It is generated, not drawn:

1. `render_template.py <height> <foot> <spp> <res>` renders one rounded glass block with a rod of white light in it, seen from above, with a real light tracer (Mitsuba 3), and averages the picture over the eight symmetries of the
   square (enough samples that it is clean). `run_templates.sh` renders the set the page uses (3 heights x 4 feet above the ground, 4000 samples, about 15 minutes).
2. `pack_templates.py <out.png>` packs the quarters into one 8-bit picture (the log of the light). Its constants (`HEIGHTS`, `FEET`, `SIZE`, `LOG_FLOOR`, `LOG_RANGE`) must match the ones exported by `ground-light.ts`.

Setup: `python3 -m venv .venv && .venv/bin/pip install mitsuba numpy pillow`. Run from this folder. Needed again only if the blocks' shape or the rod's changes.
