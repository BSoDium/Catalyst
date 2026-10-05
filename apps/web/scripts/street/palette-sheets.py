# Contact sheets of the palette comparison: compare-<scheme>.png (rows: level count, columns: frames) and one sheet per place.
import sys
from PIL import Image, ImageDraw

frames, out, levels, places = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(",")], sys.argv[4].split(",")
cols = [("world", None)] + [(p, s) for p in places for s in ("city", "district", "street")]
SCALE = 0.5
for scheme in ("light", "dark"):
    tiles = []
    for n in levels:
        row = []
        for p, s in cols:
            f = f"{frames}/world-n{n}-{scheme}.png" if p == "world" else f"{frames}/{p}-{s}-n{n}-{scheme}.png"
            row.append(Image.open(f).convert("RGB"))
        tiles.append(row)
    w, h = tiles[0][0].size
    tw, th = int(w * SCALE), int(h * SCALE)
    pad, capw, caph = 4, 44, 16
    W = capw + len(cols) * (tw + pad) + pad
    H = caph + len(levels) * (th + pad) + pad
    sheet = Image.new("RGB", (W, H), (120, 120, 120))
    d = ImageDraw.Draw(sheet)
    for ci, (p, s) in enumerate(cols):
        d.text((capw + ci * (tw + pad) + 2, 2), p if s is None else f"{p} {s}", fill=(255, 255, 0))
    for ri, n in enumerate(levels):
        d.text((4, caph + ri * (th + pad) + th // 2), f"N={n}", fill=(255, 255, 0))
        for ci in range(len(cols)):
            im = tiles[ri][ci].resize((tw, th), Image.LANCZOS)
            sheet.paste(im, (capw + ci * (tw + pad), caph + ri * (th + pad)))
    sheet.save(f"{out}/compare-{scheme}.png", optimize=True)
    print(f"{out}/compare-{scheme}.png", sheet.size)
