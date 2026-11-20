#!/usr/bin/env python3
"""D2: OSM walk network -> web/public/data/graph.json (contracts/data-formats.md).

    cd data && uv run python build_graph.py [--out FILE]

Steps: download (cached in data/cache/) -> undirected, clipped to the bbox -> largest connected
component -> venue node (exact coordinates, joined to the nearest street) -> every edge split into
pieces of at most 30 m -> deterministic node/edge IDs from rounded coordinates -> graph.json.

Geometry is measured in EPSG:7856 (metres); coordinates are written as [lon, lat], 6 decimals.
Edge IDs freeze once the real graph.json ships: never change the split, rounding or ID scheme.
"""
import argparse
import hashlib
import json
import math
import re
import sys
import time
from pathlib import Path

import networkx as nx
import osmnx as ox
from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, Point, box
from shapely.ops import nearest_points, substring
from shapely.strtree import STRtree

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CACHE = HERE / "cache"
RAW_GRAPHML = CACHE / "walk_raw.graphml"   # raw OSM download (simplified, bbox-truncated by edge)
OUT = ROOT / "web" / "public" / "data" / "graph.json"
MAX_PIECE_M = 30.0
DOWNLOAD_ATTEMPTS = 6
DOWNLOAD_WAIT_S = 120

TO_M = Transformer.from_crs(4326, 7856, always_xy=True)
TO_DEG = Transformer.from_crs(7856, 4326, always_xy=True)


def claude_md_bbox_and_venue():
    text = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
    m = re.search(r"Demo bbox.*?=\s*`\[\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\]`", text, re.S)
    v = re.search(r"Venue \(confirmed\): lon (-?[\d.]+), lat [−-]([\d.]+)", text)
    if not m or not v:
        sys.exit("cannot read bbox/venue from CLAUDE.md")
    return [float(x) for x in m.groups()], (float(v.group(1)), -float(v.group(2)))


# ---------- deterministic IDs (contracts/data-formats.md) ----------
def key(lon, lat):
    return f"{lon:.6f},{lat:.6f}"


def sha(s, n):
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:n]


def rnd(c):
    return (round(c[0], 6), round(c[1], 6))


# ---------- download (cached) ----------
def load_raw(bbox):
    if RAW_GRAPHML.exists():
        print(f"using cached download {RAW_GRAPHML.relative_to(ROOT)}")
        return ox.load_graphml(RAW_GRAPHML)
    CACHE.mkdir(exist_ok=True)
    ox.settings.use_cache = True
    ox.settings.cache_folder = str(CACHE / "osmnx")
    ox.settings.overpass_url = "https://overpass-api.de/api"   # only host the network policy allows
    ox.settings.requests_timeout = 120
    last = None
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            print(f"downloading walk network (attempt {attempt}/{DOWNLOAD_ATTEMPTS})", flush=True)
            # osmnx 2.x: bbox is (west, south, east, north)
            g = ox.graph_from_bbox(tuple(bbox), network_type="walk", simplify=True,
                                   retain_all=True, truncate_by_edge=True)
            ox.save_graphml(g, RAW_GRAPHML)
            return g
        except Exception as exc:                    # network errors: back off and retry
            last = exc
            print(f"  failed: {type(exc).__name__}: {exc}", flush=True)
            if attempt < DOWNLOAD_ATTEMPTS:
                time.sleep(DOWNLOAD_WAIT_S * attempt)
    sys.exit(f"download failed after {DOWNLOAD_ATTEMPTS} attempts, last error: {last!r}")


# ---------- raw edges ----------
def first_name(v):
    if isinstance(v, (list, tuple)):
        v = v[0] if v else None
    return v if isinstance(v, str) and v.strip() else None


def raw_edges(g, bbox):
    """Undirected, de-duplicated, clipped to the bbox: list of {'coords': [(lon,lat)..], 'name'}."""
    clip = box(*bbox)
    seen, out = set(), []
    for u, v, data in g.edges(data=True):
        if "geometry" in data:
            coords = [(x, y) for x, y in data["geometry"].coords]
        else:
            coords = [(g.nodes[u]["x"], g.nodes[u]["y"]), (g.nodes[v]["x"], g.nodes[v]["y"])]
        line = LineString(coords)
        cut = line.intersection(clip)
        if cut.is_empty:
            continue
        parts = [cut] if isinstance(cut, LineString) else [p for p in getattr(cut, "geoms", []) if isinstance(p, LineString)]
        for part in parts:
            c = [rnd(p) for p in part.coords]
            c = [p for i, p in enumerate(c) if i == 0 or p != c[i - 1]]
            if len(c) < 2:
                continue
            c = [(min(max(x, bbox[0]), bbox[2]), min(max(y, bbox[1]), bbox[3])) for x, y in c]
            if key(*c[0]) > key(*c[-1]):
                c.reverse()
            sig = tuple(c)
            if sig in seen:
                continue
            seen.add(sig)
            out.append({"coords": c, "name": first_name(data.get("name"))})
    return out


def largest_component(edges):
    gx = nx.Graph()
    for i, e in enumerate(edges):
        a, b = key(*e["coords"][0]), key(*e["coords"][-1])
        if a != b:
            gx.add_edge(a, b)
    comp = max(nx.connected_components(gx), key=lambda c: (len(c), min(c)))
    return [e for e in edges
            if key(*e["coords"][0]) in comp and key(*e["coords"][-1]) in comp
            and key(*e["coords"][0]) != key(*e["coords"][-1])]


