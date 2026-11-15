"""Bake app/globe/engine/eclipses.json: the lunar and solar eclipses of 2025 to 2045 from NASA's Five Millennium Catalogs (Espenak and Meeus), for the moon's HUD (#633).

    curl -o le.html https://eclipse.gsfc.nasa.gov/LEcat5/LE2001-2100.html
    curl -o se.html https://eclipse.gsfc.nasa.gov/SEcat5/SE2001-2100.html
    python3 apps/web/scripts/moon/bake-eclipses.py le.html se.html apps/web/app/globe/engine/eclipses.json

Each eclipse is [unix seconds UTC of the greatest eclipse, type, magnitude]. The catalogues give the time in Terrestrial Dynamical Time and Delta T beside it: the baked time is TD minus Delta T (UT, to the second).
Lunar types: N penumbral, P partial, T total (magnitude: the umbral one, or the penumbral for N). Solar types: P partial, A annular, T total, H hybrid (magnitude: the eclipse magnitude).
Standard library only. The source and licence are in public/media/eclipses.NOTICE.txt.
"""
import calendar
import json
import re
import sys

FIRST, LAST = 2025, 2045
MONTHS = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}
ROW = re.compile(r"(\d{4}) ([A-Z][a-z]{2}) (\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+(-?\d+)\s+-?\d+\s+\d+\s+([A-Z])\S*\s+\S+\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)(?:\s+(-?\d+\.\d+))?")


def rows(path, solar):
    out = []
    for line in open(path, encoding="utf-8", errors="replace"):
        text = re.sub(r"<[^>]+>", "", line)
        m = ROW.search(text)
        if not m:
            continue
        y, mon, d, hh, mm, ss, dt, kind = m.groups()[:8]
        if not FIRST <= int(y) <= LAST:
            continue
        # lunar: gamma, penumbral magnitude, umbral magnitude; solar: gamma, eclipse magnitude
        a, b, c = m.group(9), m.group(10), m.group(11)
        mag = float(b) if solar else float(c if c is not None and kind != "N" else b)
        t = calendar.timegm((int(y), MONTHS[mon], int(d), int(hh), int(mm), int(ss))) - int(dt)
        out.append([t, kind, round(mag, 3)])
    return sorted(out)


lunar, solar = rows(sys.argv[1], False), rows(sys.argv[2], True)
json.dump({"source": "NASA Five Millennium Catalogs of Lunar and Solar Eclipses (Espenak and Meeus), https://eclipse.gsfc.nasa.gov", "range": [FIRST, LAST], "lunar": lunar, "solar": solar}, open(sys.argv[3], "w"), separators=(",", ":"))
print(len(lunar), "lunar,", len(solar), "solar eclipses")
