# Sea ease measurements and contact sheet: sea-ease.py runs.json out-prefix
# Mean luminance (0..255) of the central 120x80 patch of each frame (open sea) and of the top-left corner, which is also sea
# (the page colour while the globe is shown), the largest step between consecutive frames, and a contact sheet of 12 frames
# per direction (the patch is outlined in the first frame only; frames are scaled to 25 %).
import json, sys
from PIL import Image, ImageDraw, ImageStat

runs = json.load(open(sys.argv[1]))
prefix = sys.argv[2]
PATCH = (340, 210, 460, 290)
report = {}
for d, frames in runs.items():
    vals = []
    for f in frames:
        im = Image.open(f["file"]).convert("L")
        vals.append(round(ImageStat.Stat(im.crop(PATCH)).mean[0], 3))
    fills = [f.get("fill") for f in frames]
    # the fill tone of the street map (mean palette level of the non-line cells of the middle of the frame; None while the globe is shown)
    fsteps = [round(abs(b - a), 4) for a, b in zip(fills, fills[1:]) if a is not None and b is not None]
    steps = [round(abs(b - a), 3) for a, b in zip(vals, vals[1:])]
    total = abs(vals[-1] - vals[0]) or 1e-9
    report[d] = {
        "mapZoom": [f["mapZoom"] for f in frames],
        "owner": [f["owner"] for f in frames],
        "luma": vals,
        "fill": [None if v is None else round(v, 4) for v in fills],
        "fillMaxStep": max(fsteps) if fsteps else None,
        "fillRange": round((max(v for v in fills if v is not None) - min(v for v in fills if v is not None)), 4) if fsteps else None,
        "maxStep": max(steps),
        "maxStepAt": [frames[steps.index(max(steps))]["mapZoom"], frames[steps.index(max(steps)) + 1]["mapZoom"]],
        "range": round(total, 3),
        "maxStepShare": round(max(steps) / total, 3),
    }
json.dump(report, open(prefix + ".json", "w"), indent=1)
for d, r in report.items():
    print(d, "fill tone (mean level of non-line cells): range", r["fillRange"], "max step", r["fillMaxStep"])
    print(d, "luma range", r["range"], "max step", r["maxStep"], "at", r["maxStepAt"], "share of the range", r["maxStepShare"])

# contact sheet: 12 chosen zooms, one row per direction (in: left to right zooming in; out: the same zooms walked back, so
# the second row reads in the order the frames were taken zooming out), a 160x100 crop of open sea at 1:1 with the fill tone
# (mean palette level of the non-line cells) under each frame. The globe is shown up to map zoom 4.5 (the cut).
ZOOMS = [4.25, 4.75, 5.25, 5.75, 6.5, 7.0, 7.75, 8.5, 9.0, 9.75, 10.25, 11.0]
CW, CH = 160, 100
box = (400 - CW // 2, 250 - CH // 2, 400 + CW // 2, 250 + CH // 2)
W, H = 12 * (CW + 3) + 3, 2 * (CH + 26) + 3
sheet = Image.new("L", (W, H), 90)
dr = ImageDraw.Draw(sheet)
for r, d in enumerate(("in", "out")):
    frames = runs[d]
    by = {f["mapZoom"]: f for f in frames}
    order = ZOOMS if d == "in" else ZOOMS[::-1]
    for c, z in enumerate(order):
        f = by[z]
        x, y = 3 + c * (CW + 3), 3 + r * (CH + 26)
        sheet.paste(Image.open(f["file"]).convert("L").crop(box), (x, y + 12))
        tone = f.get("fill")
        dr.text((x, y), ("%g %s" % (z, "globe" if tone is None else "street")), fill=255)
        dr.text((x, y + CH + 13), "tone " + ("-" if tone is None else "%.3f" % tone), fill=255)
sheet.save(prefix + ".png", optimize=True)
print(prefix + ".png", sheet.size)
