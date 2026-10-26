"""Bake public/media/moon-grey.png: the Moon's own picture for the moon that circles the globe (docs/landing.md, "The moon"),
made the way earth-grey.png is: a grey, lightly smoothed, few-step reduction of an equirectangular map of the Moon (longitude 0, the near side, in the middle).

The grey is stretched so that the SAME tone cuts the Earth's picture is read with (`SURFACE.cuts`, engine/surface.ts: 0.42 and 0.62) split the Moon into
about a third dark ground (the maria), a half middle and the rest light (the highlands and the bright rays and craters).

    python3 apps/web/scripts/moon/bake-moon.py SOURCE.jpg apps/web/public/media/moon-grey.png

Needs Pillow and numpy. The source is a 1024 x 512 grey or colour map (see public/media/moon-grey.NOTICE.txt).
"""
import sys

import numpy as np
from PIL import Image, ImageFilter

W, H, STEPS = 256, 128, 12
DARK_SHARE, LIGHT_SHARE = 0.30, 0.76  # the shares of the Moon below the first cut and below the second (the maria, then the middle ground)
CUTS = (0.42, 0.62)

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("L").filter(ImageFilter.GaussianBlur(2.2)).resize((W, H), Image.LANCZOS)
a = np.asarray(im, dtype=np.float64)
# rows near the poles are the map's stretched ones and never face us: leave them out of the statistics
band = a[H // 6 : H - H // 6]
lo = np.quantile(band, [DARK_SHARE, LIGHT_SHARE, 0.999])
q0, q1, top = lo[0], lo[1], lo[2]
# piecewise linear: q0 -> first cut, q1 -> second cut, the darkest -> 0.2 (the Earth's picture is lifted to 0.2 and over), `top` -> 1
floor = float(band.min())
xs = [floor, q0, q1, top]
ys = [0.2, CUTS[0] + 0.04, CUTS[1] + 0.03, 1.0]  # a hair above each cut: the 12-step rounding must not drop a step under it
v = np.interp(a, xs, ys)
v = np.round(v * STEPS) / STEPS
Image.fromarray(np.clip(v * 255, 0, 255).astype(np.uint8), "L").save(dst, optimize=True)
print(f"{dst}: {W} x {H}, {STEPS} steps; share below {CUTS[0]}: {(v < CUTS[0]).mean():.2f}, below {CUTS[1]}: {(v < CUTS[1]).mean():.2f}")
