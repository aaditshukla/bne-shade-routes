#!/usr/bin/env python3
"""Check data files against contracts/data-formats.md. Standard library only.

    python validate.py                      # everything in web/public/data/
    python validate.py path/to/dir          # a data directory (graph.json, shade.json, ...)
    python validate.py path/to/file.json    # one file (e.g. ai/out/awnings.json)
    python validate.py -v ...               # print every error, not just the first

Prints one OK or FAIL line per file (shadows/ is summarised on one line) and exits 1 on any failure.
"""
import hashlib
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DIR = ROOT / "web" / "public" / "data"
N_SLOTS = 51
SLOTS = [f"{(360 + 15 * i) // 60:02d}:{(360 + 15 * i) % 60:02d}" for i in range(N_SLOTS)]
DAYTIME_DEFAULT = list(range(50))          # slots 0..49 (06:00..18:15) on 2026-11-21
KINDS = {"awning", "verandah", "shade_sail", "covered_walkway"}
HEIGHT_SOURCES = {"osm", "levels", "default"}
NODE_RE, EDGE_RE = re.compile(r"^n_[0-9a-f]{8}$"), re.compile(r"^e_[0-9a-f]{10}$")
BUILDING_MARGIN_M, SHADOW_MARGIN_M = 100.0, 200.0
# (slot, alt, alt_tol, az, az_tol): sanity values from CLAUDE.md for 2026-11-21 at the venue
SUN_CHECKS = [(12, 54.0, 0.7, 86.0, 1.0), (42, 22.7, 0.3, 258.5, 0.5)]


class Errors:
    def __init__(self):
        self.items = []

    def add(self, msg):
        self.items.append(msg)

    def __bool__(self):
        return bool(self.items)


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def is_str(v):
    return isinstance(v, str) and v != ""


def nkey(lon, lat):
    return f"{lon:.6f},{lat:.6f}"


def sha(s, n):
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:n]


def geodesic_m(a, b):
    r = 6371008.8
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp, dl = p2 - p1, math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def expand(bbox, metres):
    lat_c = (bbox[1] + bbox[3]) / 2
    dlat = metres / 111_000.0
    dlon = metres / (111_320.0 * math.cos(math.radians(lat_c)))
    return [bbox[0] - dlon, bbox[1] - dlat, bbox[2] + dlon, bbox[3] + dlat]


def check_coord(c, box, where, err, what="coordinate"):
    """c must be [lon, lat] inside box = [minLon, minLat, maxLon, maxLat]."""
    if not (isinstance(c, list) and len(c) == 2 and all(is_num(x) for x in c)):
        err.add(f"{where}: {what} must be [lon, lat] numbers, got {c!r}")
        return False
    lon, lat = c
    if not (box[0] <= lon <= box[2] and box[1] <= lat <= box[3]):
        hint = " (looks like [lat, lon]: swapped?)" if box[0] <= lat <= box[2] and box[1] <= lon <= box[3] else ""
        err.add(f"{where}: {what} [{lon}, {lat}] outside [lon, lat] box {[round(x, 6) for x in box]}{hint}")
        return False
    return True


def load(path, err):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        err.add("file not found")
    except (OSError, ValueError) as e:
        err.add(f"cannot read JSON: {e}")
    return None


def claude_md_bbox():
    try:
        text = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
    except OSError:
        return None
    m = re.search(r"Demo bbox.*?=\s*`\[\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\]`", text, re.S)
    return [float(x) for x in m.groups()] if m else None


