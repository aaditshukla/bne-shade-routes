#!/usr/bin/env python3
"""Shadow engine (D3): sun position + building/tree shadows -> per-edge sunFraction for 51 slots.

    cd data && uv run python shadows.py                      # fixtures in web/public/data/ -> cache/shade_computed.json
    uv run python shadows.py --dir DIR --out FILE            # other data dir / output file
    uv run python shadows.py --shadows-dir DIR               # also write shadows/HHMM.geojson (Q1)
    uv run python shadows.py --png cache/check_1630.png      # PNG path (default data/cache/check_1630.png)

Reads graph.json, buildings.geojson, trees.geojson from DIR (default web/public/data).
Writes shade.json per contracts/data-formats.md WITHOUT awnings merged: build.py merges verified
awnings afterwards. By default the output goes to data/cache/ so the hand-shaped fixture shade.json
(which the ladder's shortest-vs-shadiest split depends on) is not overwritten; pass --out to replace it.

All geometry is done in EPSG:7856 (metres). Coordinates in/out are [lon, lat].
"""
import argparse
import json
import math
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer
from pysolar.solar import get_altitude, get_azimuth
from shapely import STRtree
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DIR = ROOT / "web" / "public" / "data"
CACHE = Path(__file__).resolve().parent / "cache"

DATE = (2026, 11, 21)
TZ = timezone(timedelta(hours=10))  # Australia/Brisbane, no DST
N_SLOTS = 51
SLOTS = [f"{(360 + 15 * i) // 60:02d}:{(360 + 15 * i) % 60:02d}" for i in range(N_SLOTS)]
SHADOW_MARGIN_M = 200.0
MAX_SHADOW_M = 3000.0      # cap on sweep length near sunset (everything beyond is clipped anyway)
SIMPLIFY_M = 0.5
# (slot, alt, alt_tol, az, az_tol): sanity values from CLAUDE.md
SUN_CHECKS = [(12, 54.0, 0.7, 86.0, 1.0), (42, 22.7, 0.3, 258.5, 0.5)]

TO_M = Transformer.from_crs("EPSG:4326", "EPSG:7856", always_xy=True)
TO_DEG = Transformer.from_crs("EPSG:7856", "EPSG:4326", always_xy=True)


