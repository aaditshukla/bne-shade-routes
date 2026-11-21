# Handover — AI + Pitch (Aadit)

Written Fri 20 Nov 2026, ~06:40. Everything below is what a fresh session needs
so it doesn't redo work or repeat a mistake.

Read this first, then `CLAUDE.md` and `docs/ROADMAP.md` section "AI + Pitch (Aadit)".

---

## 1. Status at a glance

| | |
|---|---|
| Code for the lane | **written and tested offline** |
| Contract compatibility | **verified** by `data/validate.py` |
| Mapillary token | **works** (live API, real numbers below) |
| Anthropic key | **present in `.env`, never tested** |
| Images downloaded | **none yet** — only dry runs |
| `detect.py` / `verify.py` | **never executed against the API** |

So: the pipeline is built, the data source is proven, the paid part is untested.

---

## 2. What exists now

All new/changed files are in `ai/`. Nothing outside `ai/` was touched.

| File | Purpose | State |
|---|---|---|
| `common.py` | paths, `.env` loader, JSONL append, metres maths, retries | done |
| `config.py` | venue, bbox, models, 6 m offset, 15 m snap | done, real values |
| `fetch_images.py` | A2: Mapillary by bbox, grid tiling, thinning, resume, `--dry-run` | done, dry-run tested |
| `detect.py` | A3: Haiku first pass, `--calibration` mode, `--limit` | written, not run |
| `verify.py` | A4: Sonnet re-check of every positive | written, not run |
| `aggregate.py` | A5: observation → edge → `out/awnings.json` | done, tested |
| `stats.py` | A6: counts, `review.html`, `examples/`, `--precision` | done, tested |
| `selftest.py` | offline end-to-end test, two phases | done, passes |
| `setup_env.py` | prompts for keys with hidden input, writes `.env` | done |
| `out/awnings.json` | A1 stub: 3 **fixture** edge ids | done, validates |
| `calibration.json` | template for your 20 hand labels | **needs filling in** |

Untracked/modified on branch `ai_and_pitch`: `common.py`, `config.py`,
`selftest.py`, `setup_env.py`, `out/awnings.json` are new; the rest are modified.
**Not committed yet.**

---

## 3. Test results (run these again if anything looks off)

```sh
cd ai && uv run --with pyproj python selftest.py
```

Last run: passes. Phase 1 = fake graph + fake cache through `aggregate`/`stats`.
Phase 2 = observations on a real edge of `contracts/fixtures/graph.json`, output
accepted by `data/validate.py`.

```sh
cd data && uv run python validate.py ../ai/out/awnings.json
```

Last run: `OK awnings.json (3 edges, 3 verified)`.

```sh
cd data && uv run python validate.py
```

Last run: all files OK (graph 10 nodes/13 edges, shade 13×51, 4 buildings,
4 trees, 50 shadow files).

---

## 4. Mapillary findings — the important part

### 4.1 The API silently caps bbox queries (fixed)

Same query, three runs: **544, 730, 600** images. No error, just missing data.
Tiling the box fixes it:

| Method | Images found |
|---|---|
| one bbox query | ~600, varies every call |
| 4×4 grid | 1,737 |
| 8×8 grid | 1,780 |

`fetch_images.py` now splits any tile returning ≥ 400 images, max depth 4.
Constants: `TILE_TRIGGER = 400`, `MAX_TILE_DEPTH = 4`, `PAGE_LIMIT = 1000`.
**Do not lower `TILE_TRIGGER` back to 1000** — that was the bug.

### 4.2 Real coverage for the demo bbox (from `--dry-run`)

```sh
cd ai && uv run python fetch_images.py --dry-run
```

```
bbox [153.02849, -27.46277, 153.03455, -27.45735]
1753 raw images in the box
1226 not panoramas
 960 captured 2018 or later
 460 after thinning to 1 per 10 m, across 27 sequences
```

- **460 usable photos, comfortably past the ~200 tripwire.** No hand-labelling
  needed on volume grounds.
- Roughly 460 × 10 m ≈ **4.6 km of street surveyed**, out of ~10–15 km in the
  box. Awnings will only exist where Mapillary drove.

### 4.3 Recency problem (tell the pitch about this)

Raw captures by year: 2015: 106, 2016: 101, 2017: 59, 2018: 521, 2019: 439,
2020: 459, 2022: 68.

**Every 2020 and 2022 capture is a panorama** (527 total). Strip panoramas and
the newest street-level imagery is **2019**.

Consequences:
- We may report shade that has since been removed, and miss new awnings.
- Volume is fine; **accuracy against today's street is the risk.**
- Pitch framing: openly licensed imagery with a known capture date is auditable,
  and the pipeline is date-parametric — feed it 2026 photos, no code change.
- Put this in the Q&A crib before a judge asks.

---

## 5. Decisions baked into the code

These match `contracts/`, but know why they are there:

1. **Better side per image.** `covered_fraction` counts one observation per
   (image, edge), positive if *either* side is verified covered. The graph has
   street centrelines only, so both sidewalks snap to the same edge; a literal
   per-side count capped `covered_fraction` at 0.5 and would have halved every
   awning's effect. Source: `docs/ROADMAP.md` A5 note.
