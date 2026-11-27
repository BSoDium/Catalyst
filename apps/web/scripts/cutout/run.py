#!/usr/bin/env python3
"""Cutouts for every full-size photograph and route image under public/media (prototype of the trip card's layering, #510).

    python3 scripts/cutout/run.py [--only <folder>] [--debug <dir>]

Writes `<name>.cutout.webp` next to each `photo.<hash>.webp` / `image.<hash>.webp` and the manifest the poster reads (`app/lib/cutouts.generated.json`).
Needs macOS (swiftc, for Apple's Vision foreground mask), cwebp, and `pip install numpy scipy pillow opencv-python-headless pymatting onnxruntime`, and for the "semantic" mode the SegFormer weights (see `semantic_probs`; `SEGFORMER_DIR`). How each picture is cut: `config.json`.
"""
import json, os, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
import cv2
from pymatting import estimate_alpha_cf, estimate_foreground_ml
from PIL import Image

HERE = Path(__file__).resolve().parent
WEB = HERE.parent.parent
MEDIA = WEB / "public" / "media"
MANIFEST = WEB / "app" / "lib" / "cutouts.generated.json"
CONFIG = json.loads((HERE / "config.json").read_text())


def vision_binary() -> Path:
    out = Path(tempfile.gettempdir()) / "catalyst-cutout"
    src = HERE / "cutout.swift"
    if not out.exists() or out.stat().st_mtime < src.stat().st_mtime:
        subprocess.run(["swiftc", "-O", str(src), "-o", str(out)], check=True)
    return out


def by_vision(path: Path, rgb: np.ndarray):
    png = Path(tempfile.mkstemp(suffix=".png")[1])
    said = subprocess.run([str(vision_binary()), str(path), str(png)], capture_output=True, text=True).stdout.strip()
    if not said or not said[0].isdigit():
        return None
    alpha = np.array(Image.open(png).convert("RGBA"))[:, :, 3]
    png.unlink()
    return alpha