# ---------------------------------------------------------------- sun
def sun_positions(lon, lat):
    """[(alt_deg, az_deg)] for the 51 slots; az is clockwise from true north."""
    out = []
    for i in range(N_SLOTS):
        m = 360 + 15 * i
        t = datetime(*DATE, m // 60, m % 60, tzinfo=TZ)
        alt = float(get_altitude(lat, lon, t))
        az = float(get_azimuth(lat, lon, t)) % 360.0
        out.append((alt, az))
    return out


def check_sun(sun):
    for slot, alt, alt_tol, az, az_tol in SUN_CHECKS:
        a, z = sun[slot]
        assert abs(a - alt) <= alt_tol and abs(z - az) <= az_tol, (
            f"sun check failed at {SLOTS[slot]}: got alt {a:.2f} az {z:.2f}, expected ~{alt} / ~{az} "
            "(azimuth must be clockwise from north)")
    assert sun[49][0] > 0 and sun[50][0] < 0, "sun should still be up at 18:15 and down at 18:30"


# ---------------------------------------------------------------- geometry
def project_coords(coords):
    xs, ys = TO_M.transform([c[0] for c in coords], [c[1] for c in coords])
    return list(zip(xs, ys))


def project_polygon(geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    out = []
    for rings in polys:
        p = Polygon(project_coords(rings[0]), [project_coords(r) for r in rings[1:]])
        if not p.is_valid:
            p = p.buffer(0)
        out.extend(p.geoms if p.geom_type == "MultiPolygon" else [p])
    return [p for p in out if not p.is_empty]


def sweep(poly, dx, dy):
    """Shadow of a prism: footprint swept along (dx, dy) = union of footprint, its translate and one quad per ring edge."""
    parts = [poly, shapely.affinity.translate(poly, dx, dy)]
    for ring in [poly.exterior, *poly.interiors]:
        c = np.asarray(ring.coords)
        for (x1, y1), (x2, y2) in zip(c[:-1], c[1:]):
            q = Polygon([(x1, y1), (x2, y2), (x2 + dx, y2 + dy), (x1 + dx, y1 + dy)])
            if q.area > 1e-9:
                parts.append(q if q.is_valid else q.buffer(0))
    return unary_union(parts)


def slot_shadow(buildings, trees, alt, az, clip):
    """Union of building shadows and tree-canopy discs for one slot, clipped to `clip` (EPSG:7856)."""
    if alt <= 0:
        return Polygon()
    k = 1.0 / math.tan(math.radians(alt))
    sx, sy = math.sin(math.radians(az + 180.0)), math.cos(math.radians(az + 180.0))  # E, N of the shadow direction
    parts = []
    for poly, h in buildings:
        d = min(h * k, MAX_SHADOW_M)
        parts.append(sweep(poly, d * sx, d * sy))
    for (x, y), r, h in trees:
        d = min(h * k, MAX_SHADOW_M)
        parts.append(Point(x + d * sx, y + d * sy).buffer(r, 16))
    if not parts:
        return Polygon()
    return unary_union(parts).intersection(clip)


def sun_fraction(edges_m, tree, shadow):
    """1 - shaded length / length for every edge; edges_m is an array of LineStrings."""
    out = np.ones(len(edges_m))
    if shadow.is_empty:
        return out
    idx = tree.query(shadow, predicate="intersects")
    if len(idx):
        shaded = shapely.length(shapely.intersection(edges_m[idx], shadow))
        out[idx] = 1.0 - np.clip(shaded / shapely.length(edges_m[idx]), 0.0, 1.0)
    return out


def to_geojson_features(shadow):
    """Simplify (0.5 m) and convert an EPSG:7856 (Multi)Polygon back to [lon, lat] features, 6 decimals."""
    if shadow.is_empty:
        return []
    shadow = shadow.simplify(SIMPLIFY_M, preserve_topology=True)
    polys = [shadow] if shadow.geom_type == "Polygon" else [g for g in shadow.geoms if g.geom_type == "Polygon"]

    def ring(r):
        xs, ys = TO_DEG.transform(*zip(*r.coords))
        return [[round(x, 6), round(y, 6)] for x, y in zip(xs, ys)]

    coords = [[ring(p.exterior)] + [ring(i) for i in p.interiors] for p in polys if not p.is_empty]
    if not coords:
        return []
    return [{"type": "Feature", "properties": {}, "geometry": {"type": "MultiPolygon", "coordinates": coords}}]


# ---------------------------------------------------------------- IO
def load(data_dir):
    d = Path(data_dir)
    graph = json.loads((d / "graph.json").read_text(encoding="utf-8"))
    bfc = json.loads((d / "buildings.geojson").read_text(encoding="utf-8"))
    tfc = json.loads((d / "trees.geojson").read_text(encoding="utf-8"))
    buildings = []
    for f in bfc["features"]:
        h = float(f["properties"]["height_m"])
        buildings += [(p, h) for p in project_polygon(f["geometry"])]
    trees = []
    for f in tfc["features"]:
        p = f["properties"]
        x, y = TO_M.transform(*f["geometry"]["coordinates"])
        trees.append(((x, y), float(p.get("canopy_radius_m", 4.0)), float(p.get("height_m", 8.0))))
    return graph, buildings, trees


def write_png(path, graph, edges_m, buildings, trees, shadow, alt, az, clip_bounds):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    vx, vy = TO_M.transform(graph["venue"]["lon"], graph["venue"]["lat"])
    fig, ax = plt.subplots(figsize=(9, 9), dpi=110)
    polys = [] if shadow.is_empty else ([shadow] if shadow.geom_type == "Polygon" else list(shadow.geoms))
    for p in polys:
        ax.fill(*(np.asarray(p.exterior.coords) - [vx, vy]).T, color="#5b6b8c", alpha=0.45, lw=0, zorder=1)
        for i in p.interiors:
            ax.fill(*(np.asarray(i.coords) - [vx, vy]).T, color="white", lw=0, zorder=1)
    for ln in edges_m:
        ax.plot(*(np.asarray(ln.coords) - [vx, vy]).T, color="#888", lw=1, zorder=2)
    for poly, h in buildings:
        ax.fill(*(np.asarray(poly.exterior.coords) - [vx, vy]).T, color="#d9a066", ec="#7a4a12", lw=1, zorder=3)
        c = poly.centroid
        ax.annotate(f"{h:g} m", (c.x - vx, c.y - vy), ha="center", va="center", fontsize=8, zorder=5)
    for (x, y), r, h in trees:
        ax.add_patch(plt.Circle((x - vx, y - vy), r, color="#3c9a4a", alpha=0.8, zorder=4))
    ax.plot(0, 0, "r*", ms=14, zorder=6)
    ax.annotate("venue", (0, 0), xytext=(6, 6), textcoords="offset points", color="r", zorder=6)
    bx0, by0, bx1, by1 = clip_bounds
    ax.add_patch(plt.Rectangle((bx0 + SHADOW_MARGIN_M - vx, by0 + SHADOW_MARGIN_M - vy), bx1 - bx0 - 2 * SHADOW_MARGIN_M,
                               by1 - by0 - 2 * SHADOW_MARGIN_M, fill=False, ls="--", ec="k", lw=0.8, zorder=6))
    ax.set_xlim(bx0 - vx, bx1 - vx)
    ax.set_ylim(by0 - vy, by1 - vy)
    ax.set_aspect("equal")
    # arrows: where the sun is (WSW) and where shadows go (ENE)
    sx, sy = math.sin(math.radians(az)), math.cos(math.radians(az))
    label = "shadows -> ENE" if 45 < (az + 180) % 360 < 90 else f"shadows -> {(az + 180) % 360:.0f} deg"
    x0, y0 = -420.0, -360.0
    ax.annotate("", xy=(x0 - sx * 160, y0 - sy * 160), xytext=(x0, y0), arrowprops=dict(arrowstyle="-|>", color="navy", lw=2.5, mutation_scale=18))
    ax.text(x0, y0 - 30, label, color="navy", fontsize=11, va="top")
    ax.annotate("N", xy=(bx1 - vx - 40, by1 - vy - 60), xytext=(bx1 - vx - 40, by1 - vy - 160),
                arrowprops=dict(arrowstyle="->"), ha="center", fontsize=12)
    ax.set_title(f"2026-11-21 16:30 Brisbane: sun alt {alt:.1f} deg, az {az:.1f} deg (clockwise from N)\n"
                 "metres from venue, EPSG:7856; dashed = demo bbox, plot area = bbox + 200 m")
    ax.set_xlabel("east (m)")
    ax.set_ylabel("north (m)")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path)
    plt.close(fig)


def bearing_deg(dx, dy):
    return math.degrees(math.atan2(dx, dy)) % 360.0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", default=str(DEFAULT_DIR), help="data dir with graph.json, buildings.geojson, trees.geojson")
    ap.add_argument("--out", default=str(CACHE / "shade_computed.json"), help="shade.json output path")
    ap.add_argument("--shadows-dir", help="also write shadows/HHMM.geojson here (50 daytime slots)")
    ap.add_argument("--png", default=str(CACHE / "check_1630.png"))
    args = ap.parse_args()
    t0 = time.time()

    graph, buildings, trees = load(args.dir)
    v = graph["venue"]
    sun = sun_positions(v["lon"], v["lat"])
    check_sun(sun)
    print(f"sun OK: 09:00 alt {sun[12][0]:.2f} az {sun[12][1]:.2f}; 12:00 alt {sun[24][0]:.2f}; "
          f"16:30 alt {sun[42][0]:.2f} az {sun[42][1]:.2f}; 18:15 alt {sun[49][0]:.2f}; 18:30 alt {sun[50][0]:.2f}")

    edge_ids = [e["id"] for e in graph["edges"]]
    edges_m = np.array([LineString(project_coords(e["geometry"])) for e in graph["edges"]], dtype=object)
    etree = STRtree(edges_m)

    minlon, minlat, maxlon, maxlat = graph["bbox"]
    cx, cy = TO_M.transform([minlon, minlon, maxlon, maxlon], [minlat, maxlat, minlat, maxlat])
    bounds = (min(cx) - SHADOW_MARGIN_M, min(cy) - SHADOW_MARGIN_M, max(cx) + SHADOW_MARGIN_M, max(cy) + SHADOW_MARGIN_M)
    clip = box(*bounds)

    fractions = np.zeros((N_SLOTS, len(edge_ids)))
    shadow_1630 = None
    if args.shadows_dir:
        Path(args.shadows_dir).mkdir(parents=True, exist_ok=True)
    for i, (alt, az) in enumerate(sun):
        shadow = slot_shadow(buildings, trees, alt, az, clip)
        if alt > 0:
            fractions[i] = sun_fraction(edges_m, etree, shadow)  # alt <= 0 stays 0
            if args.shadows_dir:
                fc = {"type": "FeatureCollection", "features": to_geojson_features(shadow)}
                name = SLOTS[i].replace(":", "")
                (Path(args.shadows_dir) / f"{name}.geojson").write_text(
                    json.dumps(fc, separators=(",", ":")) + "\n", encoding="utf-8")
        if i == 42:
            shadow_1630 = shadow

    # direction check: at 16:30 a lone building's shadow must sit ENE (az + 180 = 78.5 deg) of its footprint
    alt, az = sun[42]
    k = 1.0 / math.tan(math.radians(alt))
    poly, h = max(buildings, key=lambda b: b[1] * b[0].area)
    s = sweep(poly, h * k * math.sin(math.radians(az + 180)), h * k * math.cos(math.radians(az + 180)))
    b = bearing_deg(s.centroid.x - poly.centroid.x, s.centroid.y - poly.centroid.y)
    assert abs(b - (az + 180) % 360) < 1.0, f"shadow bearing {b:.1f} deg, expected {(az + 180) % 360:.1f}"
    print(f"16:30 shadow of the biggest building ({h:g} m) lies {h * k:.1f} m toward bearing {b:.1f} deg (ENE)")

    shade = {
        "version": 1,
        "date": "2026-11-21",
        "tz": "Australia/Brisbane",
        "slot_minutes": 15,
        "slots": SLOTS,
        "sun": [{"alt_deg": round(a, 2), "az_deg": round(z % 360.0, 2)} for a, z in sun],
        "sunFraction": {
            eid: [round(float(x), 2) for x in fractions[:, j]] for j, eid in sorted(enumerate(edge_ids), key=lambda t: t[1])
        },
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(shade, separators=(",", ":")) + "\n", encoding="utf-8")

    write_png(args.png, graph, edges_m, buildings, trees, shadow_1630, alt, az, bounds)
    for i in (12, 24, 42):
        col = fractions[i]
        print(f"{SLOTS[i]}: mean sunFraction {col.mean():.2f}, full shade (<0.05) {np.mean(col < 0.05):.0%}, full sun (>0.95) {np.mean(col > 0.95):.0%}")
    print(f"wrote {out} ({len(edge_ids)} edges x {N_SLOTS} slots), {args.png}; {time.time() - t0:.1f}s")


if __name__ == "__main__":
    sys.exit(main())
