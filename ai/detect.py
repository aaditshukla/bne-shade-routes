"""A3 - First vision pass with claude-haiku-5-5.

For each cached image, ask whether the footpath on the LEFT and on the RIGHT of
the camera is covered overhead by an awning, verandah, shade sail or covered
walkway. Trees do not count.

Output: ai/cache/detections.jsonl, one line per image (both sides).
Resumable: an image already in the log is never sent again.

Run:   uv run --with anthropic python detect.py
       uv run --with anthropic python detect.py --limit 5
       uv run --with anthropic python detect.py --calibration
"""

from __future__ import annotations

import argparse
import base64
import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import common as C
import config

KIND_ENUM = ["awning", "verandah", "shade_sail", "covered_walkway", "none"]

SIDE_SCHEMA = {
    "type": "object",
    "properties": {
        "covered": {
            "type": "boolean",
            "description": "true only if something built (not a tree) covers this footpath overhead",
        },
        "kind": {
            "type": "string",
            "enum": KIND_ENUM,
            "description": "the covering type, or none",
        },
        "confidence": {"type": "number", "description": "0 to 1"},
    },
    "required": ["covered", "kind", "confidence"],
}

TOOL = {
    "name": "report_footpath_shade",
    "description": "Report whether each footpath beside the camera is covered overhead.",
    "input_schema": {
        "type": "object",
        "properties": {
            "left": SIDE_SCHEMA,
            "right": SIDE_SCHEMA,
            "reason": {"type": "string", "description": "one short sentence"},
        },
        "required": ["left", "right", "reason"],
    },
}

PROMPT = (
    "This is a street-level photo taken by a camera facing forward along a footpath. "
    "Look at the footpath on the LEFT of the camera and the footpath on the RIGHT "
    "(the right of the image, and the left of the image, respectively).\n\n"
    "For each side, decide whether that footpath is covered OVERHEAD by something built: "
    "a shop awning, a verandah, a shade sail, or a covered walkway.\n\n"
    "Trees and tree canopy do NOT count. Building walls, parked cars, shadows on the "
    "ground, and balconies high above the footpath do not count either.\n"
    "If you cannot see that side's footpath clearly, mark it not covered with low confidence.\n\n"
    "Report with the tool."
)

_write_lock = threading.Lock()


def _image_block(path: Path) -> dict:
    data = base64.standard_b64encode(path.read_bytes()).decode("ascii")
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/jpeg", "data": data},
    }


def _classify(client, model: str, image_path: Path) -> dict:
    def call():
        return client.messages.create(
            model=model,
            max_tokens=512,
            tools=[TOOL],
            tool_choice={"type": "tool", "name": TOOL["name"]},
            messages=[
                {
                    "role": "user",
                    "content": [_image_block(image_path), {"type": "text", "text": PROMPT}],
                }
            ],
        )

    response = C.call_with_retry(call, label=f"detect {image_path.stem}")

    for block in response.content:
        if getattr(block, "type", None) == "tool_use":
            payload = dict(block.input or {})
            for side in ("left", "right"):
                value = payload.get(side) or {}
                kind = value.get("kind")
                payload[side] = {
                    "covered": bool(value.get("covered", False)),
                    "kind": None if kind in (None, "none") else kind,
                    "confidence": float(value.get("confidence", 0.0)),
                }
            return payload

    raise RuntimeError(f"no tool_use block for {image_path.name}")


def _detection_count(rows: list[dict]) -> int:
    return sum(1 for row in rows for side in ("left", "right") if row[side]["covered"])