# ---------- venue ----------
def add_venue(edges, venue):
    """Return edges with a node at the exact venue point, joined to the nearest street by a short connector."""
    vx, vy = TO_M.transform(*venue)
    vp = Point(vx, vy)
    lines = [LineString([TO_M.transform(*c) for c in e["coords"]]) for e in edges]
    tree = STRtree(lines)
    i = int(tree.nearest(vp))
    line, e = lines[i], edges[i]
    sp = nearest_points(line, vp)[0]
    dist = vp.distance(sp)
    along = line.project(sp)
    snap = rnd(TO_DEG.transform(sp.x, sp.y))
    print(f"venue is {dist:.1f} m from the nearest street edge ({e['name'] or 'unnamed'})")
    out = [x for j, x in enumerate(edges) if j != i]

    def piece(d0, d1):
        sub = substring(line, d0, d1)
        c = [rnd(TO_DEG.transform(x, y)) for x, y in sub.coords]
        return [p for k, p in enumerate(c) if k == 0 or p != c[k - 1]]

    ends = (e["coords"][0], e["coords"][-1])
    if dist < 0.5:
        snap = rnd(venue)
    # split the street edge at the snap point unless it is (within 0.5 m of) an end vertex
    if along < 0.5:
        snap = ends[0]
    elif line.length - along < 0.5:
        snap = ends[1]
    elif snap not in ends:
        for c in (piece(0, along), piece(along, line.length)):
            if len(c) >= 2:
                if key(*c[0]) > key(*c[-1]):
                    c.reverse()
                out.append({"coords": c, "name": e["name"]})
    else:
        out.append(e)
    if snap == ends[0] or snap == ends[1]:
        if not any(x is e for x in out):
            out.append(e)
    v = rnd(venue)
    if snap != v:
        c = [v, snap] if key(*v) < key(*snap) else [snap, v]
        out.append({"coords": c, "name": "Venue access"})
    return out, v


# ---------- split to <= 30 m ----------
def split_edge(coords, name):
    line = LineString([TO_M.transform(*c) for c in coords])
    length = line.length
    n = max(1, math.ceil(length / MAX_PIECE_M - 1e-9))
    if coords[0] == coords[-1]:
        n = max(n, 2)
    pieces = []
    for k in range(n):
        sub = line if n == 1 else substring(line, length * k / n, length * (k + 1) / n)
        c = [rnd(TO_DEG.transform(x, y)) for x, y in sub.coords]
        c[0] = coords[0] if k == 0 else c[0]
        c[-1] = coords[-1] if k == n - 1 else c[-1]
        c = [p for i, p in enumerate(c) if i == 0 or p != c[i - 1]]
        if len(c) >= 2:
            pieces.append({"coords": c, "name": name})
    return pieces


def length_m(coords):
    pts = [TO_M.transform(*c) for c in coords]
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def build(out=OUT):
    bbox, venue = claude_md_bbox_and_venue()
    g = load_raw(bbox)
    edges = raw_edges(g, bbox)
    print(f"raw undirected edges inside bbox: {len(edges)}")
    edges = largest_component(edges)
    print(f"largest component edges: {len(edges)}")
    edges, vkey = add_venue(edges, venue)

    pieces = []
    for e in edges:
        for p in split_edge(e["coords"], e["name"]):
            c = p["coords"]
            if key(*c[0]) > key(*c[-1]):
                c = c[::-1]
            if key(*c[0]) != key(*c[-1]):
                pieces.append({"coords": c, "name": p["name"]})

    nodes, edge_recs, seen = {}, {}, set()
    for p in pieces:
        c = p["coords"]
        sig = ";".join(key(*q) for q in c)
        if sig in seen:
            continue                       # identical geometry twice (e.g. both directions)
        seen.add(sig)
        eid = "e_" + sha(sig, 10)
        assert eid not in edge_recs, f"edge id collision {eid}"
        ends = []
        for q in (c[0], c[-1]):
            nid = "n_" + sha(key(*q), 8)
            assert nodes.setdefault(nid, q) == q, f"node id collision {nid}"
            ends.append(nid)
        rec = {"id": eid, "a": ends[0], "b": ends[1], "length_m": round(length_m(c), 2),
               "geometry": [[x, y] for x, y in c]}
        if p["name"]:
            rec["name"] = p["name"]
        edge_recs[eid] = rec

    # final connectivity check (splitting must not change the component structure)
    gx = nx.Graph()
    gx.add_edges_from((r["a"], r["b"]) for r in edge_recs.values())
    assert nx.number_connected_components(gx) == 1, "graph is not one connected component"

    vid = "n_" + sha(key(*vkey), 8)
    assert vid in nodes, "venue node missing"
    node_list = []
    for nid in sorted(nodes):
        lon, lat = nodes[nid]
        n = {"id": nid, "lon": lon, "lat": lat}
        if nid == vid:
            n["name"] = "Venue entrance"
        node_list.append(n)
    doc = {
        "version": 1,
        "bbox": bbox,
        "venue": {"name": "Venue entrance", "lon": vkey[0], "lat": vkey[1], "node": vid},
        "nodes": node_list,
        "edges": [edge_recs[k] for k in sorted(edge_recs)],
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    total = sum(r["length_m"] for r in edge_recs.values())
    longest = max(r["length_m"] for r in edge_recs.values())
    print(f"wrote {out}: {len(node_list)} nodes, {len(edge_recs)} edges, "
          f"total {total / 1000:.2f} km, longest edge {longest:.1f} m")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(OUT), help="graph.json output path")
    build(Path(ap.parse_args().out))
