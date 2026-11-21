"""A6 - Accuracy numbers for the pitch slide.

Counts images checked, first-pass positives, verified, % rejected by the
verifier, edges covered and covered metres.

Also writes ai/out/review.html: 30 random verified positives plus 10 random
rejections, so precision can be counted by eye in five minutes.

Run:  python stats.py                          # counts + review page
      python stats.py --precision 27/30        # record precision
      python stats.py --examples               # copy 3 examples, one per kind
"""

from __future__ import annotations

import argparse
import html
import random
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import common as C

REVIEW_POSITIVES = 30
REVIEW_NEGATIVES = 10


# --------------------------------------------------------------------------
# awnings.json (shape is still a guess until contracts/ lands)
# --------------------------------------------------------------------------

def iter_awnings(payload) -> list[tuple[str, dict]]:
    if isinstance(payload, dict) and isinstance(payload.get("edges"), dict):
        return list(payload["edges"].items())
    if isinstance(payload, dict) and isinstance(payload.get("awnings"), list):
        return [(str(row.get("edge_id")), row) for row in payload["awnings"]]
    if isinstance(payload, list):
        return [(str(row.get("edge_id")), row) for row in payload]
    return []


def _lengths(graph_path: Path) -> dict[str, float]:
    """Edge id -> length_m straight from graph.json (no projection needed)."""
    data = C.read_json(graph_path)
    raw = data.get("edges", []) if isinstance(data, dict) else data
    if isinstance(raw, dict):
        raw = list(raw.values())
    return {str(edge.get("id")): float(edge.get("length_m") or 0.0) for edge in raw}


def compute() -> dict:
    images = C.read_jsonl(C.IMAGES_JSONL)
    detections = C.read_jsonl(C.DETECTIONS_JSONL)
    verified_rows = C.read_jsonl(C.VERIFIED_JSONL)

    positives = sum(
        1 for row in detections for side in ("left", "right") if row[side].get("covered")
    )
    sides = 2 * len(detections)
    verified = [row for row in verified_rows if row.get("verified")]
    rejected = len(verified_rows) - len(verified)
    rejected_pct = (100.0 * rejected / len(verified_rows)) if verified_rows else 0.0

    awnings = []
    if C.AWNINGS_JSON.exists():
        awnings = iter_awnings(C.read_json(C.AWNINGS_JSON))

    covered_metres = 0.0
    if C.GRAPH_JSON.exists():
        lengths = _lengths(C.GRAPH_JSON)
        covered_metres = sum(lengths.get(edge_id, 0.0) for edge_id, _ in awnings)

    kinds = Counter(row.get("kind") or "awning" for _, row in awnings)

    stats = {
        "date": "2026-11-21",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "images_cached": len(images),
        "images_checked": len(detections),
        "sides_checked": sides,
        "first_pass_positives": positives,
        "first_pass_positive_pct": round(100.0 * positives / sides, 1) if sides else 0.0,
        "verified": len(verified),
        "rejected_by_verifier": rejected,
        "rejected_pct": round(rejected_pct, 1),
        "edges_covered": len(awnings),
        "covered_metres": round(covered_metres, 1),
        "kinds": dict(kinds),
        "precision": None,
    }

    if C.STATS_JSON.exists():
        previous = C.read_json(C.STATS_JSON)
        stats["precision"] = previous.get("precision")

    return stats


# --------------------------------------------------------------------------
# review page
# --------------------------------------------------------------------------

def write_review(negatives: int = REVIEW_NEGATIVES, positives: int = REVIEW_POSITIVES) -> Path:
    rng = random.Random(7)
    rows = C.read_jsonl(C.VERIFIED_JSONL)
    pos = [row for row in rows if row.get("verified")]
    neg = [row for row in rows if not row.get("verified")]

    chosen = [("VERIFIED", row) for row in rng.sample(pos, min(positives, len(pos)))]
    chosen += [("REJECTED", row) for row in rng.sample(neg, min(negatives, len(neg)))]

    cards = []
    for label, row in chosen:
        relative = f"../cache/images/{row['image_id']}.jpg"
        colour = "#1a7f37" if label == "VERIFIED" else "#b42318"
        cards.append(
            f'<figure><img src="{html.escape(relative)}" loading="lazy">'
            f'<figcaption><b style="color:{colour}">{label}</b> '
            f'{html.escape(row.get("side", "?"))} · {html.escape(str(row.get("kind") or "none"))}<br>'
            f'<small>{html.escape((row.get("reason") or "")[:120])}</small>'
            f"</figcaption></figure>"
        )

    page = f"""<!doctype html>
<meta charset="utf-8">
<title>Awning check · {len(chosen)} images</title>
<style>
  body {{ font: 14px system-ui, sans-serif; margin: 24px; background: #faf9f7; }}
  h1 {{ font-size: 18px; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }}
  figure {{ margin: 0; background: #fff; border: 1px solid #e5e2dd; border-radius: 8px; overflow: hidden; }}
  img {{ width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; }}
  figcaption {{ padding: 8px; line-height: 1.4; }}
</style>
<h1>Is each VERIFIED card really covered? Count the mistakes, then record precision.</h1>
<p>{len([c for c in chosen if c[0] == "VERIFIED"])} verified, {len([c for c in chosen if c[0] != "VERIFIED"])} rejected.
Record with: <code>python stats.py --precision correct/30</code></p>
<div class="grid">{"".join(cards)}</div>
"""
    C.REVIEW_HTML.write_text(page, encoding="utf-8")
    C.log(f"wrote {C.REVIEW_HTML} ({len(chosen)} cards)")
    return C.REVIEW_HTML


def copy_examples() -> list[Path]:
    rows = [row for row in C.read_jsonl(C.VERIFIED_JSONL) if row.get("verified")]
    best: dict[str, dict] = {}
    for row in rows:
        kind = row.get("kind") or "awning"
        if kind not in best or float(row.get("confidence") or 0) > float(best[kind].get("confidence") or 0):
            best[kind] = row

    C.EXAMPLES.mkdir(parents=True, exist_ok=True)
    written = []
    for kind, row in best.items():
        source = C.IMAGES_DIR / f"{row['image_id']}.jpg"
        if not source.exists():
            continue
        dest = C.EXAMPLES / f"{kind}_{row['image_id']}.jpg"
        shutil.copy2(source, dest)
        written.append(dest)
        C.log(f"example: {dest.name}")
    return written


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def run() -> dict:
    C.ensure_dirs()
    stats = compute()
    C.write_json(C.STATS_JSON, stats)

    for key in (
        "images_cached",
        "images_checked",
        "first_pass_positives",
        "verified",
        "rejected_pct",
        "edges_covered",
        "covered_metres",
        "precision",
    ):
        C.log(f"{key}: {stats[key]}")

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Precision and stats for the pitch.")
    parser.add_argument("--precision", help="correct/30, saved into stats.json")
    parser.add_argument("--examples", action="store_true", help="copy one example per kind")
    parser.add_argument("--no-review", action="store_true", help="skip review.html")
    args = parser.parse_args()

    stats = run()

    if args.precision:
        try:
            correct, total = (int(part) for part in args.precision.split("/"))
        except ValueError:
            raise SystemExit("--precision takes correct/30, for example 27/30")
        stats["precision"] = {"correct": correct, "checked": total, "pct": round(100.0 * correct / total, 1)}
        C.write_json(C.STATS_JSON, stats)
        C.log(f"precision recorded: {stats['precision']['pct']}%")

    if not args.no_review:
        write_review()

    if args.examples:
        copy_examples()


if __name__ == "__main__":
    main()
