"""Lane settings that must match CLAUDE.md and contracts/.

Values confirmed at 9:00 (see contracts/decisions.md). If CLAUDE.md or
contracts/ change, change this file too - it is the only copy in ai/.
"""

from __future__ import annotations

import os
from pathlib import Path

import common as C

# --- venue (Tanda HQ, Level 4, 108 Wickham St, Fortitude Valley) ------------
VENUE_LON = 153.031522
VENUE_LAT = -27.460061

# Half-width / half-height of the demo box, in degrees (~600 x 600 m).
HALF_LON = 0.00303
HALF_LAT = 0.00271

# --- demo day ---------------------------------------------------------------
DATE = "2026-11-21"
TIMEZONE_OFFSET_HOURS = 10  # Australia/Brisbane, no daylight saving

# --- AI pipeline ------------------------------------------------------------
MODEL_DETECT = os.environ.get("AI_MODEL_DETECT", "claude-haiku-5-5")
MODEL_VERIFY = os.environ.get("AI_MODEL_VERIFY", "claude-sonnet-5-5")

MAX_IMAGES = 1500
MIN_CAPTURE_YEAR = 2018
MIN_SPACING_M = 10.0
SIDE_OFFSET_M = 6.0  # an image side sits 6 m left/right of the camera
SNAP_RADIUS_M = 15.0  # observations further than this from a street are dropped
SIDE_WORKERS = 8


def _from_graph() -> list[float] | None:
    """The contract repeats the bbox inside graph.json, so read it when present."""
    if not C.GRAPH_JSON.exists():
        return None
    try:
        value = C.read_json(C.GRAPH_JSON).get("bbox")
    except (OSError, ValueError):
        return None
    return value if isinstance(value, list) and len(value) == 4 else None


def bbox(override: str | None = None) -> list[float]:
    """Return [minLon, minLat, maxLon, maxLat]."""
    if override:
        parts = [float(p) for p in override.replace(" ", "").split(",")]
        if len(parts) != 4:
            raise SystemExit("--bbox needs four numbers: minLon,minLat,maxLon,maxLat")
        return parts

    env = os.environ.get("AI_BBOX", "").strip()
    if env:
        return [float(p) for p in env.split(",")]

    from_graph = _from_graph()
    if from_graph:
        return from_graph

    return [
        VENUE_LON - HALF_LON,
        VENUE_LAT - HALF_LAT,
        VENUE_LON + HALF_LON,
        VENUE_LAT + HALF_LAT,
    ]


def bbox_string(override: str | None = None) -> str:
    return ",".join(f"{v:.7f}" for v in bbox(override))


def check(verbose: bool = False) -> list[str]:
    """Small sanity pass: catch a swapped pair before it costs API calls."""
    problems = []
    min_lon, min_lat, max_lon, max_lat = bbox()
    if not (min_lon < max_lon):
        problems.append(f"bbox longitude order looks wrong: {bbox()}")
    if not (min_lat < max_lat):
        problems.append(f"bbox latitude order looks wrong: {bbox()}")
    if not (150 < min_lon < 155 and -30 < min_lat < -25):
        problems.append(f"bbox is not in Brisbane, are [lon, lat] swapped? {bbox()}")
    if verbose:
        C.log(f"bbox {bbox()}  ({len(problems)} problems)")
    return problems
