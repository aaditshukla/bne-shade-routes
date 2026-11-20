"""A2 - Download Mapillary street photos for the demo bbox.

Fetched by bbox, never per edge, so this never waits on graph.json.

Outputs:
  ai/cache/images/<id>.jpg   1024 px thumbnails
  ai/cache/images.jsonl      id, lon, lat, compass_angle, captured_at,
                             is_pano, sequence (appended as each lands)

Rules (docs/ROADMAP.md A2): skip panoramas, drop captures before 2018, thin
each sequence to about one image per 10 m, cap at 1500 newest first, resumable.

Run:  uv run python fetch_images.py
      uv run python fetch_images.py --bbox 152.9,-27.5,153.0,-27.4 --limit 5
"""

from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import common as C
import config

API = "https://graph.mapillary.com/images"
FIELDS = "id,computed_geometry,compass_angle,captured_at,is_pano,sequence,thumb_1024_url"
USER_AGENT = "shade-router-hackathon/1.0 (Tanda HackAIthon)"

# The images endpoint silently caps how many results one bbox query returns
# (a single 600x600 m query here gives ~600 of ~1780 images). So split any tile
# that comes back dense. Measured in this box: 4x4 grid = 1737 images,
# 8x8 grid = 1780, so ~400 per tile with depth 4 converges.
PAGE_LIMIT = 1000
TILE_TRIGGER = 400
MAX_TILE_DEPTH = 4


def _get_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def _fetch_tile(bbox: list[float], token: str, depth: int = 0) -> list[dict]:
    """Fetch every image in a bbox, splitting into quadrants if it saturates."""
    rows: list[dict] = []
    after = None

    while True:
        params = {
            "access_token": token,
            "fields": FIELDS,
            "bbox": ",".join(f"{v:.7f}" for v in bbox),
            "limit": PAGE_LIMIT,
        }
        if after:
            params["after"] = after
        url = f"{API}?{urllib.parse.urlencode(params)}"
        payload = C.call_with_retry(lambda u=url: _get_json(u), label="mapillary images")

        rows.extend(payload.get("data", []))

        next_url = payload.get("paging", {}).get("next")
        if not next_url:
            break
        after = urllib.parse.parse_qs(urllib.parse.urlparse(next_url).query).get("after", [None])[0]
        if not after:
            break

    if len(rows) >= TILE_TRIGGER and depth < MAX_TILE_DEPTH:
        min_lon, min_lat, max_lon, max_lat = bbox
        mid_lon = (min_lon + max_lon) / 2
        mid_lat = (min_lat + max_lat) / 2
        quadrants = [
            [min_lon, min_lat, mid_lon, mid_lat],
            [mid_lon, min_lat, max_lon, mid_lat],
            [min_lon, mid_lat, mid_lon, max_lat],
            [mid_lon, mid_lat, max_lon, max_lat],
        ]
        C.log(f"tile returned {len(rows)} images, splitting into 4 (depth {depth + 1})")
        rows = []
        for quadrant in quadrants:
            rows.extend(_fetch_tile(quadrant, token, depth + 1))

    return rows


def _year(captured_at_ms) -> int:
    if not captured_at_ms:
        return 0
    return datetime.fromtimestamp(captured_at_ms / 1000, tz=timezone.utc).year


def _thin_sequence(images: list[dict], min_spacing_m: float) -> list[dict]:
    """Keep about one image per min_spacing_m within each sequence."""
    by_sequence: dict[str, list[dict]] = {}
    for image in images:
        by_sequence.setdefault(image.get("sequence") or image["id"], []).append(image)

    kept: list[dict] = []
    for sequence, rows in by_sequence.items():
        rows.sort(key=lambda r: r.get("captured_at") or 0)
        last = None
        for row in rows:
            lon, lat = row["lon"], row["lat"]
            if last is None or C.haversine_m(last[0], last[1], lon, lat) >= min_spacing_m:
                kept.append(row)
                last = (lon, lat)
    return kept


