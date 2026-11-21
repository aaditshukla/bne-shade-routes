"""Smoke test for the AI lane. No API keys, no network.

Phase 1: tiny fake cache + fake graph in a temp folder -> aggregate.py, stats.py.
Phase 2: observations placed on a real edge of contracts/fixtures/graph.json,
         then the output is checked by data/validate.py against the contract.

Run:  uv run --with pyproj python selftest.py
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import common as C
import config

M_PER_DEG_LAT = C.EARTH_M_PER_DEG_LAT


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def _patch_paths(tmp: Path) -> None:
    """Point the shared module paths at a temp folder for this run."""
    C.IMAGES_DIR = tmp / "images"
    C.IMAGES_JSONL = tmp / "images.jsonl"
    C.DETECTIONS_JSONL = tmp / "detections.jsonl"
    C.VERIFIED_JSONL = tmp / "verified.jsonl"
    C.OUT = tmp / "out"
    C.AWNINGS_JSON = C.OUT / "awnings.json"
    C.STATS_JSON = C.OUT / "stats.json"
    C.REVIEW_HTML = C.OUT / "review.html"
    C.EXAMPLES = C.OUT / "examples"
    C.IMAGES_DIR.mkdir(parents=True)
    C.OUT.mkdir(parents=True)


# --------------------------------------------------------------------------
# phase 1: fake graph and fake cache
# --------------------------------------------------------------------------

def phase1(tmp: Path) -> dict:
    _patch_paths(tmp)
    lon, lat = 153.031522, -27.460061

    graph_path = C.OUT / "graph-fixture.json"
    C.GRAPH_JSON = graph_path
    nodes = [
        {"id": "n1", "lon": lon, "lat": lat},
        {"id": "n2", "lon": lon, "lat": lat + 0.00045},
        {"id": "n3", "lon": lon, "lat": lat + 0.00090},
    ]
    edges = [
        {"id": "e1", "a": "n1", "b": "n2", "length_m": 50.0},
        {"id": "e2", "a": "n2", "b": "n3", "length_m": 50.0},
    ]
    graph_path.write_text(json.dumps({"version": 1, "nodes": nodes, "edges": edges}), encoding="utf-8")

    images, detections, verified = [], [], []
    for index in range(6):
        image_id = f"img{index}"
        images.append(
            {
                "id": image_id,
                "lon": lon,
                "lat": lat + 0.00008 * index,
                "compass_angle": 0.0,  # facing north, so sides fall east/west
                "captured_at": 1_700_000_000_000,
                "is_pano": False,
                "sequence": "seq1",
            }
        )
        covered = index < 4
        detections.append(
            {
                "image_id": image_id,
                "left": {"covered": covered, "kind": "awning" if covered else None, "confidence": 0.9},
                "right": {"covered": False, "kind": None, "confidence": 0.9},
                "reason": "selftest",
                "model": "selftest",
            }
        )
        if covered:
            verified.append(
                {
                    "image_id": image_id,
                    "side": "left",
                    "claimed_kind": "awning",
                    "first_confidence": 0.9,
                    "verified": index < 3,  # one deliberate rejection
                    "kind": "awning",
                    "confidence": 0.85,
                    "reason": "selftest",
                    "model": "selftest",
                }
            )

    _write_jsonl(C.IMAGES_JSONL, images)
    _write_jsonl(C.DETECTIONS_JSONL, detections)
    _write_jsonl(C.VERIFIED_JSONL, verified)

    import aggregate
    import stats

    payload = aggregate.run(graph_path=graph_path, out_path=C.AWNINGS_JSON)
    assert payload["edges"], "aggregate produced no edges"
    for edge_id, row in payload["edges"].items():
        assert 0.0 <= row["covered_fraction"] <= 1.0, edge_id
        assert row["verified"] is True, edge_id
        assert row["image_ids"], edge_id
        assert row["kind"] in C.KINDS, row["kind"]
    C.log(f"OK phase 1 aggregate: {len(payload['edges'])} edges, {payload['summary']}")

    result = stats.run()
    assert result["images_checked"] == 6, result["images_checked"]
    assert result["first_pass_positives"] == 4, result["first_pass_positives"]
    assert result["verified"] == 3, result["verified"]
    assert result["rejected_pct"] == 25.0, result["rejected_pct"]
    assert result["edges_covered"] == len(payload["edges"])
    C.log("OK phase 1 stats")
    return payload


# --------------------------------------------------------------------------
# phase 2: real fixture graph, then the contract checker
# --------------------------------------------------------------------------

def _place_camera_on_edge(geometry: list[list[float]]) -> tuple[float, float, float]:
    """Camera at the edge midpoint, facing along the edge, so its sides land on it."""
    (lon1, lat1), (lon2, lat2) = geometry[0], geometry[-1]
    mid_lon = (lon1 + lon2) / 2
    mid_lat = (lat1 + lat2) / 2
    east = (lon2 - lon1) * M_PER_DEG_LAT * math.cos(math.radians(mid_lat))
    north = (lat2 - lat1) * M_PER_DEG_LAT
    bearing = math.degrees(math.atan2(east, north)) % 360.0
    return mid_lon, mid_lat, bearing


def phase2(tmp: Path) -> None:
    fixture = C.REPO / "contracts" / "fixtures" / "graph.json"
    if not fixture.exists():
        C.log("SKIP phase 2: contracts/fixtures/graph.json not on main yet")
        return

    graph = C.read_json(fixture)
    edge = graph["edges"][0]
    lon, lat, bearing = _place_camera_on_edge(edge["geometry"])

    work = tmp / "phase2"
    work.mkdir(parents=True, exist_ok=True)
    (work / "images").mkdir(exist_ok=True)
    shutil.copy2(fixture, work / "graph.json")

    C.IMAGES_JSONL = work / "images.jsonl"
    C.DETECTIONS_JSONL = work / "detections.jsonl"
    C.VERIFIED_JSONL = work / "verified.jsonl"

    images = [
        {
            "id": f"pano{index}",
            "lon": lon,
            "lat": lat + 0.00002 * index,
            "compass_angle": bearing,
            "captured_at": 1_700_000_000_000,
            "is_pano": False,
            "sequence": "seq2",
        }
        for index in range(3)
    ]
    detections = [
        {
            "image_id": image["id"],
            "left": {"covered": True, "kind": "verandah", "confidence": 0.88},
            "right": {"covered": False, "kind": None, "confidence": 0.8},
            "reason": "selftest",
            "model": "selftest",
        }
        for image in images
    ]
    verified = [
        {
            "image_id": image["id"],
            "side": "left",
            "claimed_kind": "verandah",
            "first_confidence": 0.88,
            "verified": True,
            "kind": "verandah",
            "confidence": 0.86,
            "reason": "selftest",
            "model": "selftest",
        }
        for image in images
    ]

    _write_jsonl(C.IMAGES_JSONL, images)
    _write_jsonl(C.DETECTIONS_JSONL, detections)
    _write_jsonl(C.VERIFIED_JSONL, verified)

    import aggregate

    payload = aggregate.run(graph_path=work / "graph.json", out_path=work / "awnings.json")
    assert edge["id"] in payload["edges"], f"expected {edge['id']}, got {list(payload['edges'])}"
    row = payload["edges"][edge["id"]]
    assert row["kind"] == "verandah", row
    assert row["covered_fraction"] == 1.0, row
    C.log(f"OK phase 2 aggregate on the real fixture edge {edge['id']}")

    validator = C.REPO / "data" / "validate.py"
    if not validator.exists():
        C.log("SKIP validate.py (not on main yet)")
        return
    result = subprocess.run(
        [sys.executable, str(validator), str(work / "awnings.json")],
        capture_output=True,
        text=True,
        cwd=str(C.REPO),
    )
    print(result.stdout.strip())
    if result.returncode != 0:
        print(result.stderr.strip())
        raise SystemExit("phase 2: data/validate.py rejected ai/out/awnings.json shape")
    C.log("OK phase 2: data/validate.py accepts the aggregate output")


def main() -> None:
    problems = config.check()
    if problems:
        for problem in problems:
            C.log(f"CONFIG: {problem}")
        raise SystemExit("fix ai/config.py first")

    tmp = Path(tempfile.mkdtemp(prefix="ai-selftest-"))
    C.log(f"temp folder {tmp}")

    phase1(tmp / "phase1")
    phase2(tmp)
    C.log("selftest passed")


if __name__ == "__main__":
    main()
