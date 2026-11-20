"""D4: OSM building footprints -> web/public/data/buildings.geojson (standard library only).

Fetches buildings for the demo bbox + 100 m from Overpass (raw JSON cached in
data/cache/overpass_buildings.json, never re-downloaded), sets height_m with the
CLAUDE.md fallback (OSM height, else building:levels x 3.2, else 6 m) and writes
the contract file in [lon, lat]. Run: cd data && uv run python buildings.py
"""
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache" / "overpass_buildings.json"
OUT = HERE.parent / "web" / "public" / "data" / "buildings.geojson"

BBOX = [153.02849, -27.46277, 153.03455, -27.45735]  # [minLon, minLat, maxLon, maxLat]
MARGIN_M = 100.0
LEVEL_M = 3.2
DEFAULT_M = 6.0
ENDPOINTS = ["https://overpass-api.de/api/interpreter"]


def expand(bbox, metres):  # same arithmetic as validate.py
    lat_c = (bbox[1] + bbox[3]) / 2
    dlat = metres / 111_000.0
    dlon = metres / (111_320.0 * math.cos(math.radians(lat_c)))
    return [bbox[0] - dlon, bbox[1] - dlat, bbox[2] + dlon, bbox[3] + dlat]


BOX = expand(BBOX, MARGIN_M)


def fetch():
    if CACHE.exists():
        print(f"using cached {CACHE}")
        return json.loads(CACHE.read_text())
    w, s, e, n = BOX
    q = (f'[out:json][timeout:90];(way["building"]({s},{w},{n},{e});'
         f'relation["building"]({s},{w},{n},{e}););out geom tags;')
    body = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(6):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": "shade-router-data/1.0"})
                with urllib.request.urlopen(req, timeout=120) as r:
                    raw = r.read()
                data = json.loads(raw)
                CACHE.parent.mkdir(parents=True, exist_ok=True)
                CACHE.write_bytes(raw)
                print(f"downloaded {len(raw)} bytes -> {CACHE}")
                return data
            except Exception as ex:  # noqa: BLE001
                last = ex
                print(f"attempt {attempt + 1} {url}: {type(ex).__name__}: {ex}", file=sys.stderr)
        time.sleep(min(30 * 2 ** attempt, 300))
    raise SystemExit(f"Overpass download failed: {last!r}")


def parse_height(tags):
    """Return (height_m, source)."""
    h = tags.get("height")
    if h:
        m = re.match(r"^\s*(\d+(?:[.,]\d+)?)\s*(m|meters?|metres?|ft|feet|')?\s*$", h.strip().lower())
        if m:
            v = float(m.group(1).replace(",", "."))
            if m.group(2) in ("ft", "feet", "'"):
                v *= 0.3048
            if v > 0:
                return round(v, 2), "osm"
    lv = tags.get("building:levels")
    if lv:
        m = re.match(r"^\s*(\d+(?:[.,]\d+)?)", lv)
        if m and float(m.group(1).replace(",", ".")) > 0:
            return round(float(m.group(1).replace(",", ".")) * LEVEL_M, 2), "levels"
    return DEFAULT_M, "default"


def ring_from(geom):
    ring = [[round(p["lon"], 6), round(p["lat"], 6)] for p in geom]
    if ring and ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def join_ways(ways):
    """Join open way fragments into closed rings (by shared end points)."""
    segs = [[(p["lon"], p["lat"]) for p in w] for w in ways if len(w) >= 2]
    rings = []
    while segs:
        cur = segs.pop(0)
        grew = True
        while grew and cur[0] != cur[-1]:
            grew = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]:
                    cur += s[1:]
                elif s[-1] == cur[-1]:
                    cur += s[::-1][1:]
                elif s[-1] == cur[0]:
                    cur = s[:-1] + cur
                elif s[0] == cur[0]:
                    cur = s[::-1][:-1] + cur
                else:
                    continue
                segs.pop(i)
                grew = True
                break
        if cur[0] == cur[-1] and len(cur) >= 4:
            rings.append([{"lon": x, "lat": y} for x, y in cur])
    return rings


def signed_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2


def inside(ring):
    return all(BOX[0] <= x <= BOX[2] and BOX[1] <= y <= BOX[3] for x, y in ring)


def main():
    data = fetch()
    feats, counts, dropped_outside, dropped_bad = [], {}, 0, 0
    for el in data["elements"]:
        tags = el.get("tags", {})
        if tags.get("building") in (None, "no"):
            continue
        if el["type"] == "way":
            rings = [ring_from(el["geometry"])] if len(el.get("geometry", [])) >= 3 else []
            polys = [[r] for r in rings if len(r) >= 4]
        else:  # multipolygon relation: outer rings, holes attached by containment is skipped (footprint shade only)
            outers = [m["geometry"] for m in el.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
            inners = [m["geometry"] for m in el.get("members", []) if m.get("role") == "inner" and m.get("geometry")]
            outs = [ring_from(g) for g in join_ways(outers)]
            ins = [ring_from(g) for g in join_ways(inners)]
            polys = [[o] for o in outs]
            for hole in ins:  # attach each hole to the first outer containing its first vertex
                for poly in polys:
                    o = poly[0]
                    x, y = hole[0]
                    xs = [p[0] for p in o]
                    ys = [p[1] for p in o]
                    if min(xs) <= x <= max(xs) and min(ys) <= y <= max(ys):
                        poly.append(hole)
                        break
        polys = [p for p in polys if len(p[0]) >= 4 and abs(signed_area(p[0])) > 0]
        if not polys:
            dropped_bad += 1
            continue
        polys = [p for p in polys if inside([pt for r in p for pt in r])]
        if not polys:
            dropped_outside += 1
            continue
        # contract: exterior ring counter-clockwise (RFC 7946), holes clockwise
        for p in polys:
            for i, r in enumerate(p):
                if (signed_area(r) > 0) != (i == 0):
                    r.reverse()
        h, src = parse_height(tags)
        counts[src] = counts.get(src, 0) + 1
        geom = ({"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1
                else {"type": "MultiPolygon", "coordinates": polys})
        fid = f"{el['type']}/{el['id']}"
        feats.append({"type": "Feature", "id": fid,
                      "properties": {"id": fid, "height_m": h, "height_source": src},
                      "geometry": geom})
    feats.sort(key=lambda f: f["properties"]["id"])  # deterministic output
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")) + "\n")
    print(f"wrote {len(feats)} buildings -> {OUT}")
    for k in ("osm", "levels", "default"):
        print(f"  height_source {k}: {counts.get(k, 0)}")
    print(f"  dropped: {dropped_outside} extending beyond bbox+100 m, {dropped_bad} with unusable geometry")


if __name__ == "__main__":
    main()
