"""
Bakes `apps/web/public/media/earth-lights.png`, the planet's lights at night (engine/surface.ts `LIGHTS`, engine/materials.ts `lightsMaterial`): a grey, 2048 x 1024 equirectangular map of
NASA's Black Marble (GIBS layer VIIRS_Black_Marble, public domain), each texel the brightness of the lights there (red channel; 0: dark; the cities, the roads of the rich world, the fishing fleets and the gas flares are
the rest), NOT grown or smoothed (the map is read without smoothing, so a light is one hard texel: a thin, precise point, as pixel art wants), cut below the faint glow that is not a light and in a few levels. The GREEN channel is how packed the lights are round the texel (a blur of where they are, 0..255): the cores of the big clusters are 255, an isolated light is low, which the globe draws as a heat map (brighter, whiter cores).

    python3 -I scripts/globe/bake-lights.py <tiles> <out.png> [size]

`<tiles>` is a folder of the 64 Web Mercator tiles of GIBS' level 3 (`t_<row>_<col>.png`: https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/
GoogleMapsCompatible_Level8/3/<row>/<col>.png). Needs Pillow only. The poles, past the Mercator range, are dark.
"""
import math
import sys
from PIL import Image, ImageChops, ImageFilter

tiles, out = sys.argv[1], sys.argv[2]
W = int(sys.argv[3]) if len(sys.argv) > 3 else 2048
H = W // 2
N = 8
S = 256 * N

mosaic = Image.new("RGB", (S, S))
for r in range(N):
    for c in range(N):
        mosaic.paste(Image.open(f"{tiles}/t_{r}_{c}.png").convert("RGB"), (c * 256, r * 256))

LAT_MAX = math.degrees(math.atan(math.sinh(math.pi)))
def merc_y(lat):
    return (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * S

# one equirectangular row is the mean of the Mercator rows it covers (the columns are linear in longitude in both)
rgb = Image.new("RGB", (S, H))
for j in range(H):
    lat0, lat1 = 90 - j * 180 / H, 90 - (j + 1) * 180 / H
    if lat0 > LAT_MAX or lat1 < -LAT_MAX:
        continue
    y0 = merc_y(min(lat0, LAT_MAX - 1e-6))
    y1 = merc_y(max(lat1, -LAT_MAX + 1e-6))
    a, b = max(0, int(y0)), min(S, max(int(y0) + 1, int(math.ceil(y1))))
    band = mosaic.crop((0, a, S, b)).convert("L")
    rgb.paste(band.resize((S, 1), Image.BOX).convert("RGB"), (0, j))
grey = rgb.convert("L").resize((W, H), Image.BOX)

# the lights stand out of the map's own glow (the land's grey, the ice's white: a flat ground): what is left when the ground is taken away (a grey opening, the top-hat) is the lights
ground = grey.filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(9))
grey = ImageChops.subtract(grey, ground)

# the faint glow is not a light; the rest to a few levels (the dim towns still show, the cities are the brightest), each light one texel
lut = [0] * 256
for v in range(256):
    x = max(0.0, (v / 255 - 0.08) / 0.4)
    q = min(1.0, x) ** 0.7
    lut[v] = 0 if q < 0.12 else int(round(255 * math.ceil(q * 4) / 4))
lit = grey.point(lut)

# the ice sheets and the high Arctic have no lights, only the map's own seams: dark there (Greenland's coast towns are too small to show at this size)
from PIL import ImageDraw
d = ImageDraw.Draw(lit)
row = lambda lat: int((90 - lat) / 180 * H)
col = lambda lon: int((lon + 180) / 360 * W)
d.rectangle((0, 0, W, row(72)), fill=0)
d.rectangle((0, row(-60), W, H), fill=0)
d.rectangle((col(-75), 0, col(-10), row(60)), fill=0)
# the density of lights round each texel: a blur of where there are lights, scaled so that a texel in a tenth-full neighbourhood is already at its top
dots = lit.point([0] + [255] * 255)
dens = dots.filter(ImageFilter.GaussianBlur(3)).point([min(255, int(v * 255 / 70)) for v in range(256)])
Image.merge("RGB", (lit, dens, Image.new("L", (W, H), 0))).save(out, optimize=True)
print(out, lit.size)