# ------------------------------------------------------------------ graph
def check_graph(g, err):
    """Returns (summary, info) where info = {'bbox', 'edge_ids'} for the other checks."""
    info = {"bbox": None, "edge_ids": None, "node_ids": None}
    if not isinstance(g, dict):
        err.add("top level must be an object")
        return "", info
    if g.get("version") != 1:
        err.add(f"version must be 1, got {g.get('version')!r}")
    bbox = g.get("bbox")
    if not (isinstance(bbox, list) and len(bbox) == 4 and all(is_num(x) for x in bbox)
            and bbox[0] < bbox[2] and bbox[1] < bbox[3]):
        err.add("bbox must be [minLon, minLat, maxLon, maxLat] with min < max")
        return "", info
    info["bbox"] = bbox
    doc_bbox = claude_md_bbox()
    if doc_bbox and any(abs(a - b) > 1e-9 for a, b in zip(bbox, doc_bbox)):
        err.add(f"bbox {bbox} differs from CLAUDE.md {doc_bbox}")
    nodes, edges = g.get("nodes"), g.get("edges")
    if not isinstance(nodes, list) or not nodes:
        err.add("nodes must be a non-empty array")
        nodes = []
    if not isinstance(edges, list) or not edges:
        err.add("edges must be a non-empty array")
        edges = []
    coords = {}
    for i, n in enumerate(nodes):
        w = f"nodes[{i}]"
        if not isinstance(n, dict):
            err.add(f"{w}: must be an object")
            continue
        nid = n.get("id")
        if not (isinstance(nid, str) and NODE_RE.match(nid)):
            err.add(f"{w}: id must match n_ + 8 hex, got {nid!r}")
            continue
        if nid in coords:
            err.add(f"{w}: duplicate node id {nid}")
        if not (is_num(n.get("lon")) and is_num(n.get("lat"))):
            err.add(f"{w} {nid}: lon and lat must be numbers")
            continue
        if not check_coord([n["lon"], n["lat"]], bbox, f"{w} {nid}", err, "position"):
            continue
        coords[nid] = (n["lon"], n["lat"])
        if nid != "n_" + sha(nkey(*coords[nid]), 8):
            err.add(f"{w}: id {nid} is not n_ + sha1 of its rounded coordinates (see Deterministic IDs)")
        if "name" in n and not is_str(n["name"]):
            err.add(f"{w} {nid}: name must be a non-empty string when present")
    seen, adj = set(), {nid: [] for nid in coords}
    for i, e in enumerate(edges):
        w = f"edges[{i}]"
        if not isinstance(e, dict):
            err.add(f"{w}: must be an object")
            continue
        eid = e.get("id")
        if not (isinstance(eid, str) and EDGE_RE.match(eid)):
            err.add(f"{w}: id must match e_ + 10 hex, got {eid!r}")
            continue
        if eid in seen:
            err.add(f"{w}: duplicate edge id {eid}")
        seen.add(eid)
        a, b, geom, length = e.get("a"), e.get("b"), e.get("geometry"), e.get("length_m")
        if a not in coords or b not in coords:
            err.add(f"{w} {eid}: a/b must be existing node ids, got {a!r}, {b!r}")
            continue
        if a == b:
            err.add(f"{w} {eid}: a and b are the same node")
        adj[a].append(b)
        adj[b].append(a)
        if not (isinstance(geom, list) and len(geom) >= 2):
            err.add(f"{w} {eid}: geometry must be a [lon, lat] array with at least 2 vertices")
            continue
        if not all(check_coord(c, bbox, f"{w} {eid} geometry[{k}]", err) for k, c in enumerate(geom[:50])):
            continue
        if any(not (isinstance(c, list) and len(c) == 2 and all(is_num(x) for x in c)) for c in geom):
            err.add(f"{w} {eid}: geometry vertices must be [lon, lat]")
            continue
        if tuple(geom[0]) != coords[a] or tuple(geom[-1]) != coords[b]:
            err.add(f"{w} {eid}: geometry must start at node a and end at node b")
        if nkey(*geom[0]) >= nkey(*geom[-1]):
            err.add(f"{w} {eid}: geometry must run from the smaller endpoint key to the larger (a < b)")
        if eid != "e_" + sha(";".join(nkey(*c) for c in geom), 10):
            err.add(f"{w}: id {eid} is not e_ + sha1 of its oriented rounded vertices (see Deterministic IDs)")
        if not (is_num(length) and length > 0):
            err.add(f"{w} {eid}: length_m must be a number > 0, got {length!r}")
        else:
            true_len = sum(geodesic_m(geom[k], geom[k + 1]) for k in range(len(geom) - 1))
            if abs(length - true_len) > 0.5 + 0.02 * true_len:
                err.add(f"{w} {eid}: length_m {length} but geometry is about {true_len:.1f} m long (metres, not degrees?)")
        if "name" in e and not is_str(e["name"]):
            err.add(f"{w} {eid}: name must be a non-empty string when present")
    v = g.get("venue")
    if not isinstance(v, dict) or not all(k in v for k in ("name", "lon", "lat", "node")):
        err.add("venue must be an object with name, lon, lat, node")
    else:
        if v["node"] not in coords:
            err.add(f"venue.node {v['node']!r} is not a node id")
        elif not (is_num(v["lon"]) and is_num(v["lat"])
                  and abs(v["lon"] - coords[v["node"]][0]) < 1e-9 and abs(v["lat"] - coords[v["node"]][1]) < 1e-9):
            err.add("venue lon/lat must equal the venue node's coordinates")
    if coords and not err:
        start = next(iter(coords))
        stack, reached = [start], {start}
        while stack:
            for nb in adj[stack.pop()]:
                if nb not in reached:
                    reached.add(nb)
                    stack.append(nb)
        if len(reached) != len(coords):
            err.add(f"graph is not connected: {len(reached)} of {len(coords)} nodes reachable (largest component only)")
    info["edge_ids"], info["node_ids"] = seen, set(coords)
    return f"{len(nodes)} nodes, {len(edges)} edges", info