2. **6 m side offset** perpendicular to `compass_angle`; left = bearing − 90°.
3. **15 m snap radius**, brute-force nearest edge; further gets dropped.
4. **Distances in metres.** `pyproj` → EPSG:7856 in `aggregate.py`. The 10 m
   thinning and 6 m offset use haversine/local metres (error « 1 m over 600 m).
5. **Resumable everywhere.** Every result is appended to `ai/cache/*.jsonl`
   immediately; scripts skip what is already logged. Never re-download.
6. **Models** `claude-haiku-5-5` / `claude-sonnet-5-5` from Q7. If a call 404s,
   set `AI_MODEL_DETECT` / `AI_MODEL_VERIFY` in `.env`; do not edit code.
7. **No `pyproject.toml` in `ai/`.** Two deps only, pulled per run with
   `uv run --with anthropic` / `--with pyproj`. Nothing to conflict with `data/`.

---

## 6. Next actions, in order

### Step 1 — download the images (low effort)

```sh
cd ai && uv run python fetch_images.py
```

Expect ~460 images in `ai/cache/images/`, metadata appended to
`ai/cache/images.jsonl`, totals printed by year. Cached forever after.

### Step 2 — prove the Anthropic key (low effort, costs < 1c)

Make one tiny Haiku call before launching anything bigger. Do not run the full
`detect.py` until a single call works.

### Step 3 — fill `ai/calibration.json` (needs your eyes, ~10 min)

Pick 20 images from `ai/cache/images.jsonl`, look at each, record your own
left/right answers. Then:

```sh
cd ai && uv run --with anthropic python detect.py --calibration
```

Need **≥ 16/20** images fully agreeing before the full run. If under, tighten the
prompt in `detect.py` (`PROMPT`) and retry — this is 5 minutes that saves the run.

### Step 4 — first pass, then verifier

```sh
cd ai && uv run --with anthropic python detect.py
cd ai && uv run --with anthropic python verify.py     # background this, go do P1
```

`detect.py` prints progress every 25 images and the positive rate. `verify.py`
prints positives, verified and % rejected. Both resume after a crash.

### Step 5 — aggregate (needs the real graph)

```sh
cd ai && uv run --with pyproj python aggregate.py
cd ../data && uv run python validate.py ../ai/out/awnings.json
```

### Step 6 — stats and slides

```sh
cd ai && uv run python stats.py                        # writes out/stats.json + review.html
cd ai && uv run python stats.py --precision 27/30      # after counting mistakes
cd ai && uv run python stats.py --examples
```

Then `docs/pitch.md` from `docs/ROADMAP.md` P2, using the numbers in
`ai/out/stats.json`.

---

## 7. Blockers and things to ask about

1. **`web/src/routing/` does not exist yet.** P1 (`docs/find-demo-routes.ts`)
   must import Web's real router. A second router is explicitly banned, so P1
   cannot start until Eric ships W1. Check before writing anything.
2. **`ai/out/awnings.json` is keyed to fixture edge ids.** At the graph freeze
   (G2, ~11:00) it must be re-keyed to 3 real edges, or every key is silently
   invalid and Data's merge drops everything.
3. **Anthropic model names are from the plan, unverified.** First call will tell.
4. **Not written, deliberately:** A7 contact sheet (fallback, needs your eyes)
   and P2/P3 docs (need real stats). Ask rather than assume.
5. **`gh` is not on PATH** in this environment, so issue claiming / PRs from the
   shell need it installed or done in the browser.

---

## 8. Environment gotchas

- **The machine clock is set to UTC−08:00** (`date` shows −0800). Every time in
  `CLAUDE.md` and `docs/ROADMAP.md` is **Brisbane, UTC+10**. That is an 18-hour
  difference — do not trust the local clock when judging "what time is it".
  Brisbane is `TZ=Australia/Brisbane`.
- **Branch is `ai_and_pitch`.** Convention is `aadit/<issue>-<slug>`; issue
  numbers appear after `bash docs/seed-issues.sh` runs at 9:35.
- Commit format `[ai] what changed (#n)`. `pitch` and `demo` for the other lanes.
- **No AI attribution anywhere** — commits, PRs, issues, comments, tags.
- Only `ai/` and `docs/` are yours. Never fix another area's file.
- `.env` holds both keys (54 and 110 chars) at the repo root. Git-ignored.
  Never print, log or commit it. `ai/setup_env.py` is the safe way to change it.

---

## 9. One-paragraph summary for a fresh session

The AI lane is fully implemented in `ai/` and passes an offline end-to-end test
that `data/validate.py` accepts. The Mapillary token works; the demo bbox has
~1753 raw images, 460 usable street-level photos after filtering and thinning,
but nothing newer than 2019 because all later captures are panoramas. A silent
per-bbox API cap was found and fixed with recursive tiling — that bug alone was
losing two-thirds of the data. Nothing has been downloaded yet and the Anthropic
key has never been called, so the next steps are: download images, make one tiny
API call, fill in the 20-image calibration, then run detect → verify → aggregate
→ stats. P1 is blocked on `web/src/routing/`, and the fixture-keyed
`ai/out/awnings.json` must be re-keyed to real edges at the graph freeze.
