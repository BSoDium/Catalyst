"""
Bakes `apps/web/public/media/earth-grey.png`, the land's picture of the globe (engine/surface.ts): a grey, 12-step, lightly smoothed equirectangular
brightness map of NASA's Blue Marble (GIBS layer BlueMarble_ShadedRelief_Bathymetry, public domain), sea removed (0), the coast pushed out over the sea.

    python3 -I scripts/globe/bake-earth.py <tiles> <out.png> [size]

`<tiles>` is a folder of the 256 Web Mercator tiles of GIBS' level 4 (`t_<row>_<col>.jpeg`: https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/
BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/4/<row>/<col>.jpeg). Needs Pillow only.

The brightness of the new picture is matched (quantile by quantile) to the previous 1024 x 512 one, so the cuts of the shader (`SURFACE.cuts`) and the share of the
land in each of the three tones stay what they were: only the resolution changes. The poles, past the Mercator range, are the previous picture's.
"""
import math
import sys
from PIL import Image, ImageFilter

tiles, out = sys.argv[1], sys.argv[2]
W = int(sys.argv[3]) if len(sys.argv) > 3 else 4096
H = W // 2
N = 16  # tiles per side at level 4
S = 256 * N
OLD = Image.open(out).convert("L") if len(sys.argv) <= 4 else Image.open(sys.argv[4]).convert("L")

# 1. the Mercator mosaic
mosaic = Image.new("RGB", (S, S))
for r in range(N):
    for c in range(N):
        mosaic.paste(Image.open(f"{tiles}/t_{r}_{c}.jpeg").convert("RGB"), (c * 256, r * 256))

# 2. to equirectangular: one output row is the mean of the Mercator rows it covers (the columns are linear in longitude in both)
LAT_MAX = math.degrees(math.atan(math.sinh(math.pi)))
def merc_y(lat):
    return (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * S
rgb = Image.new("RGB", (S, H))
valid = []
for j in range(H):
    lat0, lat1 = 90 - j * 180 / H, 90 - (j + 1) * 180 / H
    if lat0 > LAT_MAX or lat1 < -LAT_MAX:
        valid.append(False)
        continue
    y0 = merc_y(min(lat0, LAT_MAX - 1e-6))
    y1 = merc_y(max(lat1, -LAT_MAX + 1e-6))
    a, b = max(0, int(y0)), min(S, max(int(y0) + 1, int(math.ceil(y1))))
    rgb.paste(mosaic.crop((0, a, S, b)).resize((S, 1), Image.BOX), (0, j))
    valid.append(True)
rgb = rgb.resize((W, H), Image.BOX) if S != W else rgb

# 3. sea or land, and the land's brightness
px = rgb.tobytes()
lum = bytearray(W * H)
land = bytearray(W * H)
for i in range(W * H):
    r, g, b = px[3 * i], px[3 * i + 1], px[3 * i + 2]
    l = (299 * r + 587 * g + 114 * b) // 1000
    if b > r * 1.15 and b > g * 1.05 and l < 190:
        continue
    lum[i] = max(1, l)
    land[i] = 255
lum_img = Image.frombytes("L", (W, H), bytes(lum))

# 4. the coast pushed out over the sea (the land's mask is the coastlines' own, the picture only has to hold ground under their edge), then a light smoothing
grown = lum_img
for _ in range(2):
    grown = grown.filter(ImageFilter.MaxFilter(5))
merged = Image.composite(lum_img, grown, Image.frombytes("L", (W, H), bytes(land)))
smooth = merged.filter(ImageFilter.GaussianBlur(W / 1024 * 0.8))

# 5. quantile match of the land to the previous picture, then its own 12 steps
old_land = [v for v in OLD.resize((W, H), Image.NEAREST).tobytes() if v > 0]
old_sorted = sorted(old_land)
new_hist = smooth.histogram()
new_vals = [(v, new_hist[v]) for v in range(1, 256)]
total = sum(c for _, c in new_vals)
lut = [0] * 256
acc = 0
for v, c in new_vals:
    mid = (acc + c / 2) / max(total, 1)
    lut[v] = old_sorted[min(len(old_sorted) - 1, int(mid * len(old_sorted)))] if old_sorted else v
    acc += c
matched = smooth.point(lut)
# sea far from any coast stays 0
final = Image.composite(matched, Image.new("L", (W, H), 0), grown.point([0] + [255] * 255))

# 6. the poles are the previous picture's
old_big = OLD.resize((W, H), Image.NEAREST)
for j, ok in enumerate(valid):
    if not ok:
        final.paste(old_big.crop((0, j, W, j + 1)), (0, j))

final.save(out, optimize=True)
print(out, final.size)