def run(
    limit: int | None = None,
    workers: int = config.SIDE_WORKERS,
    model: str = config.MODEL_DETECT,
    calibration_path: Path | None = None,
) -> list[dict]:
    import anthropic  # imported here so --help works without the package

    C.ensure_dirs()
    api_key = C.require_env("ANTHROPIC_API_KEY")
    client = anthropic.Anthropic(api_key=api_key)

    images = C.read_jsonl(C.IMAGES_JSONL)
    if not images:
        raise SystemExit("No images. Run fetch_images.py first.")

    done = {row["image_id"] for row in C.read_jsonl(C.DETECTIONS_JSONL)}
    pending = [row for row in images if row["id"] not in done]

    calibration = None
    if calibration_path is not None:
        calibration = C.read_json(calibration_path)
        wanted = {entry["id"] for entry in calibration.get("images", [])}
        pending = [row for row in images if row["id"] in wanted]
        C.log(f"calibration mode: {len(pending)} images, ignoring the resume log")

    if limit:
        pending = pending[:limit]

    C.log(f"{len(images)} cached, {len(done)} already classified, {len(pending)} to do")
    if not pending:
        return C.read_jsonl(C.DETECTIONS_JSONL)

    results: list[dict] = []
    failures = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_classify, client, model, C.IMAGES_DIR / f"{row['id']}.jpg"): row
            for row in pending
        }
        for index, future in enumerate(as_completed(futures), start=1):
            row = futures[future]
            try:
                payload = future.result()
            except Exception as exc:  # noqa: BLE001
                failures += 1
                C.log(f"{row['id']} failed: {exc}")
                continue

            record = {"image_id": row["id"], **payload, "model": model}
            results.append(record)

            if calibration is None:
                C.append_jsonl(C.DETECTIONS_JSONL, record, lock=_write_lock)

            if index % 25 == 0 or index == len(pending):
                positives = _detection_count(results)
                C.log(f"{index}/{len(pending)} images, {positives} positive sides, {failures} failed")

    if calibration is not None:
        _report_calibration(calibration, results)
        return results

    total_rows = C.read_jsonl(C.DETECTIONS_JSONL)
    sides = 2 * len(total_rows)
    positives = _detection_count(total_rows)
    rate = (100.0 * positives / sides) if sides else 0.0
    C.log(f"done. {len(total_rows)} images, {positives}/{sides} positive sides ({rate:.1f}%)")
    if failures:
        C.log(f"{failures} images failed and will be retried on the next run")
    return total_rows


def _report_calibration(calibration: dict, results: list[dict]) -> None:
    by_id = {row["image_id"]: row for row in results}
    side_ok = 0
    side_total = 0
    image_ok = 0
    image_total = 0

    for entry in calibration.get("images", []):
        got = by_id.get(entry["id"])
        if not got:
            continue
        image_total += 1
        both_ok = True
        for side in ("left", "right"):
            expected = entry.get(side) or {}
            agree = bool(expected.get("covered")) == got[side]["covered"]
            side_total += 1
            side_ok += int(agree)
            both_ok = both_ok and agree
        image_ok += int(both_ok)
        if not both_ok:
            C.log(
                f"  {entry['id']}: you said L={entry.get('left')} R={entry.get('right')}, "
                f"model said L={got['left']} R={got['right']} - {got.get('reason', '')}"
            )

    C.log(f"calibration: {side_ok}/{side_total} sides agree, {image_ok}/{image_total} images fully agree")
    if image_total and image_ok * 5 < image_total * 4:
        C.log("UNDER 16/20 - do not launch the full run yet, tighten the prompt first")


def main() -> None:
    parser = argparse.ArgumentParser(description="Haiku first pass over cached images.")
    parser.add_argument("--limit", type=int, help="classify only N images")
    parser.add_argument("--workers", type=int, default=config.SIDE_WORKERS)
    parser.add_argument("--model", default=config.MODEL_DETECT)
    parser.add_argument(
        "--calibration",
        nargs="?",
        const=str(C.AI_DIR / "calibration.json"),
        default=None,
        help="only run the 20 hand-labelled images and report agreement",
    )
    args = parser.parse_args()

    path = Path(args.calibration) if args.calibration else None
    run(limit=args.limit, workers=args.workers, model=args.model, calibration_path=path)


if __name__ == "__main__":
    main()
