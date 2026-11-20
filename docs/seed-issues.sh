#!/usr/bin/env bash
# Shade Router: create the task board (labels + one issue per roadmap task, in time order).
# Run ONCE from the repo root after contracts/ is on main:   bash docs/seed-issues.sh
# Generated from the roadmap. If the plan changes, change docs/ROADMAP.md and the issues by hand.
set -euo pipefail

command -v gh >/dev/null 2>&1 || { echo "Install the GitHub CLI (gh) and run: gh auth login" >&2; exit 1; }
gh repo view >/dev/null 2>&1 || { echo "Run this from inside the team repo; gh cannot see a GitHub repo here." >&2; exit 1; }

existing=$(gh issue list --state all --limit 1 --json number --jq 'length')
if [ "$existing" != "0" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "This repo already has issues, so the board may exist. Re-run with FORCE=1 to create them anyway (duplicates)." >&2
  exit 1
fi

label() { gh label create "$1" --color "$2" --description "$3" --force >/dev/null && echo "label  $1"; }
issue() { local url; url=$(gh issue create --title "$1" --label "$2" --body-file -) && echo "issue  $url  $1"; }

label data 1E8A70 'Data pipeline, contracts, generated files'
label ai 7357C4 'Mapillary fetch, vision + verifier, awnings.json'
label web 2B6CD1 'Map, routing, UI, deploy'
label 3d C2386F 'three.js shade view'
label pitch B7791F 'Slides, demo routes, script'
label demo E3A21A 'Backup video, rehearsals, submission'
label bug C53030 'Something on the demo path is broken'
label blocked 6E7781 'Waiting on another area; say why in a comment'

issue '[D1] Fixtures in web/public/data/ + validate.py' data <<'ISSUE_BODY'
**Suggested time:** 9:45–10:15 Brisbane time · **Area:** Data · **Depends on:** D0
**Stub first:** make the output match the fixtures exactly, then ship.

### Done when
- [ ] Fixtures copied into web/public/data/ and pushed by about 9:50, before validate.py, so Web can deploy on them.
- [ ] data/validate.py checks every file against the contract and exits 1 on any failure.
- [ ] validate.py takes an optional path so AI can check ai/out/awnings.json.

### Prompt to start with
```text
Copy every file in contracts/fixtures/ into web/public/data/ and push that first. Then write data/validate.py (standard library only) that checks each file there against contracts/data-formats.md: required keys and types; exactly 51 slots from 06:00 to 18:30; every shade.json edge has 51 values in [0, 1]; every edge id in shade.json and awnings.json exists in graph.json; all coordinates are [lon, lat] inside the bbox (buildings may reach 100 m outside it); height_m > 0. Accept an optional file path. Print one OK or FAIL line per file and exit 1 on failure. Run it.
```

Roadmap: docs/ROADMAP.md, task D1.
ISSUE_BODY

issue '[A1] awnings.json stub with 3 hand-labelled edges' ai <<'ISSUE_BODY'
**Suggested time:** 9:45–10:15 Brisbane time · **Area:** AI + Pitch · **Depends on:** D0
**Stub first:** make the output match the fixtures exactly, then ship.

### Done when
- [ ] ai/out/awnings.json in contract shape with 3 entries keyed to fixture edge IDs.
- [ ] Passes data/validate.py ai/out/awnings.json.
- [ ] After 11:00, re-keyed to 3 real edges near the venue.

### Prompt to start with
```text
Create ai/out/awnings.json per contracts/data-formats.md with 3 entries keyed to edge IDs from contracts/fixtures/graph.json (kind awning, covered_fraction 0.8, confidence 0.9, verified true, image_ids []). Check it with data/validate.py ai/out/awnings.json and ship.
```

Roadmap: docs/ROADMAP.md, task A1.
ISSUE_BODY

issue '[W1] Map + fixture load + Dijkstra (shortest and shady)' web <<'ISSUE_BODY'
**Suggested time:** 9:45–10:20 Brisbane time · **Area:** Web (Eric) · **Depends on:** D1, W0
**Stub first:** make the output match the fixtures exactly, then ship.

### Done when
- [ ] Vite + TypeScript + MapLibre app loads graph.json and shade.json from web/public/data/ via import.meta.env.BASE_URL.
- [ ] Dijkstra with a binary heap in web/src/routing/, costed as in CLAUDE.md.
- [ ] Shortest (α = 0) and shady (α = 5) routes drawn in two colours with a legend.
- [ ] npm run build passes.

### Prompt to start with
```text
Scaffold a Vite + TypeScript app in web/ with MapLibre GL and the OpenFreeMap positron style. Load graph.json and shade.json from web/public/data/ using import.meta.env.BASE_URL. In web/src/routing/ implement Dijkstra with a binary heap over the undirected graph, edge cost = length_m × (1 + α × sunFraction[slot]), plus a summary helper returning distance and sun-minutes (Σ length_m × sunFraction / 1.3 / 60). Draw the shortest (α = 0) and shady (α = 5) routes between two fixture nodes in different colours with a legend. Run npm run build.
```

### Notes
Starts on the fixtures Data pushes at about 9:50, before validate.py is finished.

Roadmap: docs/ROADMAP.md, task W1.
ISSUE_BODY

issue '[D2] OSM walk graph → graph.json (edge IDs freeze once shipped)' data <<'ISSUE_BODY'
**Suggested time:** 10:15–11:00 Brisbane time · **Area:** Data · **Depends on:** D1

### Done when
- [ ] Walkable edges for the bbox, undirected, largest connected component only, split to 30 m or less.
- [ ] Node and edge IDs are deterministic: rerunning gives identical IDs.
- [ ] Raw OSM download cached in data/cache/; validate.py passes.
- [ ] Pushed and announced out loud: graph frozen (G2).

### Prompt to start with
```text
With osmnx (version 2.x takes the bbox as (west, south, east, north)), download the walk network for the bbox in CLAUDE.md and cache it in data/cache/. Make it undirected, keep the largest connected component, project to EPSG:7856 and split every edge into pieces of at most 30 m. Give nodes and edges deterministic IDs built from rounded coordinates (a short hash), never from iteration order. Write web/public/data/graph.json exactly per contracts/data-formats.md with geometry back in [lon, lat]. Run it twice and confirm the IDs are identical, run validate.py, then print node count, edge count and total length.
```

### If it slips
If it slips: ship the graph without the 30 m split (IDs still deterministic) and freeze it.

Roadmap: docs/ROADMAP.md, task D2.
ISSUE_BODY

issue '[D3] Shadow engine on fixtures (second worktree)' data <<'ISSUE_BODY'
**Suggested time:** 10:15–11:30 Brisbane time · **Area:** Data · **Depends on:** D1
**Claude Code model:** Opus

### Done when
- [ ] sun[] for all 51 slots matches the sanity values in CLAUDE.md (16:30: alt ≈ 22.7°, az ≈ 258.5°).
- [ ] Per slot: building shadows (footprint swept by height / tan(alt) away from the sun) plus tree discs offset by tree_h / tan(alt), unioned and clipped to the bbox + 200 m.
- [ ] sunFraction per edge per slot = 1 − shaded length / edge length, written as shade.json.
- [ ] data/cache/check_1630.png shows shadows falling ENE at 16:30.
- [ ] Runs end to end on the fixtures in under a minute.

### Prompt to start with
```text
In a second worktree (claude -w shadows, or git worktree add), write data/shadows.py against the fixtures in web/public/data/. For each of the 51 slots on 2026-11-21 (Australia/Brisbane), compute sun altitude and azimuth with pysolar and assert that 16:30 gives alt ≈ 22.7° and az ≈ 258.5° measured clockwise from north. In EPSG:7856, build each building's shadow by sweeping its footprint along a vector of length height / tan(alt) pointing to az + 180° (union of the footprint, its translated copy and the quads swept by each edge). Add tree canopy discs offset by tree_h / tan(alt), union per slot and clip to the bbox + 200 m. Then sunFraction per edge = 1 − (edge ∩ shadow length) / edge length, and 0 when alt ≤ 0. Write shade.json per the contract, save a PNG of the 16:30 shadows over the buildings to data/cache/check_1630.png, and run validate.py.
```

### If it slips
If it slips: compute hourly slots only and copy each into its four 15-minute slots (the contract is unchanged).

### Notes
Use Opus for this one. An STRtree plus prepared geometries keeps 51 slots × a few thousand edges to seconds.

Roadmap: docs/ROADMAP.md, task D3.
ISSUE_BODY

issue '[A2] Fetch Mapillary images for the bbox' ai <<'ISSUE_BODY'
**Suggested time:** 10:15–11:00 Brisbane time · **Area:** AI + Pitch · **Depends on:** A0

### Done when
- [ ] Fetched by bbox, not per edge, so this never waits on graph.json.
- [ ] ai/cache/images/<id>.jpg at 1024 px plus ai/cache/images.jsonl (id, lon, lat, compass_angle, captured_at, is_pano, sequence).
- [ ] Panoramas skipped, pre-2018 captures dropped, thinned to about 1 image per 10 m per sequence, capped at 1,500.
- [ ] Resumable; prints totals by year.

### Prompt to start with
```text
Write ai/fetch_images.py: call the Mapillary Graph API v4 images endpoint for the bbox in CLAUDE.md (MAPILLARY_TOKEN from .env) with fields id, computed_geometry, compass_angle, captured_at, is_pano, sequence, thumb_1024_url. If a request comes back at the page limit, split the bbox into tiles. Skip panoramas and captures before 2018, thin each sequence to about one image per 10 m, and cap at 1,500, newest first. Download thumb_1024_url straight away (the URLs expire) to ai/cache/images/<id>.jpg and append metadata to ai/cache/images.jsonl. Skip anything already cached. Print totals by year.
```

### If it slips
If it slips: under about 200 usable images, hand-label the main streets near the venue now, and still run the pipeline on what exists for the stats.

Roadmap: docs/ROADMAP.md, task A2.
ISSUE_BODY

issue '[W2] Deploy check + QR page → demo-ok-0' web <<'ISSUE_BODY'
**Suggested time:** 10:20–10:30 Brisbane time · **Area:** Web (Eric) · **Depends on:** W1

### Done when
- [ ] The production URL serves the app from main with no console errors.
- [ ] web/public/qr.png and web/public/qr.html (big QR with the URL underneath).
- [ ] Opened on a phone; tag demo-ok-0 (G1).

### Prompt to start with
```text
Push and confirm the Vercel production URL serves the app (data files load, no console errors). Generate web/public/qr.png for that URL with npx qrcode, add web/public/qr.html that shows it full-screen with the URL underneath, ship, and check both on the production URL.
```

### If it slips
If it slips: make this the priority; everything else demos through it.

Roadmap: docs/ROADMAP.md, task W2.
ISSUE_BODY

issue '[W3] Destination picker (origin fixed at the venue)' web <<'ISSUE_BODY'
**Suggested time:** 10:30–11:15 Brisbane time · **Area:** Web (Eric) · **Depends on:** W2

### Done when
- [ ] The origin is fixed at the venue entrance node (Q2).
- [ ] Tapping the map makes the nearest graph node the destination; routes recompute in under 100 ms.
- [ ] 5 preset chips, placeholders until P1 delivers the real ones at 13:00.

### Prompt to start with
```text
Add a destination picker. The origin is fixed at the venue (a constant in web/src/ui/presets.ts, snapped to the nearest graph node). Tapping the map snaps to the nearest node and sets the destination. Add 5 preset destination chips from the same file (placeholders for now). Recompute both routes on every change and log the routing time; keep it under 100 ms.
```

Roadmap: docs/ROADMAP.md, task W3.
ISSUE_BODY

issue '[D4] Buildings → buildings.geojson with the height fallback' data <<'ISSUE_BODY'
**Suggested time:** 11:00–11:20 Brisbane time · **Area:** Data · **Depends on:** D1

### Done when
- [ ] OSM footprints for the bbox plus 100 m, because buildings just outside still cast shade in.
- [ ] height_m from OSM height, else building:levels × 3.2, else 6; height_source set.
- [ ] Counts by height_source printed. That's the honest answer if a judge asks about heights.

### Prompt to start with
```text
Fetch OSM building footprints for the bbox plus a 100 m buffer with osmnx and cache them in data/cache/. Set height_m from the height tag (parse values like '12 m'), else building:levels × 3.2, else 6, and set height_source to osm, levels or default. Write web/public/data/buildings.geojson per the contract in [lon, lat]. Print counts by height_source and run validate.py.
```

### If it slips
If the AURIN / Geoscape login worked tonight, swap in better heights whenever there's time.

Roadmap: docs/ROADMAP.md, task D4.
ISSUE_BODY

issue '[A3] Vision pass with Haiku: left and right footpath' ai <<'ISSUE_BODY'
**Suggested time:** 11:00–12:00 Brisbane time · **Area:** AI + Pitch · **Depends on:** A2

### Done when
- [ ] Prompt calibrated on 20 images you labelled by eye (at least 16 of 20 agree) before the full run.
- [ ] Every cached image has a line in ai/cache/detections.jsonl with left and right footpath results.
- [ ] The full run goes in the background or a second worktree while you start A4.

### Prompt to start with
```text
Write ai/detect.py. For each image in ai/cache/images.jsonl without a line in ai/cache/detections.jsonl, send the image to claude-haiku-5-5 and ask whether the footpath on the LEFT and on the RIGHT of the camera is covered overhead (awning, verandah, shade sail, covered walkway; trees don't count). Force JSON with a tool schema: {left: {covered, kind, confidence}, right: {covered, kind, confidence}, reason}. Run 8 requests at a time with exponential backoff on 429 and 529, append each result as it lands, and print progress and the positive rate. First run only the 20 images in ai/calibration.json and show agreement with my labels.
```

### Notes
Make ai/calibration.json first: 20 image IDs with your own left and right labels. It takes 5 minutes and saves the run.

Roadmap: docs/ROADMAP.md, task A3.
ISSUE_BODY

issue '[W4] Results card: shortest vs shadiest, sun minutes' web <<'ISSUE_BODY'
**Suggested time:** 11:15–12:00 Brisbane time · **Area:** Web (Eric) · **Depends on:** W3

### Done when
- [ ] For each route: distance, walking time at 1.3 m/s, sun minutes; for shadiest also extra minutes and % less sun.
- [ ] A one-thumb bottom sheet on phones, colours matching the route lines.

### Prompt to start with
```text
Add a results card as a bottom sheet on phones: for shortest and shadiest show distance, walking time at 1.3 m/s and sun minutes, and for shadiest the extra minutes and % less sun than shortest. Colour-match the route lines. Run npm run build and check it at 390 px wide.
```

Roadmap: docs/ROADMAP.md, task W4.
ISSUE_BODY

issue '[D5] Real shade.json from real graph + buildings' data <<'ISSUE_BODY'
**Suggested time:** 11:30–12:00 Brisbane time · **Area:** Data · **Depends on:** D2, D3, D4
**Claude Code model:** Opus

### Done when
- [ ] The shadow engine runs on the real graph and buildings, and shade.json passes validate.py.
- [ ] The sunFraction histograms at 09:00, 12:00 and 16:30 look plausible: not everything 0 or everything 1.
- [ ] Pushed and deployed (G3); tag demo-ok-1 after the pitch owner's check.

### Prompt to start with
```text
Merge the shadows worktree into this branch, point data/shadows.py at the real graph.json and buildings.geojson, and run it. Print a histogram of sunFraction at 09:00, 12:00 and 16:30 and the share of edges in full shade. If everything is 0 or everything is 1, stop: that's an azimuth or CRS bug. Regenerate check_1630.png, run validate.py and ship.
```

### If it slips
Hourly slots copied into the 15-minute slots.

Roadmap: docs/ROADMAP.md, task D5.
ISSUE_BODY

issue '[D6] Trees → trees.geojson, tree shade included' data <<'ISSUE_BODY'
**Suggested time:** 12:00–12:30 Brisbane time · **Area:** Data · **Depends on:** D5

### Done when
- [ ] Street and park trees in the bbox as points with canopy_radius_m and height_m (defaults 4 m and 8 m).
- [ ] Tree shadows are in shade.json and the rebuild is deployed.
- [ ] The 12:00 histogram before and after shows how much shade trees add.

### Prompt to start with
```text
Load the tree source chosen tonight (the BCC 'Protected Vegetation, Council Vegetation' export if it has individual tree points, otherwise OSM natural=tree nodes plus tree_row lines sampled every 8 m), clip it to the bbox and write web/public/data/trees.geojson per the contract, with canopy_radius_m and height_m from crown width / 2 and height fields if present, else 4 m and 8 m. Rerun the shadow build so tree shade is included, compare the 12:00 histogram before and after, run validate.py and ship.
```

### If it slips
No usable tree source: hand-place trees along the 3 demo routes from Mapillary photos.

### Notes
At noon, trees are most of the shade that exists, so this is what makes 12:00 interesting.

Roadmap: docs/ROADMAP.md, task D6.
ISSUE_BODY

issue '[W5] Time slider + shade-hunger slider on real data' web <<'ISSUE_BODY'
**Suggested time:** 12:00–12:45 Brisbane time · **Area:** Web (Eric) · **Depends on:** W4, D5

### Done when
- [ ] The time slider snaps to the 51 slots and defaults to the current Brisbane time, clamped to 06:00 to 18:30.
- [ ] α shade-hunger slider from 0 to 10, default 5.
- [ ] Any change recomputes routes and the card instantly; the label reads like '4:30 pm · sun 23° up'.
- [ ] Works on the real shade.json.

### Prompt to start with
```text
Add a time slider that snaps to the 51 slots in shade.json and defaults to the current Brisbane time (UTC+10, clamped to 06:00 to 18:30), and a shade-hunger slider for α from 0 to 10 (default 5). Any change recomputes both routes and the card immediately. Show the slot as '4:30 pm · sun 23° up' using sun[slot].alt_deg. Test with the real data now on main.
```

Roadmap: docs/ROADMAP.md, task W5.
ISSUE_BODY

issue '[A4] Verifier pass with Sonnet on every positive' ai <<'ISSUE_BODY'
**Suggested time:** 12:15–12:45 Brisbane time · **Area:** AI + Pitch · **Depends on:** A3

### Done when
- [ ] Every positive side re-checked in a fresh request that sees only the image and the claim.
- [ ] Verified only when both passes agree it's covered; the reject rate is printed.
- [ ] ai/cache/verified.jsonl written and resumable.

### Prompt to start with
```text
Write ai/verify.py. For every side marked covered in detections.jsonl, ask claude-sonnet-5-5 in a fresh request (show only the image and the claim, such as 'left footpath covered by an awning', never the first pass's reasoning) to judge independently whether that side is covered and by what. Mark it verified only when both agree it's covered. Use the same tool-schema JSON, concurrency, backoff and resume as detect.py. Write ai/cache/verified.jsonl and print positives, verified and % rejected.
```

### Notes
Write it and launch the full run by about 12:30; it keeps running in the background while you do P1.

Roadmap: docs/ROADMAP.md, task A4.
ISSUE_BODY

issue '[D7] Shadow overlay files + one-command build.py' data <<'ISSUE_BODY'
**Suggested time:** 12:30–13:15 Brisbane time · **Area:** Data · **Depends on:** D5

### Done when
- [ ] If Q1 is yes: web/public/data/shadows/HHMM.geojson for each daytime slot (union per slot, simplified to 0.5 m, 6-decimal coordinates).
- [ ] data/build.py runs the whole pipeline from cache in one command and merges ai/out/awnings.json when present.
- [ ] Total size of web/public/data printed; keep it under about 5 MB for phones.

### Prompt to start with
```text
Have data/shadows.py also write each daytime slot's shadow union to web/public/data/shadows/HHMM.geojson, simplified with a 0.5 m tolerance in EPSG:7856 and coordinates rounded to 6 decimals. Then make data/build.py run graph, buildings, trees, shadows, shade and the awnings merge from cache in one command, print each file's size and the total, and run validate.py at the end.
```

Roadmap: docs/ROADMAP.md, task D7.
ISSUE_BODY

issue '[P1] Find the demo routes → docs/demo-routes.md' pitch <<'ISSUE_BODY'
**Suggested time:** 12:30–13:00 Brisbane time · **Area:** AI + Pitch · **Depends on:** D5, W1, IC1

### Done when
- [ ] docs/demo-routes.md: 3 pairs from the venue where shady ≠ shortest at 09:00, 12:00 and 16:30, with extra minutes and sun-minutes saved.
- [ ] 5 preset destinations (name + lon/lat) for Eric's presets.ts.
- [ ] Uses the real router from web/src/routing/; no second router.

### Prompt to start with
```text
Write docs/find-demo-routes.ts that imports the router from web/src/routing/ (don't reimplement it), loads web/public/data/graph.json and shade.json, and from the venue node tries every node 150 to 500 m away at slots 09:00, 12:00 and 16:30 with α = 5. Keep pairs where the shady route adds under 25% distance, rank them by sun-minutes saved, and write the top 3 pairs plus 5 named preset destinations (nearest landmark or street corner, with lon/lat) to docs/demo-routes.md. Run it with npx tsx.
```

### Notes
The verifier (A4) keeps running in the background while you do this. Candidates if inside the box: Brunswick St Mall, Chinatown Mall, Fortitude Valley station, McWhirters.

Roadmap: docs/ROADMAP.md, task P1.
ISSUE_BODY

issue '[W6] 2D shadow overlay for the current slot' web <<'ISSUE_BODY'
**Suggested time:** 12:45–13:30 Brisbane time · **Area:** Web (Eric) · **Depends on:** W5, D7

### Done when
- [ ] Q1 yes: the slot's shadows/HHMM.geojson drawn as a translucent fill under the routes, with neighbouring slots prefetched so dragging is smooth.
- [ ] Q1 no, or a file missing: street edges coloured by sunFraction for the current slot.

### Prompt to start with
```text
Draw the current slot's shadows: fetch web/public/data/shadows/HHMM.geojson into one MapLibre fill layer under the route lines at about 35% opacity, prefetch the neighbouring slots, and swap the source data when the time slider moves. If a file is missing, fall back to colouring street edges by sunFraction (sun warm, shade cool).
```

### Notes
Build it against the fixture shadows; the real files land with D7 at about 13:15.

Roadmap: docs/ROADMAP.md, task W6.
ISSUE_BODY

issue '[A5] Aggregate per edge → ai/out/awnings.json' ai <<'ISSUE_BODY'
**Suggested time:** 13:00–13:30 Brisbane time · **Area:** AI + Pitch · **Depends on:** A4, D2

### Done when
- [ ] Each image side becomes an observation snapped to the nearest edge within 15 m.
- [ ] covered_fraction = verified covered observations / all observations on that edge.
- [ ] ai/out/awnings.json validates; edges covered and covered metres printed; shipped.

### Prompt to start with
```text
Write ai/aggregate.py. Load web/public/data/graph.json (frozen) plus the detections and verified results. In EPSG:7856, turn each image side into an observation point 6 m left or right of the camera, perpendicular to its compass_angle, and snap it to the nearest edge within 15 m (drop it otherwise). Per edge: covered_fraction = verified covered observations / all observations, confidence = mean confidence, kind = most common kind, image_ids = the positive images, verified = true; skip edges with no verified cover. Write ai/out/awnings.json per the contract, check it with data/validate.py, and print edges covered and total covered metres.
```

### Notes
If the graph only has street centrelines (no separate sidewalks), both sides snap to the same edge. Use the better side per image, since a walker can cross to the shady side.

Roadmap: docs/ROADMAP.md, task A5.
ISSUE_BODY

issue '[D8] Merge verified awnings into shade.json' data <<'ISSUE_BODY'
**Suggested time:** 13:30–14:00 Brisbane time · **Area:** Data · **Depends on:** A5, D7

### Done when
- [ ] Only verified: true entries merged, with sunFraction *= (1 − covered_fraction).
- [ ] Printed: edges changed, and sun-minutes on each demo pair before vs after.
- [ ] Final shade.json deployed (G5).

### Prompt to start with
```text
Pull main to get ai/out/awnings.json and check it with validate.py. In build.py apply only verified: true entries: for every slot, sunFraction *= (1 − covered_fraction). Print how many edges changed and, for the pairs in docs/demo-routes.md, the shady route's sun-minutes before and after. Rebuild, validate and ship.
```

Roadmap: docs/ROADMAP.md, task D8.
ISSUE_BODY

issue '[W7] Mobile polish on iPhone Safari + real presets' web <<'ISSUE_BODY'
**Suggested time:** 13:30–14:00 Brisbane time · **Area:** Web (Eric) · **Depends on:** W6, P1

### Done when
- [ ] The 5 presets from docs/demo-routes.md are in web/src/ui/presets.ts.
- [ ] Tested on an iPhone in Safari: safe areas, tap targets of 44 px or more, no sideways scroll, sliders easy with one thumb.
- [ ] First load under about 2 s on 4G, with a loading state while data fetches.

### Prompt to start with
```text
Copy the 5 presets from docs/demo-routes.md into web/src/ui/presets.ts. Then polish for iPhone Safari: respect safe-area insets, make every tap target at least 44 px, remove any sideways scroll, and make both sliders easy to use with one thumb. Add a loading state while data fetches, then check bundle and data sizes and lazy-load anything not needed for the first route.
```

Roadmap: docs/ROADMAP.md, task W7.
ISSUE_BODY

issue '[A6] Precision check + stats for the slide' ai <<'ISSUE_BODY'
**Suggested time:** 13:45–14:15 Brisbane time · **Area:** AI + Pitch · **Depends on:** A5

### Done when
- [ ] 30 random verified positives and 10 rejections hand-checked in 5 minutes; precision recorded.
- [ ] ai/out/stats.json: images checked, first-pass positives, verified, % rejected by the verifier, edges covered, covered metres, precision.
- [ ] The 3 clearest examples (one per kind) in ai/out/examples/ for slide 2.

### Prompt to start with
```text
Write ai/stats.py to compute images checked, first-pass positives, verified, % rejected by the verifier, edges covered and covered metres. Build ai/out/review.html as a static grid of 30 random verified positives and 10 random rejections with their claims so I can count mistakes in 5 minutes, then let me record precision with uv run python stats.py --precision <correct>/30, saved into ai/out/stats.json. Copy the 3 clearest examples, one per kind, to ai/out/examples/.
```

### If it slips
If it slips: if precision is under 80% or awnings change no demo route, switch to A7.

Roadmap: docs/ROADMAP.md, task A6.
ISSUE_BODY

issue '[D9] Data QA + limits note for the pitch' data <<'ISSUE_BODY'
**Suggested time:** 14:00–14:30 Brisbane time · **Area:** Data · **Depends on:** D8, P1

### Done when
- [ ] validate.py is clean on the deployed files.
- [ ] With the pitch owner: each demo pair at 09:00, 12:00 and 16:30 still shows a different shady route.
- [ ] A 10-line limits note posted on the pitch issue: height sources, tree source, awning coverage, approximations.

### Prompt to start with
```text
Run validate.py against web/public/data/. Then summarise for the pitch in under 10 lines: buildings by height_source, tree count and source, awning edges and covered metres, and anything approximated. Post it as a comment on the P2 issue.
```

Roadmap: docs/ROADMAP.md, task D9.
ISSUE_BODY

issue '[W8] 3D shade view (stretch, laptop-only)' 3d <<'ISSUE_BODY'
**Suggested time:** 14:00–14:30 Brisbane time · **Area:** Web (Eric) · **Depends on:** W7

### Done when
- [ ] A 2D/3D toggle lazy-loads web/src/three/ with import(); three.js isn't in the first load.
- [ ] Extruded buildings, trees and a sun DirectionalLight with shadow maps that follow the time slider; both routes drawn.
- [ ] Laptop-only behind the toggle; hidden on touch devices.

### Prompt to start with
```text
In web/src/three/index.ts implement createShadeView(el, data) with three.js and load it with a dynamic import() from a 2D/3D toggle hidden on touch devices. Convert [lon, lat] to local metres around the bbox centre (east = +X, north = −Z, up = +Y), extrude buildings to height_m, render trees as an InstancedMesh trunk plus canopy, and add a DirectionalLight in the direction (sin az·cos alt, sin alt, −cos az·cos alt) with an orthographic shadow camera covering ±400 m at 2048 px. setSlot follows the time slider and showRoutes draws both routes 0.5 m above the ground in the 2D legend colours. Check that 16:30 shadows point ENE.
```

### Notes
If it isn't working when the team wants to wrap up, delete the toggle and ship without it.

Roadmap: docs/ROADMAP.md, task W8.
ISSUE_BODY

issue '[P2] 2 slides, demo script, Q&A crib' pitch <<'ISSUE_BODY'
**Suggested time:** 14:15–15:00 Brisbane time · **Area:** AI + Pitch · **Depends on:** P1, A6

### Done when
- [ ] Slide 1 hook: a 34° day, the shortest walk is the worst walk, and the noon sun is 82° up.
- [ ] Slide 2: data → shadows → vision + verifier → routing, the vision stats, and a big QR code.
- [ ] A 90-second demo script built around the 3 demo pairs, plus the Q&A crib with today's real numbers.

### Prompt to start with
```text
Draft docs/pitch.md: slide 1 (hook: 'It's 34° in Brisbane. The shortest walk is the worst walk.' plus the 82° noon-sun fact), slide 2 (the pipeline in words, the numbers from ai/out/stats.json, a QR to the production URL), and a 90-second demo script that walks the 3 pairs in docs/demo-routes.md and ends at 16:30. Add the judge Q&A crib from docs/ROADMAP.md with today's real numbers filled in.
```

Roadmap: docs/ROADMAP.md, task P2.
ISSUE_BODY

issue '[P3] Final numbers, QR test, recording setup' pitch <<'ISSUE_BODY'
**Suggested time:** 15:00–15:30 Brisbane time · **Area:** AI + Pitch · **Depends on:** P2, D9

### Done when
- [ ] Every number on the slides matches the deployed data (stats.json and the D9 limits note).
- [ ] The QR on the slide tested from two phones.
- [ ] Screen recording works on the demo phone; phones and laptop charged.

### Prompt to start with
```text
Check every number in docs/pitch.md against ai/out/stats.json and the D9 limits comment, and list any mismatch with the correct value.
```

Roadmap: docs/ROADMAP.md, task P3.
ISSUE_BODY

issue '[VID] Backup video + demo-ok-final tag' demo <<'ISSUE_BODY'
**Suggested time:** 15:30–15:45 Brisbane time · **Area:** Team · **Depends on:** P3

### Done when
- [ ] Screen recording on a phone of the full demo path on the deployed site: 3 pairs, ending at 16:30.
- [ ] A short clip of the 3D view from the laptop.
- [ ] git tag demo-ok-final && git push origin demo-ok-final (G7).

Roadmap: docs/ROADMAP.md, task VID.
ISSUE_BODY

echo "Created 27 issues. Claim yours with /start-task, or: gh issue edit <n> --add-assignee @me"
