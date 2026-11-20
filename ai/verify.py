"""A4 - Verifier pass with claude-sonnet-5-5.

Every side marked covered in detections.jsonl is re-checked in a FRESH request
that sees only the image and the claim, never the first pass's reasoning. A
result is verified only when the second pass also says covered.

Output: ai/cache/verified.jsonl, one line per checked positive side.
Resumable: a (image, side) pair already in the log is never sent again.

Run:   uv run --with anthropic python verify.py
       uv run --with anthropic python verify.py --limit 5
"""

from __future__ import annotations

import argparse
import base64
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import common as C
import config

KIND_ENUM = ["awning", "verandah", "shade_sail", "covered_walkway", "none"]

TOOL = {
    "name": "confirm_footpath_shade",
    "description": "Independently judge whether one footpath is covered overhead.",
    "input_schema": {
        "type": "object",
        "properties": {
            "covered": {"type": "boolean"},
            "kind": {"type": "string", "enum": KIND_ENUM},
            "confidence": {"type": "number", "description": "0 to 1"},
            "reason": {"type": "string"},
        },
        "required": ["covered", "kind", "confidence", "reason"],
    },
}

SIDE_LABEL = {
    "left": "LEFT of the camera (the left of the image)",
    "right": "RIGHT of the camera (the right of the image)",
}

_write_lock = threading.Lock()


def _image_block(path: Path) -> dict:
    data = base64.standard_b64encode(path.read_bytes()).decode("ascii")
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/jpeg", "data": data},
    }


def _prompt(side: str, kind: str | None) -> str:
    claim = f"covered by a {kind.replace('_', ' ')}" if kind else "covered overhead"
    return (
        f"Look at the footpath on the {SIDE_LABEL[side]}.\n\n"
        f"A previous observer claims this footpath is {claim}.\n\n"
        "Judge that claim independently: is the footpath really covered overhead by "
        "something built (awning, verandah, shade sail, covered walkway)?\n"
        "Trees do not count. Report with the tool."
    )


def _confirm(client, model: str, image_path: Path, side: str, kind: str | None) -> dict:
    def call():
        return client.messages.create(
            model=model,
            max_tokens=512,
            tools=[TOOL],
            tool_choice={"type": "tool", "name": TOOL["name"]},
            messages=[
                {
                    "role": "user",
                    "content": [
                        _image_block(image_path),
                        {"type": "text", "text": _prompt(side, kind)},
                    ],
                }
            ],
        )

    response = C.call_with_retry(call, label=f"verify {image_path.stem}/{side}")
    for block in response.content:
        if getattr(block, "type", None) == "tool_use":
            payload = dict(block.input or {})
            reported = payload.get("kind")
            return {
                "covered": bool(payload.get("covered", False)),
                "kind": None if reported in (None, "none") else reported,
                "confidence": float(payload.get("confidence", 0.0)),
                "reason": str(payload.get("reason", ""))[:300],
            }
    raise RuntimeError(f"no tool_use block for {image_path.name}/{side}")


def run(
    limit: int | None = None,
    workers: int = config.SIDE_WORKERS,
    model: str = config.MODEL_VERIFY,
) -> list[dict]:
    import anthropic

    C.ensure_dirs()
    client = anthropic.Anthropic(api_key=C.require_env("ANTHROPIC_API_KEY"))

    detections = C.read_jsonl(C.DETECTIONS_JSONL)
    if not detections:
        raise SystemExit("No detections yet. Run detect.py first.")

    already = {(row["image_id"], row["side"]) for row in C.read_jsonl(C.VERIFIED_JSONL)}

    claims = []
    for row in detections:
        for side in ("left", "right"):
            value = row[side]
            if not value.get("covered"):
                continue
            if (row["image_id"], side) in already:
                continue
            claims.append((row["image_id"], side, value.get("kind"), value.get("confidence")))

    if limit:
        claims = claims[:limit]

    C.log(f"{len(already)} already checked, {len(claims)} positive sides to verify")
    if not claims:
        return C.read_jsonl(C.VERIFIED_JSONL)

    results = []
    failures = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(
                _confirm, client, model, C.IMAGES_DIR / f"{image_id}.jpg", side, kind
            ): (image_id, side, kind, first_confidence)
            for image_id, side, kind, first_confidence in claims
        }
        for index, future in enumerate(as_completed(futures), start=1):
            image_id, side, kind, first_confidence = futures[future]
            try:
                second = future.result()
            except Exception as exc:  # noqa: BLE001
                failures += 1
                C.log(f"{image_id}/{side} failed: {exc}")
                continue

            record = {
                "image_id": image_id,
                "side": side,
                "claimed_kind": kind,
                "first_confidence": first_confidence,
                "verified": bool(second["covered"]),
                "kind": second["kind"] if second["covered"] else kind,
                "confidence": second["confidence"],
                "reason": second["reason"],
                "model": model,
            }
            results.append(record)
            C.append_jsonl(C.VERIFIED_JSONL, record, lock=_write_lock)

            if index % 25 == 0 or index == len(claims):
                kept = sum(1 for r in results if r["verified"])
                C.log(f"{index}/{len(claims)} checked, {kept} verified, {failures} failed")

    total = C.read_jsonl(C.VERIFIED_JSONL)
    verified = sum(1 for row in total if row["verified"])
    rejected = len(total) - verified
    rate = (100.0 * rejected / len(total)) if total else 0.0
    C.log(f"positives {len(total)}, verified {verified}, rejected {rejected} ({rate:.1f}%)")
    if failures:
        C.log(f"{failures} failed and will be retried on the next run")
    return total


def main() -> None:
    parser = argparse.ArgumentParser(description="Sonnet re-check of every positive.")
    parser.add_argument("--limit", type=int, help="verify only N claims")
    parser.add_argument("--workers", type=int, default=config.SIDE_WORKERS)
    parser.add_argument("--model", default=config.MODEL_VERIFY)
    args = parser.parse_args()

    run(limit=args.limit, workers=args.workers, model=args.model)


if __name__ == "__main__":
    main()