# ------------------------------------------------------------------ shade
def check_shade(s, graph_edge_ids, err):
    """Returns (summary, daytime slot indices)."""
    day = DAYTIME_DEFAULT
    if not isinstance(s, dict):
        err.add("top level must be an object")
        return "", day
    if s.get("version") != 1:
        err.add(f"version must be 1, got {s.get('version')!r}")
    for k, want in (("date", "2026-11-21"), ("tz", "Australia/Brisbane"), ("slot_minutes", 15)):
        if s.get(k) != want:
            err.add(f"{k} must be {want!r}, got {s.get(k)!r}")
    slots = s.get("slots")
    if not isinstance(slots, list) or len(slots) != N_SLOTS:
        err.add(f"slots must have exactly {N_SLOTS} entries, got {len(slots) if isinstance(slots, list) else slots!r}")
    elif slots != SLOTS:
        err.add("slots must be 06:00, 06:15, ... 18:30 in order")
    sun = s.get("sun")
    alts = None
    if not isinstance(sun, list) or len(sun) != N_SLOTS:
        err.add(f"sun must have exactly {N_SLOTS} entries, got {len(sun) if isinstance(sun, list) else sun!r}")
    else:
        alts, ok = [], True
        for i, e in enumerate(sun):
            if not (isinstance(e, dict) and is_num(e.get("alt_deg")) and is_num(e.get("az_deg"))):
                err.add(f"sun[{i}]: needs numeric alt_deg and az_deg")
                ok = False
                continue
            if not -90 <= e["alt_deg"] <= 90:
                err.add(f"sun[{i}]: alt_deg {e['alt_deg']} outside [-90, 90]")
            if not 0 <= e["az_deg"] < 360:
                err.add(f"sun[{i}]: az_deg {e['az_deg']} outside [0, 360)")
            alts.append(e["alt_deg"])
        if ok:
            for i, alt, at, az, zt in SUN_CHECKS:
                if abs(sun[i]["alt_deg"] - alt) > at or abs(sun[i]["az_deg"] - az) > zt:
                    err.add(f"sun[{i}] ({SLOTS[i]}): alt {sun[i]['alt_deg']}, az {sun[i]['az_deg']} but expected about "
                            f"alt {alt}, az {az} (azimuth is clockwise from north, in degrees)")
            if not (alts[49] > 0 >= alts[50]):
                err.add(f"sun: sunset must fall between 18:15 and 18:30 (alt {alts[49]} then {alts[50]})")
            day = [i for i, a in enumerate(alts) if a > 0]
    sf = s.get("sunFraction")
    if not isinstance(sf, dict) or not sf:
        err.add("sunFraction must be a non-empty object keyed by edge id")
        return "", day
    for eid, arr in sf.items():
        if not (isinstance(arr, list) and len(arr) == N_SLOTS):
            err.add(f"sunFraction[{eid}]: needs exactly {N_SLOTS} values, got {len(arr) if isinstance(arr, list) else arr!r}")
            continue
        bad = [i for i, v in enumerate(arr) if not (is_num(v) and 0 <= v <= 1)]
        if bad:
            err.add(f"sunFraction[{eid}]: slot {bad[0]} ({SLOTS[bad[0]]}) is {arr[bad[0]]!r}, must be a number in [0, 1]")
        elif alts is not None:
            lit = [i for i in range(N_SLOTS) if alts[i] <= 0 and arr[i] != 0]
            if lit:
                err.add(f"sunFraction[{eid}]: slot {lit[0]} ({SLOTS[lit[0]]}) is {arr[lit[0]]} but the sun is below the horizon (must be 0)")
    if graph_edge_ids is None:
        err.add("cannot cross-check edge ids: no valid graph.json found")
    else:
        missing_in_graph = sorted(set(sf) - graph_edge_ids)
        if missing_in_graph:
            err.add(f"{len(missing_in_graph)} edge id(s) not in graph.json, e.g. {missing_in_graph[0]}")
        missing_in_shade = sorted(graph_edge_ids - set(sf))
        if missing_in_shade:
            err.add(f"{len(missing_in_shade)} graph edge(s) have no sunFraction, e.g. {missing_in_shade[0]}")
    return f"{len(sf)} edges x {N_SLOTS} slots", day