def _normalise(raw: dict) -> dict | None:
    geometry = raw.get("computed_geometry") or {}
    coords = geometry.get("coordinates")
    if not coords or len(coords) != 2:
        return None
    return {
        "id": raw["id"],
        "lon": float(coords[0]),
        "lat": float(coords[1]),
        "compass_angle": raw.get("compass_angle"),
        "captured_at": raw.get("captured_at"),
        "is_pano": bool(raw.get("is_pano")),
        "sequence": raw.get("sequence"),
        "thumb_1024_url": raw.get("thumb_1024_url"),
    }


def _download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    tmp = dest.with_suffix(".part")
    with urllib.request.urlopen(request, timeout=90) as response:
        tmp.write_bytes(response.read())
    tmp.replace(dest)


def run(
    bbox: list[float] | None = None,
    token: str | None = None,
    max_images: int = config.MAX_IMAGES,
    min_year: int = config.MIN_CAPTURE_YEAR,
    min_spacing_m: float = config.MIN_SPACING_M,
    limit: int | None = None,
    dry_run: bool = False,
) -> list[dict]:
    C.ensure_dirs()
    token = token or C.require_env("MAPILLARY_TOKEN")
    bbox = bbox or config.bbox()

    C.log(f"bbox {bbox}")

    raw = _fetch_tile(bbox, token)
    by_id = {row["id"]: row for row in raw if row.get("id")}
    raw = list(by_id.values())
    C.log(f"{len(raw)} raw images in the box")

    images = [img for img in (_normalise(r) for r in raw) if img]
    images = [img for img in images if not img["is_pano"]]
    C.log(f"{len(images)} non-panorama")

    images = [img for img in images if _year(img["captured_at"]) >= min_year]
    C.log(f"{len(images)} captured {min_year} or later")

    images.sort(key=lambda r: r.get("captured_at") or 0, reverse=True)
    images = _thin_sequence(images, min_spacing_m)
    C.log(f"{len(images)} after thinning to 1 per {min_spacing_m:.0f} m per sequence")

    images = images[:max_images]
    if limit:
        images = images[:limit]
    C.log(f"{len(images)} selected for download (cap {max_images})")

    if dry_run:
        years: dict[int, int] = {}
        for image in images:
            year = _year(image.get("captured_at"))
            years[year] = years.get(year, 0) + 1
        for year in sorted(years):
            C.log(f"  {year}: {years[year]}")
        C.log("dry run: nothing downloaded")
        return images

    already = {row["id"] for row in C.read_jsonl(C.IMAGES_JSONL)}
    downloaded = 0

    for image in images:
        image_id = image["id"]
        dest = C.IMAGES_DIR / f"{image_id}.jpg"
        url = image.pop("thumb_1024_url", None)
        if image_id not in already:
            if url:
                try:
                    C.call_with_retry(lambda u=url, d=dest: _download(u, d), label=f"image {image_id}")
                except Exception as exc:  # noqa: BLE001
                    C.log(f"download failed for {image_id}: {exc}")
                    continue
            C.append_jsonl(C.IMAGES_JSONL, image)
            downloaded += 1
            if downloaded % 50 == 0:
                C.log(f"downloaded {downloaded}/{len(images)}")

    C.log(f"new images this run: {downloaded}")

    years: dict[int, int] = {}
    for row in C.read_jsonl(C.IMAGES_JSONL):
        years[_year(row.get("captured_at"))] = years.get(_year(row.get("captured_at")), 0) + 1
    for year in sorted(years):
        C.log(f"  {year}: {years[year]}")
    C.log(f"total cached: {sum(years.values())}")

    return images


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Mapillary images for the demo box.")
    parser.add_argument("--bbox", help="minLon,minLat,maxLon,maxLat")
    parser.add_argument("--limit", type=int, help="only download N images (cheap test)")
    parser.add_argument("--max-images", type=int, default=config.MAX_IMAGES)
    parser.add_argument("--min-year", type=int, default=config.MIN_CAPTURE_YEAR)
    parser.add_argument("--min-spacing", type=float, default=config.MIN_SPACING_M)
    parser.add_argument("--dry-run", action="store_true", help="count images, download nothing")
    args = parser.parse_args()

    run(
        bbox=config.bbox(args.bbox),
        max_images=args.max_images,
        min_year=args.min_year,
        min_spacing_m=args.min_spacing,
        limit=args.limit,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
