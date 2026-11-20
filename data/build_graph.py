"""D2: OSM walk network -> web/public/data/graph.json (contracts/data-formats.md).

    cd data && uv run python build_graph.py [--out DIR] [--max-piece-m 30]

The raw osmnx graph is cached in data/cache/ (walk_raw.graphml, plus osmnx's own Overpass
response cache), so reruns never re-download. Geometry is done in EPSG:7856 (metres) and written
back in EPSG:4326 as [lon, lat] rounded to 6 dp. IDs come only from rounded coordinates
(see Deterministic IDs in the contract), so two runs give identical files.
"""
import argparse
import hashlib
import json
import math
import re
from pathlib import Path

import networkx as nx
import numpy as np
import osmnx as ox
from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.ops import substring

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).resolve().parent / "cache"
RAW = CACHE / "walk_raw.graphml"
DEFAULT_OUT = ROOT / "web" / "public" / "data"
VENUE_NAME = "Venue entrance"

TO_M = Transformer.from_crs(4326, 7856, always_xy=True)
TO_LL = Transformer.from_crs(7856, 4326, always_xy=True)


def sha(s, n):
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:n]


def nkey(c):
    return f"{c[0]:.6f},{c[1]:.6f}"


def node_id(c):
    return "n_" + sha(nkey(c), 8)


def edge_id(geom):
    return "e_" + sha(";".join(nkey(c) for c in geom), 10)


def read_claude_md():
    text = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
    m = re.search(r"Demo bbox.*?=\s*`\[\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\]`", text, re.S)
    bbox = [float(x) for x in m.groups()]
    v = re.search(r"Venue \(confirmed\): lon\s*(-?[\d.]+), lat\s*[-−]\s*([\d.]+)", text)
    venue = (float(v.group(1)), -float(v.group(2)))
    return bbox, venue


def rnd(c):
    return (round(c[0], 6), round(c[1], 6))


def to_ll(xy_coords):
    xs, ys = TO_LL.transform([p[0] for p in xy_coords], [p[1] for p in xy_coords])
    return [rnd(c) for c in zip(xs, ys)]


def length_m(ll):
    xs, ys = TO_M.transform([c[0] for c in ll], [c[1] for c in ll])
    return round(float(sum(math.hypot(xs[i + 1] - xs[i], ys[i + 1] - ys[i]) for i in range(len(ll) - 1))), 2)


def inside(c, bbox):
    return bbox[0] <= c[0] <= bbox[2] and bbox[1] <= c[1] <= bbox[3]


def pick_name(v):
    if isinstance(v, (list, tuple)):
        v = v[0] if v else None
    return v if isinstance(v, str) and v else None


def split_line(line, max_len):
    """Equal pieces of at most max_len metres, keeping the original vertices. line is in metres."""
    n = max(1, math.ceil(line.length / max_len - 1e-9))
    if n == 1:
        return [list(line.coords)]
    return [list(substring(line, line.length * i / n, line.length * (i + 1) / n).coords) for i in range(n)]


class Net:
    """Pieces keyed by their ID. Nodes are keyed by rounded coordinate."""

    def __init__(self):
        self.edges = {}  # eid -> dict(geometry, name)
        self.dropped = {"self_loop": 0, "duplicate": 0}

    def add(self, ll, name=None):
        ll = [c for i, c in enumerate(ll) if i == 0 or c != ll[i - 1]]  # drop repeated vertices
        if len(ll) < 2 or ll[0] == ll[-1]:
            self.dropped["self_loop"] += 1
            return
        if nkey(ll[0]) > nkey(ll[-1]):
            ll = ll[::-1]
        eid = edge_id(ll)
        if eid in self.edges:
            self.dropped["duplicate"] += 1  # same oriented vertices => same street piece (parallel/two-way way)
            return
        self.edges[eid] = {"geometry": ll, "name": name}


def build_pieces(G, bbox, max_piece_m):
    net, off_bbox = Net(), 0
    for u, v, d in G.edges(data=True):
        if "geometry" in d:
            pts = list(d["geometry"].coords)
        else:
            pts = [(G.nodes[u]["x"], G.nodes[u]["y"]), (G.nodes[v]["x"], G.nodes[v]["y"])]
        ll = [rnd(c) for c in pts]
        if not all(inside(c, bbox) for c in ll):
            off_bbox += 1  # contract: every vertex inside the bbox; drop rather than clip
            continue
        xs, ys = TO_M.transform([c[0] for c in ll], [c[1] for c in ll])
        line = LineString(list(zip(xs, ys)))
        if line.length < 0.05:
            continue
        name = pick_name(d.get("name"))
        for piece in split_line(line, max_piece_m):
            net.add(to_ll(piece), name)
    return net, off_bbox


def largest_component(net):
    g = nx.Graph()
    for eid, e in net.edges.items():
        g.add_edge(nkey(e["geometry"][0]), nkey(e["geometry"][-1]), eid=eid)
    comps = sorted(nx.connected_components(g), key=lambda c: (-len(c), min(c)))
    keep = comps[0]
    removed = {eid for eid, e in net.edges.items() if nkey(e["geometry"][0]) not in keep}
    for eid in removed:
        del net.edges[eid]
    return len(comps), len(removed)