# ------------------------------------------------------------------ geojson
def check_ring(ring, box, where, err):
    if not (isinstance(ring, list) and len(ring) >= 4):
        err.add(f"{where}: ring needs at least 4 positions")
        return
    if ring[0] != ring[-1]:
        err.add(f"{where}: ring is not closed")
    for k, c in enumerate(ring):
        if not check_coord(c, box, f"{where}[{k}]", err):
            return


def check_polygonal(geom, box, where, err):
    if not isinstance(geom, dict) or geom.get("type") not in ("Polygon", "MultiPolygon"):
        err.add(f"{where}: geometry must be a Polygon or MultiPolygon")
        return
    polys = geom.get("coordinates")
    if geom["type"] == "Polygon":
        polys = [polys]
    if not isinstance(polys, list) or not polys:
        err.add(f"{where}: empty coordinates")
        return
    for pi, poly in enumerate(polys):
        if not isinstance(poly, list) or not poly:
            err.add(f"{where}: polygon {pi} has no rings")
            continue
        for ri, ring in enumerate(poly):
            check_ring(ring, box, f"{where} poly {pi} ring {ri}", err)


def fc_features(g, err):
    if not (isinstance(g, dict) and g.get("type") == "FeatureCollection" and isinstance(g.get("features"), list)):
        err.add("must be a GeoJSON FeatureCollection with a features array")
        return None
    return g["features"]


def check_buildings(g, bbox, err):
    feats = fc_features(g, err)
    if feats is None:
        return ""
    box, ids, counts = expand(bbox, BUILDING_MARGIN_M), set(), {}
    for i, f in enumerate(feats):
        w = f"features[{i}]"
        p = f.get("properties") if isinstance(f, dict) else None
        if not isinstance(p, dict):
            err.add(f"{w}: needs properties")
            continue
        if not is_str(p.get("id")):
            err.add(f"{w}: properties.id must be a non-empty string")
        elif p["id"] in ids:
            err.add(f"{w}: duplicate id {p['id']}")
        else:
            ids.add(p["id"])
        h = p.get("height_m")
        if not (is_num(h) and h > 0):
            err.add(f"{w}: height_m must be a number > 0, got {h!r}")
        src = p.get("height_source")
        if src not in HEIGHT_SOURCES:
            err.add(f"{w}: height_source must be one of {sorted(HEIGHT_SOURCES)}, got {src!r}")
        else:
            counts[src] = counts.get(src, 0) + 1
            if src == "default" and is_num(h) and h != 6:
                err.add(f"{w}: height_source default means height_m 6, got {h}")
        check_polygonal(f.get("geometry"), box, w, err)
    return f"{len(feats)} buildings " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items()))


