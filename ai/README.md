# ai/ (Aadit) — shade that heights can't see

> **Starting a new session? Read `HANDOVER.md` first** — current status, test
> results, the Mapillary findings and the next actions are all there.

Claude looks at Mapillary street photos and finds awnings, verandahs, shade
sails and covered walkways. Haiku makes a first pass, Sonnet re-checks every
positive. The result is `ai/out/awnings.json`, keyed by frozen edge ID.

## Run order

```sh
cd ai

# A2  download photos (standard library only)
uv run python fetch_images.py
uv run python fetch_images.py --limit 5      # cheap test first

# A3  calibrate on 20 images you labelled by eye (need 16/20 before the full run)
uv run --with anthropic python detect.py --calibration

# A3  first pass, all images
uv run --with anthropic python detect.py
uv run --with anthropic python detect.py --limit 5

# A4  verifier, every positive. Background it and go do P1.
uv run --with anthropic python verify.py

# A5  snap to edges -> ai/out/awnings.json  (needs web/public/data/graph.json)
uv run --with pyproj python aggregate.py

# A6  numbers + review.html + examples
uv run python stats.py
uv run python stats.py --precision 27/30
uv run python stats.py --examples

# Contract check of the output (run from the repo root)
cd ../data && uv run python validate.py ../ai/out/awnings.json
```

Only two third-party packages are needed, and neither is installed by default:
`anthropic` (detect, verify) and `pyproj` (aggregate). Both are pulled in by
`uv run --with ...`, so there is no `pyproject.toml` here to conflict with the
data lane. **Ask the team before adding any others.**

## Smoke test (no keys, no network)

```sh
cd ai && uv run --with pyproj python selftest.py
```

Makes a fake cache and fake graph in a temp folder, runs `aggregate.py` and
`stats.py`, then places observations on a real edge of
`contracts/fixtures/graph.json` and checks the output with `data/validate.py`.
Run this after every change.

## Files

| File | What |
|---|---|
| `common.py` | paths, `.env` loader, JSONL append, metres maths, retries |
| `config.py` | venue, bbox, models, 6 m side offset, 15 m snap radius |
| `fetch_images.py` | A2, Mapillary by bbox, resumable |
| `detect.py` | A3, Haiku first pass, `--calibration` mode |
| `verify.py` | A4, Sonnet re-check of every positive |
| `aggregate.py` | A5, observation → edge, writes `out/awnings.json` |
| `stats.py` | A6, counts, `review.html`, `examples/` |
| `selftest.py` | offline end-to-end test |
| `calibration.json` | your 20 hand labels (fill this in first) |

## Rules baked into the code

- Every result is appended to `ai/cache/*.jsonl` the moment it lands, and every
  script skips what is already logged. A crash costs one request, not a run.
- Photos are never re-downloaded; `ai/cache/` is git-ignored.
- `.env` keys are read but never printed.
- Distances are in metres (EPSG:7856 via `pyproj`). The 6 m side offset and
  10 m thinning use local/haversine metres, which is well under a pixel's worth
  of error over 600 m.
- `awnings.json` uses only the four contract kinds. Trees never count as cover.

## Known gaps (honest list)

1. **A7 contact sheet is not written.** It is a fallback for hand-labelling and
   needs visual judgement; ask for it if the verifier rejects too much.
2. **`docs/find-demo-routes.ts` (P1) is not written.** It must import Web's real
   router from `web/src/routing/`, which does not exist yet. Do not write a
   second router.
3. **Model names are from the plan** (`claude-haiku-5-5`, `claude-sonnet-5-5`).
   If a call 404s, set `AI_MODEL_DETECT` / `AI_MODEL_VERIFY` in `.env` instead of
   editing code.
4. **`ai/out/awnings.json` currently holds 3 fixture edge IDs** (task A1). It is
   a stub for Web and Data to integrate against. **Re-key it to 3 real edges
   after the graph freeze (G2, ~11:00), or every key becomes invalid.**
5. **The images endpoint silently caps a bbox query** (measured: ~600 of ~1753
   in this box, and it varies per call). `fetch_images.py` splits any tile that
   returns 400+ images, max depth 4, which converges to ~1780 here. Do not raise
   `TILE_TRIGGER` back to 1000 — that reintroduces the data loss.
