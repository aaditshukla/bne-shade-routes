"""A5 - Turn per-image results into per-edge awnings.

Each image side becomes an observation point 6 m left or right of the camera,
perpendicular to its compass_angle. It is snapped to the nearest street edge
within 15 m, and dropped otherwise. All distances are in metres (EPSG:7856).

Per edge:
  covered_fraction = verified covered observations / all observations
  confidence       = mean confidence of the verified ones
  kind             = most common kind among the verified ones
  image_ids        = the positive images
  verified         = true

Reads:  ai/cache/images.jsonl, detections.jsonl, verified.jsonl
        web/public/data/graph.json  (frozen after ~11:00)
Writes: ai/out/awnings.json

Run:  uv run --with pyproj python aggregate.py
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import common as C
import config

# NOTE: contracts/data-formats.md is not on main yet, so the outer shape below
# is a best guess: {"edges": {edge_id: {...}}}. It lives in one place
# (_payload) so it is a two-line change when the contract lands.
PAYLOAD_VERSION = 1


# --------------------------------------------------------------------------
# graph
# --------------------------------------------------------------------------

def _projector():
    try:
        from pyproj import Transformer
    except ImportError:
        raise SystemExit(
            "pyproj is needed for the 15 m snap. Run:\n"
            "  uv run --with pyproj python aggregate.py"
        )
    return Transformer.from_crs("EPSG:4326", "EPSG:7856", always_xy=True)


def load_edges(graph_path: Path, transformer) -> list[dict]:
    data = C.read_json(graph_path)

    if isinstance(data, dict):
        raw_edges = data.get("edges", [])
        nodes = data.get("nodes", [])
    else:
        raw_edges, nodes = data, []

    node_xy: dict[str, tuple[float, float]] = {}
    if isinstance(nodes, list):
        for node in nodes:
            coords = node.get("coordinates") or [node.get("lon"), node.get("lat")]
            node_xy[str(node.get("id"))] = transformer.transform(float(coords[0]), float(coords[1]))

    if isinstance(raw_edges, dict):
        raw_edges = list(raw_edges.values())

    edges = []
    for edge in raw_edges:
        edge_id = str(edge.get("id") or edge.get("edge_id"))
        coords = edge.get("geometry") or edge.get("coordinates")

        if coords and isinstance(coords[0], (list, tuple)):
            xy = [transformer.transform(float(c[0]), float(c[1])) for c in coords]
        else:
            # contracts/data-formats.md uses a / b; keep the aliases for safety.
            a = str(edge.get("a") or edge.get("from_node") or edge.get("from") or edge.get("u"))
            b = str(edge.get("b") or edge.get("to_node") or edge.get("to") or edge.get("v"))
            if a not in node_xy or b not in node_xy:
                continue
            xy = [node_xy[a], node_xy[b]]

        if len(xy) < 2:
            continue

        length_m = edge.get("length_m")
        if not length_m:
            length_m = sum(
                ((xy[i + 1][0] - xy[i][0]) ** 2 + (xy[i + 1][1] - xy[i][1]) ** 2) ** 0.5
                for i in range(len(xy) - 1)
            )

        edges.append({"id": edge_id, "xy": xy, "length_m": float(length_m)})

    C.log(f"graph: {len(edges)} edges from {graph_path.name}")
    return edges


def _nearest_edge(px: float, py: float, edges: list[dict]) -> tuple[str, float] | None:
    best_id, best_dist = None, float("inf")
    for edge in edges:
        xy = edge["xy"]
        for i in range(len(xy) - 1):
            ax, ay = xy[i]
            bx, by = xy[i + 1]
            dist = C.seg_distance_m(px, py, ax, ay, bx, by)
            if dist < best_dist:
                best_id, best_dist = edge["id"], dist
    if best_id is None:
        return None
    return best_id, best_dist


# --------------------------------------------------------------------------
# observations
# --------------------------------------------------------------------------

def side_points(image: dict) -> dict[str, tuple[float, float]] | None:
    """6 m left and right of the camera, perpendicular to the compass angle."""
    lon, lat = image.get("lon"), image.get("lat")
    bearing = image.get("compass_angle")
    if lon is None or lat is None or bearing is None:
        return None

    import math

    beta = math.radians(float(bearing))
    d = config.SIDE_OFFSET_M
    east, north = -d * math.cos(beta), d * math.sin(beta)
    m_per_deg_lat = C.EARTH_M_PER_DEG_LAT
    m_per_deg_lon = m_per_deg_lat * math.cos(math.radians(float(lat)))

    return {
        "left": (float(lon) + east / m_per_deg_lon, float(lat) + north / m_per_deg_lat),
        "right": (float(lon) - east / m_per_deg_lon, float(lat) - north / m_per_deg_lat),
    }


def build_observations(images: list[dict], transformer) -> tuple[list[dict], int]:
    observations = []
    skipped = 0
    by_id = {row["image_id"]: row for row in images if "image_id" in row}
    image_meta = {row["id"]: row for row in C.read_jsonl(C.IMAGES_JSONL)}

    for image_id, detection in by_id.items():
        meta = image_meta.get(image_id)
        if not meta:
            skipped += 1
            continue
        points = side_points(meta)
        if not points:
            skipped += 1
            continue
        for side in ("left", "right"):
            lon, lat = points[side]
            x, y = transformer.transform(lon, lat)
            observations.append(
                {
                    "image_id": image_id,
                    "side": side,
                    "xy": (x, y),
                    "covered": bool(detection[side].get("covered")),
                }
            )

    if skipped:
        C.log(f"{skipped} images skipped (no compass_angle or no longer cached)")
    return observations, skipped


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def _payload(edges_out: dict, edges_covered: int, covered_metres: float) -> dict:
    return {
        "version": PAYLOAD_VERSION,
        "date": config.DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "summary": {"edges_covered": edges_covered, "covered_metres": round(covered_metres, 1)},
        "edges": edges_out,
    }


def run(
    graph_path: Path = C.GRAPH_JSON,
    out_path: Path = C.AWNINGS_JSON,
    snap_radius_m: float = config.SNAP_RADIUS_M,
) -> dict:
    C.ensure_dirs()
    if not graph_path.exists():
        raise SystemExit(f"No {graph_path}. Wait for D2 to ship graph.json.")

    transformer = _projector()
    edges = load_edges(graph_path, transformer)

    detections = C.read_jsonl(C.DETECTIONS_JSONL)
    if not detections:
        raise SystemExit("No detections. Run detect.py first.")

    observations, _ = build_observations(detections, transformer)
    C.log(f"{len(observations)} side observations from {len(detections)} images")

    verified = {
        (row["image_id"], row["side"]): row
        for row in C.read_jsonl(C.VERIFIED_JSONL)
        if row.get("verified")
    }
    C.log(f"{len(verified)} verified positive sides")

    totals: Counter = Counter()
    positives: Counter = Counter()
    confidence: dict[str, list[float]] = {}
    kinds: dict[str, Counter] = {}
    images_per_edge: dict[str, set] = {}
    dropped = 0

    # One observation per (image, edge), not per side. When the graph has only
    # street centrelines both sidewalks snap to the same edge, and a walker can
    # cross to the shady side, so a side covered on either side counts
    # (docs/ROADMAP.md A5 note). Distinct sidewalks still get separate counts.
    seen: dict[tuple[str, str], bool] = {}

    for obs in observations:
        nearest = _nearest_edge(obs["xy"][0], obs["xy"][1], edges)
        if not nearest:
            dropped += 1
            continue
        edge_id, distance = nearest
        if distance > snap_radius_m:
            dropped += 1
            continue

        claim = verified.get((obs["image_id"], obs["side"]))
        key = (obs["image_id"], edge_id)
        seen[key] = seen.get(key, False) or bool(claim)

        if claim:
            confidence.setdefault(edge_id, []).append(float(claim.get("confidence") or 0.0))
            kinds.setdefault(edge_id, Counter())[claim.get("kind") or "awning"] += 1
            images_per_edge.setdefault(edge_id, set()).add(obs["image_id"])

    C.log(f"{dropped} observations dropped (further than {snap_radius_m:.0f} m from any street)")

    for (image_id, edge_id), covered in seen.items():
        totals[edge_id] += 1
        if covered:
            positives[edge_id] += 1

    edges_out: dict[str, dict] = {}
    covered_metres = 0.0
    length_by_id = {edge["id"]: edge["length_m"] for edge in edges}

    for edge_id, positive_count in positives.items():
        total = totals[edge_id]
        if total == 0:
            continue
        confidences = confidence.get(edge_id, [])
        kind_counts = kinds.get(edge_id, Counter())
        edges_out[edge_id] = {
            "kind": kind_counts.most_common(1)[0][0] if kind_counts else "awning",
            "covered_fraction": round(positive_count / total, 3),
            "confidence": round(sum(confidences) / len(confidences), 3) if confidences else 0.0,
            "verified": True,
            "image_ids": sorted(images_per_edge.get(edge_id, set())),
        }
        covered_metres += length_by_id.get(edge_id, 0.0)

    payload = _payload(edges_out, len(edges_out), covered_metres)
    C.write_json(out_path, payload)

    C.log(f"wrote {out_path}")
    C.log(f"edges covered: {len(edges_out)}, covered metres: {covered_metres:.0f}")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Aggregate image results per street edge.")
    parser.add_argument("--graph", default=str(C.GRAPH_JSON))
    parser.add_argument("--out", default=str(C.AWNINGS_JSON))
    parser.add_argument("--snap-radius", type=float, default=config.SNAP_RADIUS_M)
    args = parser.parse_args()

    run(graph_path=Path(args.graph), out_path=Path(args.out), snap_radius_m=args.snap_radius)


if __name__ == "__main__":
    main()
