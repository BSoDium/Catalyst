"""Pack the rendered templates (tpl_h<H>_y<Y>.npy: one quarter of the light of a block, from Mitsuba) into the one 8-bit picture the page reads (log of the light), and report the scale."""
import numpy as np
from PIL import Image
import sys

HEIGHTS = [0.5, 1.3, 2.4]
FEET = [0, 0.9, 1.8, 2.7]
SIZE = 128
LOG_FLOOR = 1e-4
LOG_RANGE = 10.0

tiles = {}
for h in HEIGHTS:
    for y in FEET:
        q = np.load("tpl_h%d_y%d.npy" % (round(h * 100), round(y * 100)))
        # the square under the block is not lit by the ground's own view (the renderer cannot see through glass): leave it dark; resample to the stored size
        im = Image.fromarray(q.astype(np.float32), mode="F").resize((SIZE, SIZE), Image.BILINEAR)
        tiles[(h, y)] = np.array(im)
ref = max(t.max() for t in tiles.values())
scale = 1.0 / ref                         # the brightest texel of all the templates is 1
atlas = np.zeros((SIZE * len(HEIGHTS), SIZE * len(FEET)), np.uint8)
for r, h in enumerate(HEIGHTS):
    for c, y in enumerate(FEET):
        v = np.maximum(tiles[(h, y)] * scale, 0)
        code = np.clip(np.log1p(v / LOG_FLOOR) / LOG_RANGE, 0, 1)
        atlas[r * SIZE:(r + 1) * SIZE, c * SIZE:(c + 1) * SIZE] = np.round(code * 255).astype(np.uint8)
out = sys.argv[1] if len(sys.argv) > 1 else "caustic-templates.png"
Image.fromarray(atlas).save(out, optimize=True)
import os
print(out, atlas.shape, os.path.getsize(out), "bytes; reference max", ref)
