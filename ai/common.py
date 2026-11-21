"""Shared helpers for the AI lane. Standard library only - no pip installs."""

from __future__ import annotations

import json
import math
import os
import random
import time
from pathlib import Path

AI_DIR = Path(__file__).resolve().parent
REPO = AI_DIR.parent

CACHE = AI_DIR / "cache"
IMAGES_DIR = CACHE / "images"
IMAGES_JSONL = CACHE / "images.jsonl"
DETECTIONS_JSONL = CACHE / "detections.jsonl"
VERIFIED_JSONL = CACHE / "verified.jsonl"

OUT = AI_DIR / "out"
EXAMPLES = OUT / "examples"
AWNINGS_JSON = OUT / "awnings.json"
STATS_JSON = OUT / "stats.json"
REVIEW_HTML = OUT / "review.html"

GRAPH_JSON = REPO / "web" / "public" / "data" / "graph.json"

# The awning kinds the contract allows. "none" is only used inside the model's
# tool schema (JSON Schema enums dislike null), and is mapped back to None here.
KINDS = ("awning", "verandah", "shade_sail", "covered_walkway")


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def ensure_dirs() -> None:
    for d in (CACHE, IMAGES_DIR, OUT):
        d.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------------
# .env
# --------------------------------------------------------------------------

def load_env() -> None:
    """Read KEY=VALUE lines from the repo-root .env. Never prints anything."""
    path = REPO / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def require_env(name: str) -> str:
    load_env()
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(
            f"Missing {name}. Put it in .env at the repo root, see .env.example."
        )
    return value


# --------------------------------------------------------------------------
# files
# --------------------------------------------------------------------------

def read_json(path: Path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    tmp.replace(path)


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                log(f"skipping bad line in {path.name}")
    return rows


def append_jsonl(path: Path, row: dict, lock=None) -> None:
    """Append one result immediately, so a crash costs one request, not a run."""
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(row, ensure_ascii=False) + "\n"
    if lock is None:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(line)
            fh.flush()
            os.fsync(fh.fileno())
    else:
        with lock:
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(line)
                fh.flush()
                os.fsync(fh.fileno())


# --------------------------------------------------------------------------
# geometry (metres, no third-party deps)
# --------------------------------------------------------------------------

EARTH_M_PER_DEG_LAT = 110_574.0


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6_371_008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def seg_distance_m(px, py, ax, ay, bx, by) -> float:
    """Distance from point to segment, all values in metres."""
    vx, vy = bx - ax, by - ay
    length_sq = vx * vx + vy * vy
    if length_sq == 0.0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * vx + (py - ay) * vy) / length_sq
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


# --------------------------------------------------------------------------
# retries
# --------------------------------------------------------------------------

RETRY_STATUS = {408, 409, 429, 500, 502, 503, 504, 529}


def call_with_retry(fn, attempts: int = 6, base: float = 2.0, label: str = "request"):
    """Retry network / overload errors with exponential backoff and jitter."""
    last = None
    for attempt in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 - we inspect the status below
            last = exc
            status = getattr(exc, "status_code", None)
            fatal = status is not None and status not in RETRY_STATUS
            if fatal or attempt == attempts - 1:
                raise
            delay = base * (2 ** attempt) + random.uniform(0, 1.0)
            log(f"{label}: {type(exc).__name__} (status={status}), retry in {delay:.1f}s")
            time.sleep(delay)
    raise last  # pragma: no cover