def check_trees(g, bbox, err):
    feats = fc_features(g, err)
    if feats is None:
        return ""
    ids = set()
    for i, f in enumerate(feats):
        w = f"features[{i}]"
        p = f.get("properties") if isinstance(f, dict) else None
        if not isinstance(p, dict):
            err.add(f"{w}: needs properties")
            continue
        if not is_str(p.get("id")):
            err.add(f"{w}: properties.id must be a non-empty string")
        elif p["id"] in ids:
            err.add(f"{w}: duplicate id {p['id']}")
        else:
            ids.add(p["id"])
        for k in ("canopy_radius_m", "height_m"):
            if not (is_num(p.get(k)) and p[k] > 0):
                err.add(f"{w}: {k} must be a number > 0, got {p.get(k)!r}")
        if "source" in p and not is_str(p["source"]):
            err.add(f"{w}: source must be a non-empty string when present")
        geom = f.get("geometry")
        if not (isinstance(geom, dict) and geom.get("type") == "Point"):
            err.add(f"{w}: geometry must be a Point")
        else:
            check_coord(geom.get("coordinates"), bbox, w, err)
    return f"{len(feats)} trees"


def check_shadow(g, bbox, err):
    feats = fc_features(g, err)
    if feats is None:
        return 0
    box = expand(bbox, SHADOW_MARGIN_M)
    for i, f in enumerate(feats):
        check_polygonal(f.get("geometry") if isinstance(f, dict) else None, box, f"features[{i}]", err)
    return len(feats)


# ------------------------------------------------------------------ awnings
def check_awnings(a, graph_edge_ids, err):
    if not isinstance(a, dict):
        err.add("top level must be an object")
        return ""
    if a.get("version") != 1:
        err.add(f"version must be 1, got {a.get('version')!r}")
    edges = a.get("edges")
    if not isinstance(edges, dict):
        err.add("edges must be an object keyed by edge id")
        return ""
    for eid, v in edges.items():
        w = f"edges[{eid}]"
        if not EDGE_RE.match(eid):
            err.add(f"{w}: key is not an edge id (e_ + 10 hex)")
        elif graph_edge_ids is not None and eid not in graph_edge_ids:
            err.add(f"{w}: edge id not in graph.json")
        if not isinstance(v, dict):
            err.add(f"{w}: must be an object")
            continue
        if v.get("kind") not in KINDS:
            err.add(f"{w}: kind must be one of {sorted(KINDS)}, got {v.get('kind')!r}")
        for k in ("covered_fraction", "confidence"):
            if not (is_num(v.get(k)) and 0 <= v[k] <= 1):
                err.add(f"{w}: {k} must be a number in [0, 1], got {v.get(k)!r}")
        if not isinstance(v.get("verified"), bool):
            err.add(f"{w}: verified must be true or false")
        ids = v.get("image_ids")
        if not (isinstance(ids, list) and all(is_str(x) for x in ids)):
            err.add(f"{w}: image_ids must be an array of strings")
    if graph_edge_ids is None:
        err.add("cannot cross-check edge ids: no valid graph.json found")
    return f"{len(edges)} edges, {sum(1 for v in edges.values() if isinstance(v, dict) and v.get('verified') is True)} verified"


# ------------------------------------------------------------------ driver
class Run:
    def __init__(self, verbose):
        self.verbose, self.failed = verbose, False

    def report(self, label, err, summary=""):
        if err:
            self.failed = True
            extra = f" (+{len(err.items) - 1} more)" if len(err.items) > 1 and not self.verbose else ""
            print(f"FAIL {label}: {err.items[0]}{extra}")
            if self.verbose:
                for m in err.items[1:]:
                    print(f"       {m}")
        else:
            print(f"OK   {label}" + (f" ({summary})" if summary else ""))


def graph_info_for(directory):
    """Parse a graph.json next to a file (or in the default data dir) so cross-checks work in single-file mode."""
    for d in (directory, DEFAULT_DIR):
        p = d / "graph.json"
        if p.is_file():
            e = Errors()
            g = load(p, e)
            _, info = check_graph(g, Errors()) if not e else ("", {})
            if info.get("bbox"):
                return info
    return {"bbox": claude_md_bbox(), "edge_ids": None}