def attach_venue(net, venue, max_piece_m):
    """Make a node at exactly the venue point. Finds the nearest piece, attaches at the foot of the
    perpendicular (an existing end node if within 0.5 m, otherwise by splitting the piece there),
    then adds a straight spur to the venue, cut into pieces of at most max_piece_m."""
    vm = Point(TO_M.transform(*venue))
    best = None
    for eid, e in net.edges.items():
        xs, ys = TO_M.transform([c[0] for c in e["geometry"]], [c[1] for c in e["geometry"]])
        line = LineString(list(zip(xs, ys)))
        cand = (line.distance(vm), eid, line)
        if best is None or cand[:2] < best[:2]:
            best = cand
    dist, eid, line = best
    e = net.edges[eid]
    along = line.project(vm)
    info = {"snap_m": round(dist, 1), "nearest_piece": eid}
    ends = (e["geometry"][0], e["geometry"][-1])
    if along <= 0.5:
        attach = ends[0]
    elif along >= line.length - 0.5:
        attach = ends[1]
    else:
        foot = line.interpolate(along)
        attach = to_ll([(foot.x, foot.y)])[0]
        del net.edges[eid]
        a, b = substring(line, 0, along), substring(line, along, line.length)
        net.add(to_ll(list(a.coords))[:-1] + [attach], e["name"])
        net.add([attach] + to_ll(list(b.coords))[1:], e["name"])
    am = Point(TO_M.transform(*attach))
    spur = LineString([(am.x, am.y), (vm.x, vm.y)])
    if spur.length < 0.05:
        return attach, {**info, "spur_m": 0}
    pieces = split_line(spur, max_piece_m)
    for i, piece in enumerate(pieces):
        ll = to_ll(piece)
        ll[0] = attach if i == 0 else prev
        if i == len(pieces) - 1:
            ll[-1] = venue
        prev = ll[-1]
        net.add(ll, None)
    return venue, {**info, "spur_m": round(spur.length, 1)}


def to_graph_json(net, bbox, venue):
    nodes = {}
    for e in net.edges.values():
        for c in (e["geometry"][0], e["geometry"][-1]):
            nodes[node_id(c)] = c
    if len({nkey(c) for c in nodes.values()}) != len(nodes):
        raise SystemExit("node id collision")
    nl = [{"id": nid, "lon": c[0], "lat": c[1]} for nid, c in sorted(nodes.items())]
    el = []
    for eid, e in sorted(net.edges.items()):
        g = e["geometry"]
        rec = {"id": eid, "a": node_id(g[0]), "b": node_id(g[-1]), "length_m": length_m(g)}
        if e["name"]:
            rec["name"] = e["name"]
        rec["geometry"] = [list(c) for c in g]
        el.append(rec)
    vnode = node_id(venue)
    if vnode not in nodes:
        raise SystemExit("venue node missing from graph")
    return {"version": 1, "bbox": bbox,
            "venue": {"name": VENUE_NAME, "lon": venue[0], "lat": venue[1], "node": vnode},
            "nodes": nl, "edges": el}


def load_raw(bbox):
    if RAW.exists():
        print(f"using cached {RAW.relative_to(ROOT)}")
        return ox.load_graphml(RAW)
    CACHE.mkdir(exist_ok=True)
    ox.settings.cache_folder = str(CACHE / "osmnx")
    ox.settings.use_cache = True
    G = ox.graph_from_bbox((bbox[0], bbox[1], bbox[2], bbox[3]), network_type="walk")  # (west, south, east, north)
    ox.save_graphml(G, RAW)
    print(f"downloaded and cached {RAW.relative_to(ROOT)}")
    return G


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--max-piece-m", type=float, default=30.0)
    ap.add_argument("--raw", type=Path, help="use this graphml instead of downloading (tests)")
    a = ap.parse_args()
    bbox, venue = read_claude_md()
    G = ox.load_graphml(a.raw) if a.raw else load_raw(bbox)
    G = ox.convert.to_undirected(G)
    net, off_bbox = build_pieces(G, bbox, a.max_piece_m)
    ncomp, removed = largest_component(net)
    venue_pt, venue_info = attach_venue(net, venue, a.max_piece_m)
    out = to_graph_json(net, bbox, venue_pt)
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "graph.json").write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    total = sum(e["length_m"] for e in out["edges"])
    longest = max(e["length_m"] for e in out["edges"])
    print(f"nodes {len(out['nodes'])}  edges {len(out['edges'])}  total {total:.0f} m  longest piece {longest:.1f} m")
    print(f"components {ncomp} (dropped {removed} pieces outside the largest), edges leaving bbox dropped {off_bbox}, "
          f"merged {net.dropped}")
    print(f"venue: {venue_info}")


if __name__ == "__main__":
    main()
