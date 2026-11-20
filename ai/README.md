# ai/ (Aadit)

Finds shade that height data can't see: awnings, verandahs, shade sails and
covered walkways, from Mapillary street photos.

## Order of work

1. `fetch_images.py` → `ai/cache/images/*.jpg` + `ai/cache/images.jsonl`
2. `calibration.json` → 20 images you label by eye (do this before the full run)
3. `detect.py` → `ai/cache/detections.jsonl` (Haiku, first pass)
4. `verify.py` → `ai/cache/verified.jsonl` (Sonnet, re-checks every positive)
5. `aggregate.py` → `ai/out/awnings.json` (keyed by frozen edge ids)
6. `stats.py` → `ai/out/stats.json` + `ai/out/review.html`

## Rules

- Everything in `ai/cache/` is git-ignored and must never be re-downloaded.
- Every script appends results as they land, so a crash costs one request, not a run.
- `.env` at the repo root holds `MAPILLARY_TOKEN` and `ANTHROPIC_API_KEY`. Never print or commit it.
- `ai/out/awnings.json` is the only file other areas read. Its shape comes from `contracts/data-formats.md`.

Task cards: `docs/ROADMAP.md`, section "AI + Pitch (Aadit)".