def validate_dir(d, run):
    info = {"bbox": None, "edge_ids": None}
    err = Errors()
    g = load(d / "graph.json", err)
    summary = ""
    if not err:
        summary, info = check_graph(g, err)
    run.report("graph.json", err, summary)
    bbox = info["bbox"] or claude_md_bbox()

    err = Errors()
    s = load(d / "shade.json", err)
    summary, day = "", DAYTIME_DEFAULT
    if not err:
        summary, day = check_shade(s, info["edge_ids"], err)
    run.report("shade.json", err, summary)

    for name, fn in (("buildings.geojson", check_buildings), ("trees.geojson", check_trees)):
        err = Errors()
        g = load(d / name, err)
        summary = ""
        if not err:
            if bbox is None:
                err.add("cannot determine bbox (graph.json invalid and no bbox in CLAUDE.md)")
            else:
                summary = fn(g, bbox, err)
        run.report(name, err, summary)

    p = d / "awnings.json"
    if p.is_file():
        err = Errors()
        a = load(p, err)
        summary = "" if err else check_awnings(a, info["edge_ids"], err)
        run.report("awnings.json", err, summary)

    err = Errors()
    sd = d / "shadows"
    if not sd.is_dir():
        err.add("shadows/ directory is missing (Q1: one file per daytime slot)")
        run.report("shadows/", err)
        return
    want = {f"{(360 + 15 * i) // 60:02d}{(360 + 15 * i) % 60:02d}" for i in day}
    have = {p.stem for p in sd.glob("*.geojson")}
    for name in sorted(want - have)[:3]:
        err.add(f"missing daytime slot file {name}.geojson")
    for name in sorted(have - want):
        err.add(f"unexpected file {name}.geojson (only daytime slots 0600 to 1815 get a file)")
    for name in sorted(have & want):
        sub = Errors()
        g = load(sd / f"{name}.geojson", sub)
        if not sub:
            if bbox is None:
                sub.add("cannot determine bbox")
            else:
                check_shadow(g, bbox, sub)
        for m in sub.items[:2]:
            err.add(f"{name}.geojson: {m}")
    run.report("shadows/", err, f"{len(have & want)} of {len(want)} daytime slot files")


def validate_file(p, run):
    name, err = p.name, Errors()
    data = load(p, err)
    if err:
        run.report(str(p), err)
        return
    info = graph_info_for(p.parent)
    bbox = info["bbox"]
    if name == "graph.json":
        summary, _ = check_graph(data, err)
    elif name == "shade.json":
        summary, _ = check_shade(data, info["edge_ids"], err)
    elif name == "awnings.json":
        summary = check_awnings(data, info["edge_ids"], err)
    elif name == "buildings.geojson" or name == "trees.geojson" or p.parent.name == "shadows":
        if bbox is None:
            err.add("cannot determine bbox (no graph.json nearby and no bbox in CLAUDE.md)")
            summary = ""
        elif p.parent.name == "shadows":
            if not re.match(r"^\d{4}$", p.stem):
                err.add("shadow files must be named HHMM.geojson")
            summary = f"{check_shadow(data, bbox, err)} features"
        else:
            summary = (check_buildings if name == "buildings.geojson" else check_trees)(data, bbox, err)
    else:
        err.add("unknown file: expected graph.json, shade.json, buildings.geojson, trees.geojson, awnings.json or shadows/HHMM.geojson")
        summary = ""
    run.report(str(p), err, summary)


def main(argv):
    verbose = "-v" in argv
    args = [a for a in argv if a != "-v"]
    if len(args) > 1 or (args and args[0] in ("-h", "--help")):
        print(__doc__)
        return 2
    target = Path(args[0]) if args else DEFAULT_DIR
    run = Run(verbose)
    if target.is_dir():
        validate_dir(target, run)
    elif target.is_file():
        validate_file(target, run)
    else:
        print(f"FAIL {target}: no such file or directory")
        return 1
    return 1 if run.failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
