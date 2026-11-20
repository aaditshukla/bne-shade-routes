#!/usr/bin/env python3
"""D6: OSM street/park trees -> web/public/data/trees.geojson (contracts/data-formats.md).

    cd data && uv run python trees.py                       # Overpass (cached) -> web/public/data/trees.geojson
    uv run python trees.py --cache FILE --out FILE          # other raw-JSON cache / output file

Source: OSM natural=tree nodes plus natural=tree_row lines sampled every 8 m (Overpass, raw JSON cached
in data/cache/overpass_trees.json and never re-downloaded). The BCC 'Protected Vegetation, Council
Vegetation' export is the better source if it ever becomes reachable; this script does not use it.

Per tree: canopy_radius_m = diameter_crown / 2 (else 4 m), height_m = height tag (else 8 m).
Trees are kept only inside the demo bbox (contract); row samples within 2 m of a tree node are dropped.
Row sampling is done in EPSG:7856 (metres); coordinates are written as [lon, lat], 6 decimals.
"""
import argparse
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DEFAULT_CACHE = HERE / "cache" / "overpass_trees.json"
DEFAULT_OUT = ROOT / "web" / "public" / "data" / "trees.geojson"

BBOX = [153.02849, -27.46277, 153.03455, -27.45735]  # [minLon, minLat, maxLon, maxLat], CLAUDE.md
DEFAULT_RADIUS_M = 4.0
DEFAULT_HEIGHT_M = 8.0
ROW_SPACING_M = 8.0
DEDUP_M = 2.0
ENDPOINTS = ["https://overpass-api.de/api/interpreter"]   # only host the network policy was meant to allow

TO_M = Transformer.from_crs(4326, 7856, always_xy=True)
TO_DEG = Transformer.from_crs(7856, 4326, always_xy=True)


def fetch(cache):
    if cache.exists():
        print(f"using cached {cache}")
        return json.loads(cache.read_text(encoding="utf-8"))
    w, s, e, n = BBOX
    q = (f'[out:json][timeout:90];(node["natural"="tree"]({s},{w},{n},{e});'
         f'way["natural"="tree_row"]({s},{w},{n},{e}););out geom tags;')
    body = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(6):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": "shade-router-data/1.0"})
                with urllib.request.urlopen(req, timeout=120) as r:
                    raw = r.read()
                data = json.loads(raw)
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_bytes(raw)
                print(f"downloaded {len(raw)} bytes -> {cache}")
                return data
            except Exception as ex:  # noqa: BLE001
                last = ex
                print(f"attempt {attempt + 1} {url}: {type(ex).__name__}: {ex}", file=sys.stderr)
        time.sleep(min(30 * 2 ** attempt, 300))
    raise SystemExit(f"Overpass download failed: {last!r}")


def num(tags, key):
    """First number in an OSM tag like '12', '12 m', '5.5'; None if absent/unusable/non-positive."""
    m = re.match(r"^\s*(\d+(?:[.,]\d+)?)", tags.get(key, "") or "")
    if not m:
        return None
    v = float(m.group(1).replace(",", "."))
    return v if v > 0 else None


def tree_props(tags):
    """(radius, height, from_osm) with the CLAUDE.md defaults (4 m radius, 8 m height)."""
    crown, height = num(tags, "diameter_crown"), num(tags, "height")
    r = round(crown / 2, 2) if crown else DEFAULT_RADIUS_M
    h = round(height, 2) if height else DEFAULT_HEIGHT_M
    return r, h, bool(crown or height)


def inside(lon, lat):
    return BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


def sample_row(geom):
    """Points every ROW_SPACING_M along a tree_row (EPSG:7856), starting half a step in. Returns [(lon, lat)]."""
    pts = [TO_M.transform(p["lon"], p["lat"]) for p in geom]
    if len(pts) < 2:
        return [(geom[0]["lon"], geom[0]["lat"])] if geom else []
    line = LineString(pts)
    n = max(1, round(line.length / ROW_SPACING_M))
    out = []
    for k in range(n):
        p = line.interpolate(line.length * (k + 0.5) / n)
        out.append(TO_DEG.transform(p.x, p.y))
    return out


def build(data):
    feats, counts = [], {"node": 0, "row": 0, "row_dropped_dup": 0, "outside": 0, "from_osm_dims": 0}
    nodes_m = []
    for el in sorted(data["elements"], key=lambda e: (e["type"], e["id"])):
        tags = el.get("tags", {})
        if el["type"] == "node" and tags.get("natural") == "tree":
            if not inside(el["lon"], el["lat"]):
                counts["outside"] += 1
                continue
            r, h, osm_dims = tree_props(tags)
            counts["node"] += 1
            counts["from_osm_dims"] += osm_dims
            nodes_m.append(TO_M.transform(el["lon"], el["lat"]))
            feats.append((f"osm/node/{el['id']}", el["lon"], el["lat"], r, h))
    for el in sorted(data["elements"], key=lambda e: (e["type"], e["id"])):
        tags = el.get("tags", {})
        if el["type"] == "way" and tags.get("natural") == "tree_row" and el.get("geometry"):
            r, h, osm_dims = tree_props(tags)
            for k, (lon, lat) in enumerate(sample_row(el["geometry"])):
                if not inside(lon, lat):
                    counts["outside"] += 1
                    continue
                x, y = TO_M.transform(lon, lat)
                if any(math.hypot(x - nx, y - ny) < DEDUP_M for nx, ny in nodes_m):
                    counts["row_dropped_dup"] += 1
                    continue
                counts["row"] += 1
                counts["from_osm_dims"] += osm_dims
                feats.append((f"osm/way/{el['id']}#{k}", lon, lat, r, h))
    feats.sort(key=lambda f: f[0])
    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "id": fid,
         "properties": {"id": fid, "canopy_radius_m": r, "height_m": h, "source": "osm"},
         "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}}
        for fid, lon, lat, r, h in feats]}
    return fc, counts


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", default=str(DEFAULT_CACHE), help="raw Overpass JSON cache (downloaded if missing)")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="trees.geojson output path")
    args = ap.parse_args()
    fc, c = build(fetch(Path(args.cache)))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(fc, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {len(fc['features'])} trees -> {out}")
    print(f"  from natural=tree nodes: {c['node']}, sampled from tree_row lines (every {ROW_SPACING_M:g} m): {c['row']}")
    print(f"  with OSM crown/height tags: {c['from_osm_dims']}, defaults ({DEFAULT_RADIUS_M:g} m / {DEFAULT_HEIGHT_M:g} m): "
          f"{len(fc['features']) - c['from_osm_dims']}")
    print(f"  dropped: {c['outside']} outside the bbox, {c['row_dropped_dup']} row samples within {DEDUP_M:g} m of a tree node")


if __name__ == "__main__":
    main()