def ellipse(r: int):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def sky_colour(lab: np.ndarray, sky: np.ndarray):
    """The sky's colour everywhere, spread from the sky found into what is not (Telea inpainting on a quarter-size copy): the sky colour next to a gap, to tell whether the gap is sky."""
    h, w = sky.shape
    k = 4
    small = cv2.resize(lab, (w // k, h // k), interpolation=cv2.INTER_AREA)
    hole = (~cv2.resize(sky.astype(np.uint8), (w // k, h // k), interpolation=cv2.INTER_NEAREST).astype(bool)).astype(np.uint8) * 255
    hole = cv2.dilate(hole, ellipse(1))
    filled = cv2.inpaint(small, hole, 5, cv2.INPAINT_TELEA)
    return cv2.resize(filled, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float64)


def matte(rgb: np.ndarray, trimap: np.ndarray, choke: float = 0.2):
    """Closed-form alpha matting from a trimap (0 background, 1 foreground, 0.5 unknown): the edge snaps to the picture's own, fronds and spires keep their sky showing through.
    The faint end of the alpha is cut off (`choke`: below it nothing, a halo of nearly transparent sky), and the colour of every edge pixel is taken from the solid subject next to it, not
    from the picture (which there is half sky: a blue or cyan glow round the subject, the more so against a dark card)."""
    img = rgb.astype(np.float64) / 255.0
    alpha = np.clip(estimate_alpha_cf(img, trimap), 0, 1)
    alpha = np.clip((alpha - choke) / (0.92 - choke), 0, 1)
    solid = (alpha > 0.97).astype(np.float64)
    solid = cv2.erode(solid, ellipse(1))
    num = np.zeros_like(img)
    den = np.zeros(alpha.shape)
    for sigma in (3, 7, 15):
        n = cv2.GaussianBlur(img * solid[:, :, None], (0, 0), sigma)
        d = cv2.GaussianBlur(solid, (0, 0), sigma)
        fill = (den < 1e-3) & (d > 1e-3)
        num[fill] = n[fill] / d[fill][:, None]
        den[fill] = d[fill]
    edge = (alpha < 0.97) & (den > 1e-3)
    fg = img.copy()
    fg[edge] = num[edge]
    return (np.clip(fg, 0, 1) * 255).astype(np.uint8), (alpha * 255).astype(np.uint8)


def sky_matte(rgb: np.ndarray, tri: np.ndarray, sky_like: np.ndarray, reach: int = 16, floor: float = 55.0):
    """Matting against a sky: the sky's colour B behind every pixel is known (spread from the sky next to it: smooth, a gradient), and so is the subject's colour F next to it (the solid
    subject, spread outward). A pixel I is `alpha F + (1 - alpha) B`, so alpha = (I - B).(F - B) / |F - B|^2: solved pixel by pixel, no guessing (a general matting solver, given a
    wide unknown strip, calls sky-tinted pixels solid). Where F and B are too alike to tell (`floor`, RGB distance) the closed-form alpha is kept. Returns colours and alpha."""
    h, w = rgb.shape[:2]
    cf_fg, cf_alpha = matte(rgb, tri)
    img = cv2.GaussianBlur(rgb, (0, 0), 0.8).astype(np.float64)
    B = sky_colour(cv2.GaussianBlur(rgb, (0, 0), 1.2), sky_like)
    solid = (tri == 1.0).astype(np.float64)
    solid = cv2.erode(solid, ellipse(2))
    num = np.zeros_like(img)
    den = np.zeros((h, w))
    for sigma in (4, 9, 20, 40):
        n = cv2.GaussianBlur(img * solid[:, :, None], (0, 0), sigma)
        d = cv2.GaussianBlur(solid, (0, 0), sigma)
        fill = (den < 1e-3) & (d > 1e-3)
        num[fill] = n[fill] / d[fill][:, None]
        den[fill] = d[fill]
    F = np.where(den[:, :, None] > 1e-3, num, img)
    FB = F - B
    norm = (FB * FB).sum(axis=2)
    alpha_d = np.clip(((img - B) * FB).sum(axis=2) / np.maximum(norm, 1e-6), 0, 1)
    valid = norm > floor * floor
    near = cv2.dilate(sky_like.astype(np.uint8), ellipse(reach)).astype(bool) & (tri > 0)
    use = near & valid
    alpha = cf_alpha.astype(np.float64) / 255.0
    alpha[use] = alpha_d[use]
    # (a little decisive at both ends: a faint haze is no subject, nearly solid is solid)
    alpha[use] = np.clip((alpha[use] - 0.12) / 0.7, 0, 1)
    fg = cf_fg.astype(np.float64)
    edge = use & (alpha < 0.97)
    fg[edge] = F[edge]
    return np.clip(fg, 0, 255).astype(np.uint8), (np.clip(alpha, 0, 1) * 255).astype(np.uint8)


def grow_sky(lab: np.ndarray, tol: float):
    """The sky as it is grown from the top edge: across pixels that differ little from their neighbour (a gradient, a cloud), stopping at an edge. What the model calls a building but is a
    cloud on the sky's own gradient is caught by this."""
    h, w = lab.shape[:2]
    mask = np.zeros((h + 2, w + 2), np.uint8)
    flags = 4 | cv2.FLOODFILL_MASK_ONLY | (255 << 8)
    t = (tol,) * 3
    for x in range(0, w, 6):
        if not mask[1, x + 1]:
            cv2.floodFill(lab.copy(), mask, (x, 0), 0, t, t, flags)
    return mask[1:-1, 1:-1] > 0


def by_sky(rgb: np.ndarray, tol: float, band: int = 4, pocket: float = 10, clear: float = 22, reach_share: float = 0.07):
    """Not the sky. The sky is grown from the top edge across pixels that differ little from their neighbour (it follows a gradient, takes the clouds, stops at an edge); sky-coloured
    gaps that growing could not reach (between fronds, under a palm) are sky too (`pocket`: how close to the sky next to them, in Lab; `reach`: how far from the sky found, a share of the picture's height). A trimap is made of that: a `band` of unknown at
    the edge of the subject, and no pixel within `clear` of the sky's colour is sure to be the subject (a frond's fringe, a sky-coloured halo): all matted."""
    h, w = rgb.shape[:2]
    lab = cv2.cvtColor(cv2.GaussianBlur(rgb, (0, 0), 0.7), cv2.COLOR_RGB2LAB)
    mask = np.zeros((h + 2, w + 2), np.uint8)
    flags = 4 | cv2.FLOODFILL_MASK_ONLY | (255 << 8)
    t = (tol,) * 3
    for x in range(0, w, 6):
        if not mask[1, x + 1]:
            cv2.floodFill(lab.copy(), mask, (x, 0), 0, t, t, flags)
    grown = mask[1:-1, 1:-1] > 0
    near_sky = sky_colour(lab, grown)
    dist = np.linalg.norm(lab.astype(np.float64) - near_sky, axis=2)
    sky = grown.copy()
    # (only gaps next to the sky's own reach: a sky-coloured wall far from it is not sky)
    reach = cv2.dilate(grown.astype(np.uint8), ellipse(int(reach_share * h))).astype(bool)
    sky |= (dist < pocket) & reach
    sky = cv2.morphologyEx(sky.astype(np.uint8), cv2.MORPH_OPEN, ellipse(1)).astype(bool)
    subject = ~sky
    n, labels, areas, _ = cv2.connectedComponentsWithStats(subject.astype(np.uint8), connectivity=8)
    keep = np.zeros_like(subject)
    for i in range(1, n):
        comp = labels == i
        if comp[-1, :].any() or areas[i][cv2.CC_STAT_AREA] > 0.03 * h * w:
            keep |= comp
    sure_fg = cv2.erode(keep.astype(np.uint8), ellipse(band + 2)).astype(bool) & ((dist > clear) | ~reach)
    sure_bg = cv2.erode((~keep).astype(np.uint8), ellipse(band)).astype(bool)
    tri = np.full((h, w), 0.5)
    tri[sure_fg] = 1.0
    tri[sure_bg] = 0.0
    return matte(rgb, tri)


def refine(rgb: np.ndarray, alpha: np.ndarray, band: int):
    """Matting round the edge of a mask that is about right: a `band` of unknown on each side of it."""
    inside = (alpha > 127).astype(np.uint8)
    tri = np.full(alpha.shape, 0.5)
    tri[cv2.erode(inside, ellipse(band)).astype(bool)] = 1.0
    tri[~cv2.dilate(inside, ellipse(band)).astype(bool)] = 0.0
    fg, matted = matte(rgb, tri)
    # (a finger or a strap is thinner than the band: matting alone leaves it half transparent, and what is behind it shows through; what the mask holds well inside stays solid)
    solid = (cv2.erode(inside, ellipse(1)) * 255).astype(np.uint8)
    return fg, np.maximum(matted, solid)


_SEGFORMER = None
SEGFORMER_DIR = Path(os.environ.get("SEGFORMER_DIR", Path.home() / ".cache" / "catalyst-segformer"))


def semantic_probs(rgb: np.ndarray):
    """Per-class probabilities (150 ADE20K classes, a quarter of the model's 640 px input) of SegFormer-B5 (`SEGFORMER_DIR`: model.onnx and config.json from
    huggingface.co/Xenova/segformer-b5-finetuned-ade-640-640), and the class names."""
    global _SEGFORMER
    import onnxruntime as ort
    if _SEGFORMER is None:
        names = {int(k): v for k, v in json.loads((SEGFORMER_DIR / "config.json").read_text())["id2label"].items()}
        _SEGFORMER = (ort.InferenceSession(str(SEGFORMER_DIR / "model.onnx"), providers=["CPUExecutionProvider"]), names)
    session, names = _SEGFORMER
    x = cv2.resize(rgb, (640, 640), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    x = ((x - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)).transpose(2, 0, 1)[None]
    logits = session.run(None, {session.get_inputs()[0].name: x})[0][0]
    e = np.exp(logits - logits.max(axis=0, keepdims=True))
    return e / e.sum(axis=0, keepdims=True), names


def by_semantic(rgb: np.ndarray, classes=None, band: int = 4, clear: float = 22, boost=None, exclude=None, crop=None, darker: float = 28, grow: float = 0):
    """The subject by what the picture shows: everything that is not sky (`classes` absent: a skyline), or the pixels of the named classes (the boat, and not the river it floats on).
    `exclude`: everything but these classes (a boat is not sky and not water: the model calls its bags rock and animal); `crop`: the part of the picture (x0 y0 x1 y1, shares) the subject is in; `boost`: classes the model under-labels (sparse palm fronds are half sky to it) whose pixels, where they are not the sky's colour, are sure to be the subject. The model's mask is coarse (a quarter of 640 px): it says what each region is, a trimap is made of where it is sure, and matting finds the edge."""
    h, w = rgb.shape[:2]
    p, names = semantic_probs(rgb)
    ids = {v.split(",")[0]: k for k, v in names.items()}
    up = lambda m: np.clip(cv2.resize(m, (w, h), interpolation=cv2.INTER_CUBIC), 0, 1)
    sky_p = up(p[ids["sky"]])
    if exclude:
        subject_p = 1 - up(sum(p[ids[c]] for c in exclude))
    else:
        subject_p = 1 - sky_p if not classes else up(sum(p[ids[c]] for c in classes))
    if crop:
        keep_box = np.zeros((h, w), np.float32)
        keep_box[int(crop[1] * h):int(crop[3] * h), int(crop[0] * w):int(crop[2] * w)] = 1
        subject_p = subject_p * keep_box
    lab = cv2.cvtColor(cv2.GaussianBlur(rgb, (0, 0), 0.7), cv2.COLOR_RGB2LAB)
    sky_like = sky_p > 0.9
    if grow and not classes and not exclude:
        grown = grow_sky(lab, grow)
        sky_like = sky_like | grown
        subject_p = np.where(cv2.erode(grown.astype(np.uint8), ellipse(2)).astype(bool), 0.0, subject_p)
    near_sky = sky_colour(lab, sky_like)
    dist = np.linalg.norm(lab.astype(np.float64) - near_sky, axis=2)
    fg = (subject_p > 0.92).astype(np.uint8)
    bg = (subject_p < 0.08).astype(np.uint8)
    # (what is left of the subject and does not touch anything big is a fleck: not a subject)
    n, labels, areas, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
    keep = np.zeros_like(fg, bool)
    for i in range(1, n):
        if areas[i][cv2.CC_STAT_AREA] > 0.004 * h * w:
            keep |= labels == i
    sure_fg = cv2.erode(keep.astype(np.uint8), ellipse(band)).astype(bool)
    if not classes:
        sure_fg &= dist > clear
    sure_bg = cv2.erode(bg, ellipse(band)).astype(bool) | (~keep & (subject_p < 0.5) & cv2.erode((subject_p < 0.5).astype(np.uint8), ellipse(band)).astype(bool))
    if boost:
        boost_p = up(sum(p[ids[c]] for c in boost))
        sure_fg |= cv2.erode((boost_p > 0.3).astype(np.uint8), ellipse(1)).astype(bool) & (dist > clear)
        zone = cv2.dilate((boost_p > 0.15).astype(np.uint8), ellipse(8)).astype(bool)
        sure_bg &= ~zone
        # (round the palms the haze of the sky is as bright as the sky and a different colour from it: in that zone only what is `darker` than the sky next to it is sure to be the subject)
        sure_fg &= ~(zone & (lab[:, :, 0].astype(np.float64) > near_sky[:, :, 0] - darker))
    tri = np.full((h, w), 0.5)
    tri[sure_fg] = 1.0
    tri[sure_bg] = 0.0
    if not classes and not exclude:
        return sky_matte(rgb, tri, sky_like)
    return matte(rgb, tri)


def by_rod(rgb: np.ndarray, axis, half: float, flag):
    """A straight rod and its flag, cut by geometry and by the picture's own colours, not by a segmenter (a thin pole is ten pixels wide, half of them blended with whatever is behind).
    `axis`: the rod's centre line as (x, y) shares of the picture, top to base, roughly; `half`: its half width (share of the width), roughly; `flag`: the box (x0 y0 x1 y1, shares) of the
    cloth. Row by row the two strongest edges round the rough axis are found; a smooth curve is fitted through their middles and widths (a rod does not wobble), and the rod is drawn from
    that fit, each pixel's alpha the exact share the rod covers of it, its colour the rod's own at that height. The flag is keyed against the sky round it."""
    h, w = rgb.shape[:2]
    img = cv2.GaussianBlur(rgb, (0, 0), 0.7).astype(np.float64)
    lum = img @ np.array([0.299, 0.587, 0.114])
    lum = cv2.GaussianBlur(lum, (0, 0), sigmaX=0.8, sigmaY=2.0)
    grad = np.abs(np.gradient(lum, axis=1))
    xs = np.array([a[0] for a in axis]) * w
    ys = np.array([a[1] for a in axis]) * h
    hw = half * w
    rows, mids, widths, weights = [], [], [], []
    for y in range(int(ys[0]) + 12, int(ys[-1]) - 4):
        cx = float(np.interp(y, ys, xs))
        lo, hi = int(cx - 2.6 * hw), int(cx + 2.6 * hw)
        g = grad[y, lo:hi]
        best = None
        for i in range(len(g)):
            for j in range(i + int(1.2 * hw), min(len(g), i + int(3.0 * hw))):
                v = g[i] + g[j]
                if best is None or v > best[0]:
                    best = (v, i, j)
        if best and best[0] > 6:
            rows.append(y); mids.append(lo + (best[1] + best[2]) / 2 + 0.5); widths.append(best[2] - best[1]); weights.append(best[0])
    rows, mids, widths, weights = map(np.array, (rows, mids, widths, weights))
    keep = np.ones(len(rows), bool)
    for _ in range(4):
        cm = np.polyfit(rows[keep], mids[keep], 2, w=weights[keep])
        cw = np.polyfit(rows[keep], widths[keep], 1, w=weights[keep])
        keep = (np.abs(np.polyval(cm, rows) - mids) < 2.2) & (np.abs(np.polyval(cw, rows) - widths) < 4)
    alpha = np.zeros((h, w))
    fg = rgb.astype(np.float64).copy()
    core = {}
    for y in range(int(ys[0]), int(ys[-1]) + 1):
        c = float(np.polyval(cm, y))
        wd = float(np.polyval(cw, y))
        l, r = c - wd / 2, c + wd / 2
        xa, xb = int(np.floor(l)), int(np.ceil(r))
        for x in range(max(0, xa), min(w, xb + 1)):
            alpha[y, x] = max(0.0, min(x + 1, r) - max(x, l))
        core[y] = np.median(img[y, int(c - wd * 0.2):int(c + wd * 0.2) + 1], axis=0)
    # (the rod's colour is smoothed along its length: a row's core is noisy)
    yy = np.array(sorted(core))
    R = np.stack([core[y] for y in yy])
    from scipy.ndimage import median_filter
    R = median_filter(R, size=(9, 1), mode="nearest")
    for i, y in enumerate(yy):
        c = float(np.polyval(cm, y)); wd = float(np.polyval(cw, y))
        for x in range(max(0, int(c - wd)), min(w, int(c + wd) + 2)):
            if alpha[y, x] > 0:
                fg[y, x] = R[i] if alpha[y, x] < 0.99 else rgb[y, x]
    x0, y0, x1, y1 = (int(flag[0] * w), int(flag[1] * h), int(flag[2] * w), int(flag[3] * h))
    pad = 8
    ring = np.ones((h, w), bool)
    ring[:] = False
    ring[max(0, y0 - pad):y1 + pad, max(0, x0 - pad):x1 + pad] = True
    ring[y0:y1, x0:x1] = False
    B = np.median(img[ring], axis=0)
    d = np.linalg.norm(img - B, axis=2)
    key = np.clip((d - 34) / 30, 0, 1)
    box = np.zeros((h, w), bool)
    box[y0:y1, x0:x1] = True
    key = np.where(box, key, 0)
    # (the edge of the cloth is half sky: its colour is taken from the solid cloth next to it, or a bright sky-blue fringe shows against a dark card)
    solid = ((key > 0.92) & box).astype(np.float64)
    num = np.zeros_like(img)
    den = np.zeros((h, w))
    for sigma in (1.5, 3, 6):
        nn = cv2.GaussianBlur(img * solid[:, :, None], (0, 0), sigma)
        dd = cv2.GaussianBlur(solid, (0, 0), sigma)
        fill = (den < 1e-3) & (dd > 1e-3)
        num[fill] = nn[fill] / dd[fill][:, None]
        den[fill] = dd[fill]
    edge = box & (key > 0) & (key <= 0.92) & (den > 1e-3)
    fg[box & (key > 0)] = rgb[box & (key > 0)]
    fg[edge] = num[edge]
    alpha = np.maximum(alpha, key)
    return fg.astype(np.uint8), (alpha * 255).astype(np.uint8)


def recover_thin(rgb: np.ndarray, fg: np.ndarray, alpha: np.ndarray, height: float = 0.12, floor: float = 9.0, full: float = 22.0):
    """Spires, pinnacles, finials, a star on a tower: narrower than the model sees (a quarter of 640 px), so its mask cuts them off and they hang in the sky. Above the skyline the sky is smooth: the picture with
    everything thin taken out (a wide median) is the sky behind, and what differs from it, no higher than `height` over the subject and connected to it, is the subject. Its alpha is how much it differs (`floor` nothing,
    `full` solid), its colour the picture's own."""
    h, w = rgb.shape[:2]
    k = max(15, int(0.035 * w)) | 1
    behind = cv2.medianBlur(rgb, k)
    lab = cv2.cvtColor(cv2.GaussianBlur(rgb, (0, 0), 0.6), cv2.COLOR_RGB2LAB).astype(np.float64)
    diff = np.linalg.norm(lab - cv2.cvtColor(behind, cv2.COLOR_RGB2LAB).astype(np.float64), axis=2)
    solid = (alpha > 127).astype(np.uint8)
    # (a second look at the sky, spread from the clear sky away from the subject: at a building's corner the median mixes both and calls sky different from "behind"; what is really there is the sky's colour)
    clear = ~cv2.dilate(solid, ellipse(k // 2)).astype(bool) & (diff < floor)
    far = np.linalg.norm(lab - sky_colour(lab.astype(np.uint8), clear), axis=2)
    diff = np.minimum(diff, far)
    reach = int(height * h)
    # (the pixels that have the subject below them within `reach`: the dilation looks downward from its anchor)
    above = cv2.dilate(solid, np.ones((reach, 9), np.uint8), anchor=(4, 0)).astype(bool)
    found = (diff > floor * 1.4) & above
    joined = (solid.astype(bool) | cv2.dilate(found.astype(np.uint8), ellipse(1)).astype(bool)).astype(np.uint8)
    n, labels = cv2.connectedComponents(joined, connectivity=8)
    keep = np.zeros(n, bool)
    keep[np.unique(labels[solid.astype(bool)])] = True
    keep[0] = False
    zone = cv2.dilate(found.astype(np.uint8), ellipse(1)).astype(bool) & keep[labels]
    thin = np.clip((diff - floor) / (full - floor), 0, 1) * 255
    take = zone & (thin > alpha)
    out_fg = fg.copy()
    out_fg[take] = rgb[take]
    out = alpha.copy()
    out[take] = thin[take].astype(np.uint8)
    return out_fg, out


def fill_holes(rgb: np.ndarray, fg: np.ndarray, alpha: np.ndarray, reach: int = 7):
    """A slot in a statue or a window as bright as the sky is cut out of the subject: what is (nearly) closed in by the solid subject, and so not the sky, is made solid again. `reach`: how wide a mouth is closed to find it."""
    solid = (alpha > 160).astype(np.uint8)
    closed = cv2.morphologyEx(solid, cv2.MORPH_CLOSE, ellipse(reach))
    outside = (1 - closed).astype(np.uint8)
    n, labels = cv2.connectedComponents(outside, connectivity=4)
    sky = np.unique(labels[0, :][outside[0, :] > 0])
    hole = (closed > 0) | ((outside > 0) & ~np.isin(labels, sky))
    hole &= alpha < 250
    # (not the open edge: only what has solid on both sides across, well inside the shape)
    inner = cv2.erode(closed, ellipse(2)).astype(bool) | (~np.isin(labels, sky) & (outside > 0))
    take = hole & inner
    out_fg, out = fg.copy(), alpha.copy()
    out_fg[take] = rgb[take]
    out[take] = 255
    return out_fg, out


def trim_edge(rgb: np.ndarray, fg: np.ndarray, alpha: np.ndarray, px: int = 1):
    """The last cut: the edge is drawn in by `px` (a rim of half-sky round trees and roofs reads as a silver lining on the card), thin things (a mast, a spire, a cross) kept as they are; and what is still brighter than the
    subject just inside, along the edge, takes the subject's colour."""
    core = (alpha > 127).astype(np.uint8)
    wide = cv2.morphologyEx(core, cv2.MORPH_OPEN, ellipse(px + 2))
    thin = cv2.dilate((core & ~cv2.dilate(wide, ellipse(2))).astype(np.uint8), ellipse(1)).astype(bool)
    out = np.where(thin, alpha, cv2.erode(alpha, ellipse(px)))
    solid = cv2.erode(core, ellipse(px + 3)).astype(np.float64)
    img = fg.astype(np.float64)
    near = cv2.GaussianBlur(img * solid[:, :, None], (0, 0), 5)
    weight = cv2.GaussianBlur(solid, (0, 0), 5)
    inner = near / np.maximum(weight, 1e-6)[:, :, None]
    luma = np.array([0.299, 0.587, 0.114])
    rim = (out > 0) & (solid == 0) & ~thin & (weight > 0.02) & (img @ luma > inner @ luma + 12)
    out_fg = fg.copy()
    out_fg[rim] = inner[rim].astype(np.uint8)
    return out_fg, out.astype(np.uint8)


def by_polygon(rgb: np.ndarray, poly, band: int = 7, minus=None):
    """A hand-drawn polygon of the subject (shares of the picture): a band of unknown round its edge, matted."""
    h, w = rgb.shape[:2]
    pts = np.array([[x * w, y * h] for x, y in poly], np.int32)
    inside = np.zeros((h, w), np.uint8)
    cv2.fillPoly(inside, [pts], 1)
    if minus:
        # (the outline is drawn by hand, the water's edge is found by the model: what it calls water is not the boat)
        p, names = semantic_probs(rgb)
        ids = {v.split(",")[0]: k for k, v in names.items()}
        gone = np.clip(cv2.resize(sum(p[ids[c]] for c in minus), (w, h), interpolation=cv2.INTER_CUBIC), 0, 1) > 0.5
        inside = inside & ~cv2.dilate(gone.astype(np.uint8), ellipse(1)).astype(bool).astype(np.uint8)
    sure_fg = cv2.erode(inside, ellipse(band)).astype(bool)
    sure_bg = ~cv2.dilate(inside, ellipse(band)).astype(bool)
    tri = np.full((h, w), 0.5)
    tri[sure_fg] = 1.0
    tri[sure_bg] = 0.0
    return matte(rgb, tri)


def stats(alpha: np.ndarray, percentile: float = 15):
    """coverage, centroid, box, and the subject's top edge: the row that the tallest `percentile`% (15 by default) of the columns it is in start above (a spire or a pole does not move it, but the tallest buildings count: they are what hides the most of the word)."""
    h, w = alpha.shape
    on = alpha > 127
    n = int(on.sum())
    if n == 0:
        return None
    ys, xs = np.nonzero(on)
    cols = on.any(axis=0)
    first = on.argmax(axis=0)[cols]
    return {
        "coverage": round(n / (w * h), 3),
        "cx": round(float(xs.mean()) / w, 3),
        "cy": round(float(ys.mean()) / h, 3),
        "top": round(float(np.percentile(first, percentile)) / h, 3),
        "box": [round(xs.min() / w, 3), round(ys.min() / h, 3), round(xs.max() / w, 3), round(ys.max() / h, 3)],
    }


def main():
    args = sys.argv[1:]
    only = args[args.index("--only") + 1] if "--only" in args else None
    debug = Path(args[args.index("--debug") + 1]) if "--debug" in args else None
    if debug:
        debug.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text()) if only and MANIFEST.exists() else {}
    files = sorted(p for d in ("photograph", "routes") for p in (MEDIA / d).rglob("*.webp") if p.name.startswith(("photo.", "image.")) and ".cutout." not in p.name and "-800w" not in p.name)
    for path in files:
        folder = path.parent.name
        if only and folder != only:
            continue
        src = "/media/" + path.relative_to(MEDIA).as_posix()
        cfg = CONFIG.get(f"{folder}/{path.name}") or CONFIG.get(folder, {"mode": "vision"})
        out = path.with_name(path.name[: -len(".webp")] + ".cutout.webp")
        rgb = np.array(Image.open(path).convert("RGB"))
        mode = os.environ.get("CUTOUT_FORCE") or cfg["mode"]
        alpha = None
        fg = rgb
        if mode == "vision":
            alpha = by_vision(path, rgb)
            if alpha is not None:
                # (Vision's mask is soft and a little fat at the edge: it is the trimap's middle, the edge is matted)
                fg, alpha = refine(rgb, alpha, cfg.get("band", 5))
        elif mode == "semantic":
            fg, alpha = by_semantic(rgb, cfg.get("classes"), cfg.get("band", 4), cfg.get("clear", 22), cfg.get("boost"), cfg.get("exclude"), cfg.get("crop"), cfg.get("darker", 28), cfg.get("grow", 0))
            if cfg.get("spires"):
                fg, alpha = recover_thin(rgb, fg, alpha)
            if cfg.get("holes"):
                fg, alpha = fill_holes(rgb, fg, alpha, cfg["holes"])
            for outline in cfg.get("solid", []):
                # (a shape drawn by hand where the model is unsure of a plain solid object: the picture's own pixels, whole, with a soft pixel of edge)
                h_, w_ = rgb.shape[:2]
                inside = np.zeros((h_, w_), np.uint8)
                cv2.fillPoly(inside, [np.array([[x * w_ * 4, y * h_ * 4] for x, y in outline], np.int32)], 255, lineType=cv2.LINE_AA, shift=2)
                take = inside > alpha
                fg, alpha = fg.copy(), alpha.copy()
                fg[inside > 40] = rgb[inside > 40]
                alpha[take] = inside[take]
        elif mode == "sky":
            fg, alpha = by_sky(rgb, cfg.get("tol", 2), cfg.get("band", 4), cfg.get("pocket", 10), cfg.get("clear", 22), cfg.get("reach", 0.07))
            if cfg.get("spires"):
                fg, alpha = recover_thin(rgb, fg, alpha, floor=cfg.get("floor", 14), full=cfg.get("full", 30))
        elif mode == "rod":
            fg, alpha = by_rod(rgb, cfg["axis"], cfg["half"], cfg["flag"])
        elif mode == "polygon":
            fg, alpha = by_polygon(rgb, cfg["polygon"], cfg.get("band", 7), cfg.get("minus"))
        if alpha is not None and "keep" in cfg:
            # (an outline drawn by hand beyond which nothing is subject: the misty distance behind a city, which the model counts as not sky)
            h_, w_ = rgb.shape[:2]
            inside = np.zeros((h_, w_), np.uint8)
            cv2.fillPoly(inside, [np.array([[x * w_ * 4, y * h_ * 4] for x, y in cfg["keep"]], np.int32)], 255, lineType=cv2.LINE_AA, shift=2)
            whole = alpha
            alpha = np.minimum(alpha, cv2.GaussianBlur(inside, (0, 0), cfg.get("feather", 0.8)))
            if "soft" in cfg:
                area = np.zeros((h_, w_), np.uint8)
                cv2.fillPoly(area, [np.array([[x * w_ * 4, y * h_ * 4] for x, y in cfg["soft"]["outline"]], np.int32)], 255, lineType=cv2.LINE_AA, shift=2)
                half = (cv2.GaussianBlur(area, (0, 0), cfg["soft"]["feather"]) * cfg["soft"]["level"]).astype(np.uint8)
                alpha = np.maximum(alpha, np.minimum(whole, half))
        if alpha is not None and mode != "rod" and cfg.get("trim", 1):
            fg, alpha = trim_edge(rgb, fg, alpha, cfg.get("trim", 1))
        s = stats(alpha, cfg.get("percentile", 15)) if alpha is not None else None
        if s is None:
            out.unlink(missing_ok=True)
            manifest.pop(src, None)
            print(f"  none  {folder}")
            continue
        if "occlude" in cfg:
            s["occlude"] = cfg["occlude"]
        if "top" in cfg:
            s["top"] = cfg["top"]
        if "cx" in cfg:
            s["cx"] = cfg["cx"]
        if cfg.get("force"):
            s["force"] = True
        if cfg.get("blend"):
            s["blend"] = True
        if cfg.get("placeOnly"):
            # (no cutout drawn: the stats only place the photograph by this edge)
            s["placeOnly"] = True
            out.unlink(missing_ok=True)
            manifest[src] = s
            print(f"  place   {s['coverage']:.2f} top {s['top']:.2f}  {folder}")
            continue
        rgba = np.dstack([fg, alpha])
        png = Path(tempfile.mkstemp(suffix=".png")[1])
        Image.fromarray(rgba, "RGBA").save(png)
        subprocess.run(["cwebp", "-quiet", "-q", "82", "-alpha_q", "90", "-exact", str(png), "-o", str(out)], check=True)
        if debug:
            a = (alpha[:, :, None] / 255.0)
            both = [(fg * a + np.full_like(rgb, c) * (1 - a)).astype(np.uint8) for c in (34, 215)]
            Image.fromarray(np.hstack(both)).save(debug / f"{folder}.png")
        png.unlink()
        manifest[src] = s
        print(f"  {mode:8}{s['coverage']:.2f} top {s['top']:.2f}  {folder}")
    MANIFEST.write_text(json.dumps(manifest, indent=1) + "\n")


main()
