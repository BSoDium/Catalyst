"""Contact sheet of the frames of a zoom through one level change: python3 groups-sheet.py FRAME_DIR OUT.png LABELS(comma separated)."""
import sys, glob
from PIL import Image, ImageDraw

frames_dir, out, labels = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
files = sorted(glob.glob(f"{frames_dir}/f*.png"))
cols = 5
tw = 400
imgs = [Image.open(f).convert("RGB") for f in files]
th = int(imgs[0].height * tw / imgs[0].width)
rows = (len(imgs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * (th + 16)), (251, 251, 251))
d = ImageDraw.Draw(sheet)
for i, im in enumerate(imgs):
    x, y = (i % cols) * tw, (i // cols) * (th + 16)
    sheet.paste(im.resize((tw, th), Image.NEAREST), (x, y + 16))
    d.text((x + 6, y + 2), f"zoom {labels[i]}", fill=(10, 10, 10))
sheet = sheet.convert("P", palette=Image.ADAPTIVE, colors=32)
sheet.save(out, optimize=True)
