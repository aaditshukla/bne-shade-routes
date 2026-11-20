# Shade Router: hackathon roadmap

**Tanda HackAIthon · Sat 21 Nov 2026 · all times are Brisbane time (AEST, UTC+10)**

Interactive version with a live "now" line, lane filter and copyable prompts: https://claude.ai/artifact/A9iseKnxnggtwKxVMdoYXP

This is the plan for the day. CLAUDE.md explains how we work; this says who does what, when, and what counts as done. The GitHub issues are created from it by `docs/seed-issues.sh`. If the plan changes, update this file and say it out loud.

**All times here are guidelines to keep us on pace, not rules.** Anyone can start, finish or reorder a task whenever it makes sense, and nothing gets skipped or left unfinished just because of the clock. The only fixed time is the organisers' submission deadline.

> **Demo path.** A judge scans the QR code, picks a destination near the venue, and sees the shortest vs shadiest route with minutes in the sun for each. Dragging the time slider moves the shadows and the route changes.

**Assumptions to confirm at 9:00:** 3 people: Data, AI + Pitch, and Web (Eric). The 3D view is a stretch goal, best started once the full UI works on real data. 9:00 start, link posted by 16:15, submission at 16:30. Confirm both times with the organisers. The demo area is about 600 × 600 m centred on the venue.

**Critical path (rough target times):** Fixtures on main (9:50) → Fixture app deployed + QR (10:30) → Real graph, IDs frozen (11:00) → Real shade.json (12:00) → Demo routes found (13:00) → Full UI on real data (13:30) → Wind-down (14:30) → Link posted (16:15)

The AI lane (A2 to A6, merged by D8 at 14:00) is the differentiator, but the demo works without it.

## The day at a glance

| When | Phase | Goal | Gates |
|---|---|---|---|
| 9:00–9:45 | **Plan** | Lock the demo path, bbox, owners, contracts, fixtures and CLAUDE.md. Create the board. | G0 09:45 Plan locked |
| 9:45–10:30 | **Skeleton** | Every area's stub is on main and the fixture app is deployed with a QR code. | G1 10:30 Fixtures deployed |
| 10:30–14:30 | **Build** | Aim for real graph and shade around 12:00, full UI around 13:30, awnings around 14:00. Ship after every task. | G2 11:00 Graph frozen<br>G3 12:00 Real shade live<br>G4 13:30 Full UI on real data<br>G5 14:00 Awnings in<br>G6 14:30 Wind-down |
| 14:30–15:30 | **Integrate** | Mostly replace leftover fixtures and fix demo-path bugs; new features are fine if the demo path is solid. | G7 15:30 Release candidate |
| 15:30–16:30 | **Demo** | Backup video, two rehearsals on a phone, link posted by 16:15. | G8 16:15 Link posted |

## Tonight (Fri 20 Nov)

**Everyone**

- [ ] Claude Code logged in with the hackathon credits (/login, then /usage shows the right account).
- [ ] gh auth login done; gh api user -q .login prints your username. Send it to Musa for CLAUDE.md.
- [ ] Git name and email set; you can push to the team repo.
- [ ] Node 20+, Python 3.11+ and uv installed, same versions as the team.
- [ ] Read CLAUDE.md and this roadmap (10 minutes).

**Data**

- [ ] Create the team repo and add everyone (account setup, no project code).
- [ ] Confirm the venue address and work out the bbox: venue ± 0.00303° lon, ± 0.00271° lat.
- [ ] Check whether the BCC 'Protected Vegetation, Council Vegetation' dataset has individual tree points with height or crown fields. If it's areas, plan on OSM trees.
- [ ] Optional: test whether your UQ login reaches Geoscape buildings on AURIN.

**AI + Pitch**

- [ ] Create a Mapillary app and put the client token in your local .env.
- [ ] On mapillary.com, look at coverage in the demo box: rough image count and newest capture year.
- [ ] Confirm the hackathon Anthropic API key works with one tiny call.
- [ ] Charge the demo phone; check that its screen recording works.

**Eric (Web)**

- [ ] Confirm the start time, submission time and pre-event work rule with the organisers.
- [ ] Vercel account ready (it can import a GitHub repo).
- [ ] An iPhone available for Safari testing, if anyone on the team has one.
- [x] CLAUDE.md, docs/, .claude/ (settings + /start-task + /ship), .gitignore and .env.example pushed to main Friday night.

## Plan hour, minute by minute

| Time | Mins | What |
|---|---|---|
| 9:00 | 5 | Confirm the assumptions: team size and roles, submission time, venue → bbox. Fill in the top of CLAUDE.md. |
| 9:05 | 5 | Read the demo-path sentence aloud. Agree what's out: UV budget, extra suburbs, GPS. |
| 9:10 | 5 | Settle Q1 to Q7. Take the recommended default unless someone objects with a reason. |
| 9:15 | 15 | Contracts and fixtures. Data drives one shared Claude session; each owner reviews their seam (Eric: graph, shade, buildings, trees; AI: awnings). |
| 9:30 | 5 | Commit contracts/, fixtures and the bbox + usernames in CLAUDE.md to main (.claude/, .gitignore and .env.example are already there). |
| 9:35 | 5 | Eric runs bash docs/seed-issues.sh. Everyone pastes their block from "Area guardrails" into .claude/settings.local.json. |
| 9:40 | 5 | Everyone clones, runs /clear, then /start-task on their stub issue. Eric links Vercel. |

## Decisions to lock at 9:10

Take the recommended default unless someone objects with a reason. Write the answers into `contracts/`.

**Q1. What does the 2D map draw as moving shadows?**  
Recommended: Data also writes web/public/data/shadows/HHMM.geojson: one FeatureCollection per daytime slot, unioned, simplified to 0.5 m, roughly 20 to 80 KB each.  
Why: The demo path promises shadows that move with the slider, but no other contract file carries shadow shapes. Fallback: Web colours street edges by sunFraction. *Affects: Data, Web (Eric).*

**Q2. Where do routes start?**  
Recommended: Fixed at the venue entrance. GPS is a stretch goal.  
Why: The judge is standing at the venue, and indoor GPS is unreliable and may fall outside the bbox. *Affects: Web (Eric), AI + Pitch.*

**Q3. When do edge IDs stop changing?**  
Recommended: Deterministic IDs from rounded coordinates, frozen once the real graph lands.  
Why: awnings.json is keyed by edge ID, so any later rebuild that renames edges silently drops every awning. *Affects: Data, AI + Pitch.*

**Q4. How does AI avoid waiting on the graph?**  
Recommended: Fetch and classify images by bbox from 10:15; snap them to edges only in the aggregate step, after the freeze.  
Why: Fetch, vision and verifier don't need edges at all, so the AI lane runs in parallel from the start. *Affects: AI + Pitch.*

**Q5. How is the app hosted?**  
Recommended: Vercel Git integration with Root Directory web, so every push to main deploys. The QR points at the production URL.  
Why: "Main is always deployed" becomes automatic, and rollback is one click. *Affects: Web (Eric).*

**Q6. Which basemap?**  
Recommended: OpenFreeMap positron: free, no API key, and light enough that shadows read.  
Why: One less key to manage, and nothing to expire during judging. *Affects: Web (Eric).*

**Q7. Which models and how many images?**  
Recommended: claude-haiku-5-5 for the first pass, claude-sonnet-5-5 for the verifier, at most 1,500 images. One person watches /usage.  
Why: Keeps the vision run around 10 to 15 minutes and protects the shared credits. *Affects: AI + Pitch.*

## Lane schedules

### Team (everyone)

| Time | Task | Needs | Issue |
|---|---|---|---|
| 9:00–9:45 | **PLAN** Plan hour: all hands, one shared Claude session | – | no |
| 10:30–10:35 | **SU1** Stand-up | – | no |
| 12:00–12:15 | **IC1** Integration check 1 + stand-up | D5 | no |
| 13:30–13:45 | **IC2** Integration check 2 + stand-up | W6 | no |
| 15:00–15:05 | **SU4** Stand-up (bugs only) | – | no |
| 15:30–15:45 | **VID** Backup video + demo-ok-final tag | P3 | yes, label demo |
| 15:45–16:00 | **R1** Rehearsal 1: timed, on a phone, deployed site | VID | no |
| 16:00–16:15 | **R2** Rehearsal 2 | R1 | no |
| 16:15–16:30 | **POST** Post the link in #showcase | R2 | no |

### Data (Musa)
Files: `data/, contracts/, web/public/data/, CLAUDE.md`

| Time | Task | Needs | Issue |
|---|---|---|---|
| 9:00–9:45 | **D0** Contracts, fixtures and CLAUDE.md *(Opus)* | – | no |
| 9:45–10:15 | **D1** Fixtures in web/public/data/ + validate.py *(stub first)* | D0 | yes, label data |
| 10:15–11:00 | **D2** OSM walk graph → graph.json (edge IDs freeze once shipped) | D1 | yes, label data |
| 10:15–11:30 | **D3** Shadow engine on fixtures (second worktree) *(Opus)* | D1 | yes, label data |
| 11:00–11:20 | **D4** Buildings → buildings.geojson with the height fallback | D1 | yes, label data |
| 11:30–12:00 | **D5** Real shade.json from real graph + buildings *(Opus)* | D2, D3, D4 | yes, label data |
| 12:00–12:30 | **D6** Trees → trees.geojson, tree shade included | D5 | yes, label data |
| 12:30–13:15 | **D7** Shadow overlay files + one-command build.py | D5 | yes, label data |
| 13:30–14:00 | **D8** Merge verified awnings into shade.json | A5, D7 | yes, label data |
| 14:00–14:30 | **D9** Data QA + limits note for the pitch | D8, P1 | yes, label data |

### AI + Pitch (Aadit)
Files: `ai/, docs/`

| Time | Task | Needs | Issue |
|---|---|---|---|
| 9:00–9:45 | **A0** Mapillary + API key check, hook draft | – | no |
| 9:45–10:15 | **A1** awnings.json stub with 3 hand-labelled edges *(stub first)* | D0 | yes, label ai |
| 10:15–11:00 | **A2** Fetch Mapillary images for the bbox | A0 | yes, label ai |
| 11:00–12:00 | **A3** Vision pass with Haiku: left and right footpath | A2 | yes, label ai |
| 12:15–12:45 | **A4** Verifier pass with Sonnet on every positive | A3 | yes, label ai |
| 12:30–13:00 | **P1** Find the demo routes → docs/demo-routes.md | D5, W1, IC1 | yes, label pitch |
| 13:00–13:30 | **A5** Aggregate per edge → ai/out/awnings.json | A4, D2 | yes, label ai |
| 13:45–14:15 | **A6** Precision check + stats for the slide | A5 | yes, label ai |
| 14:15–14:45 | **A7** Fallback: hand-label awnings on the demo routes *(fallback only)* | P1, A6 | no |
| 14:15–15:00 | **P2** 2 slides, demo script, Q&A crib | P1, A6 | yes, label pitch |
| 15:00–15:30 | **P3** Final numbers, QR test, recording setup | P2, D9 | yes, label pitch |

### Web (Eric) (ericliswan)
Files: `web/ except web/public/data/ (includes web/src/three/)`

| Time | Task | Needs | Issue |
|---|---|---|---|
| 9:00–9:45 | **W0** Run the plan hour, link Vercel, create the board | – | no |
| 9:45–10:20 | **W1** Map + fixture load + Dijkstra (shortest and shady) *(stub first)* | D1, W0 | yes, label web |
| 10:20–10:30 | **W2** Deploy check + QR page → demo-ok-0 | W1 | yes, label web |
| 10:30–11:15 | **W3** Destination picker (origin fixed at the venue) | W2 | yes, label web |
| 11:15–12:00 | **W4** Results card: shortest vs shadiest, sun minutes | W3 | yes, label web |
| 12:00–12:45 | **W5** Time slider + shade-hunger slider on real data | W4, D5 | yes, label web |
| 12:45–13:30 | **W6** 2D shadow overlay for the current slot | W5, D7 | yes, label web |
| 13:30–14:00 | **W7** Mobile polish on iPhone Safari + real presets | W6, P1 | yes, label web |
| 14:00–14:30 | **W8** 3D shade view (stretch, laptop-only) *(stretch)* | W7 | yes, label 3d |

## Gates

Each gate has exit criteria; the times are targets, not deadlines. When it's met, tag the build if a tag is listed: `git tag <tag> && git push origin <tag>`.

| Gate | Time | Owner | Tag | Exit criteria |
|---|---|---|---|---|
| **G0** Plan locked | 09:45 | Musa + Eric | – | Demo-path sentence agreed; bbox and owners fixed.<br>Q1 to Q7 decided and written into contracts/.<br>contracts/, fixtures, CLAUDE.md, .claude/ and .env.example on main.<br>Board created with seed-issues.sh; everyone has .claude/settings.local.json. |
| **G1** Fixtures deployed | 10:30 | Eric | demo-ok-0 | Production URL and QR open on a phone.<br>Shortest and shady fixture routes drawn, and different. |
| **G2** Graph frozen | 11:00 | Musa | – | Real graph.json on main and validated.<br>Edge IDs never change after this. AI and Web told out loud. |
| **G3** Real shade live | 12:00 | Musa (Aadit checks) | demo-ok-1 | Real graph + geometric shade.json deployed.<br>Shady ≠ shortest on at least one pair from the venue. |
| **G4** Full UI on real data | 13:30 | Eric (Aadit checks) | demo-ok-2 | Picker, results card, both sliders and 2D shadows work on the deployed site from a phone.<br>Once this is met, the 3D stretch is a good next step. |
| **G5** Awnings in | 14:00 | Aadit + Musa | – | Verified awnings merged and visible on a demo route (the hand-labelled fallback comes at 14:15 if needed). |
| **G6** Wind-down | 14:30 | Everyone | – | Suggested point to favour demo-path bugs, fixture replacement and polish over new features. |
| **G7** Release candidate | 15:30 | Aadit | demo-ok-final | Tag demo-ok-final pushed; backup video recorded; slides final. |
| **G8** Link posted | 16:15 | Aadit | – | Link in #showcase, and the deployed build is demo-ok-final. |

## Tripwires

Fallbacks worked out in advance. The times are rough check-in points, not deadlines: if the "If" is true whenever someone notices, the "Then" is a good default.

| Check around | Owner | If | Then |
|---|---|---|---|
| 10:30 | Eric | The fixture app isn't deployed with a working QR code. | Eric makes this the priority. A late deploy is the most common way to lose the demo. |
| 10:45 | Aadit | The bbox has under about 200 usable Mapillary images. | Hand-label the main streets near the venue now, and still run the pipeline on what exists for the stats slide. |
| 11:15 | Musa | The real graph.json isn't on main. | Ship it without the 30 m split (IDs still deterministic) and freeze it. |
| 12:00 | Musa | Geometric shade.json isn't real yet. | Compute hourly slots only and copy each into its four 15-minute slots. Refine after G3. |
| 12:30 | Musa + Aadit | Shady = shortest on every pair. | Check the sunFraction histogram first: everything ≈ 0 or ≈ 1 means an azimuth or CRS bug. Then try 16:30 and α = 8. |
| 13:30 | Eric | G4 isn't met (full UI not working on real data from a phone). | Put the demo path ahead of the 3D stretch. |
| 14:15 | Aadit + Musa | Precision is under 80% on the 30-image check, or awnings change no demo route. | Run A7: hand-label the demo routes and pitch the pipeline and its stats as the scaling story. |
| 14:30 | Everyone | Something isn't finished. | Decide together whether to keep going or cut it so the demo path stays solid. |
| 15:30 | Eric | Production is broken. | Vercel → Deployments → promote the last good deployment (or redeploy the demo-ok-2 tag). |

- **Any time:** An agent fails twice on the same bug: /clear, write a precise prompt with the exact error, or grab a teammate.
- **Any time:** main breaks: whoever shipped last fixes it first.
- **Any time:** Someone wants to change a contract: say it out loud to the team first. Nobody's agent edits contracts/.

## Stand-ups and integration checks

At 10:30, 12:00, 13:30, 15:00. Five minutes, standing. Each person: shipped, next, blocked, contract changes. Then read the next gate and tripwire, and one person reads the credit total from /usage. At 12:00 and 13:30 Aadit runs the demo path on the deployed site from a phone and files bugs labelled bug + area.

## Task cards

### Data (Musa)

#### D0 · Contracts, fixtures and CLAUDE.md
`9:00–9:45` · feeds D1, A1 · Claude Code model: Opus

Done when:
- contracts/data-formats.md and contracts/frontend-interface.md written from CLAUDE.md, the task cards below and the 9:10 decisions.
- contracts/fixtures/ has tiny hand-made versions of every file, including shadows/ if Q1 is yes.
- CLAUDE.md has real GitHub usernames and the bbox.

Prompt:
```text
Write contracts/data-formats.md: for each seam file in the CLAUDE.md table (graph.json, shade.json, shadows/HHMM.geojson if Q1 is yes, buildings.geojson, trees.geojson, ai/out/awnings.json) give every key with its type, units and an example. Use CLAUDE.md's domain rules and the field names the task cards in docs/ROADMAP.md already use: length_m, deterministic edge ids, slots, sun[].alt_deg and az_deg, per-edge sunFraction arrays of 51, height_m and height_source, canopy_radius_m, and per-edge kind, covered_fraction, confidence, verified, image_ids. Write contracts/frontend-interface.md: the TypeScript signatures web/src/routing/ exports (route by α and slot, a summary returning distance and sun-minutes, nearest node) and web/src/three/'s createShadeView(el, data) with setSlot and showRoutes. Today's decisions: [paste Q1 to Q7]. Then hand-make tiny fixtures in contracts/fixtures/ that match them: a ladder-shaped graph (two parallel streets joined by three short rungs, about 8 nodes and 10 edges) near [venue lon, lat] where one street is sunny and the other shady at every slot, shade.json with all 51 slots (06:00 to 18:30), 3 buildings, 3 trees, and awnings.json with 2 edges. Check that every edge id in shade.json and awnings.json exists in graph.json.
```

Note: The ladder shape guarantees the shortest and shady routes differ, so Web sees a split from the first minute.

#### D1 · Fixtures in web/public/data/ + validate.py
`9:45–10:15` · needs D0 · feeds D2, D3, D4, W1 · stub first

Done when:
- Fixtures copied into web/public/data/ and pushed by about 9:50, before validate.py, so Web can deploy on them.
- data/validate.py checks every file against the contract and exits 1 on any failure.
- validate.py takes an optional path so AI can check ai/out/awnings.json.

Prompt:
```text
Copy every file in contracts/fixtures/ into web/public/data/ and push that first. Then write data/validate.py (standard library only) that checks each file there against contracts/data-formats.md: required keys and types; exactly 51 slots from 06:00 to 18:30; every shade.json edge has 51 values in [0, 1]; every edge id in shade.json and awnings.json exists in graph.json; all coordinates are [lon, lat] inside the bbox (buildings may reach 100 m outside it); height_m > 0. Accept an optional file path. Print one OK or FAIL line per file and exit 1 on failure. Run it.
```

#### D2 · OSM walk graph → graph.json (edge IDs freeze once shipped)
`10:15–11:00` · needs D1 · feeds D5, A5

Done when:
- Walkable edges for the bbox, undirected, largest connected component only, split to 30 m or less.
- Node and edge IDs are deterministic: rerunning gives identical IDs.
- Raw OSM download cached in data/cache/; validate.py passes.
- Pushed and announced out loud: graph frozen (G2).

Prompt:
```text
With osmnx (version 2.x takes the bbox as (west, south, east, north)), download the walk network for the bbox in CLAUDE.md and cache it in data/cache/. Make it undirected, keep the largest connected component, project to EPSG:7856 and split every edge into pieces of at most 30 m. Give nodes and edges deterministic IDs built from rounded coordinates (a short hash), never from iteration order. Write web/public/data/graph.json exactly per contracts/data-formats.md with geometry back in [lon, lat]. Run it twice and confirm the IDs are identical, run validate.py, then print node count, edge count and total length.
```

If it slips: ship the graph without the 30 m split (IDs still deterministic) and freeze it.

#### D3 · Shadow engine on fixtures (second worktree)
`10:15–11:30` · needs D1 · feeds D5 · Claude Code model: Opus

Done when:
- sun[] for all 51 slots matches the sanity values in CLAUDE.md (16:30: alt ≈ 22.7°, az ≈ 258.5°).
- Per slot: building shadows (footprint swept by height / tan(alt) away from the sun) plus tree discs offset by tree_h / tan(alt), unioned and clipped to the bbox + 200 m.
- sunFraction per edge per slot = 1 − shaded length / edge length, written as shade.json.
- data/cache/check_1630.png shows shadows falling ENE at 16:30.
- Runs end to end on the fixtures in under a minute.

Prompt:
```text
In a second worktree (claude -w shadows, or git worktree add), write data/shadows.py against the fixtures in web/public/data/. For each of the 51 slots on 2026-11-21 (Australia/Brisbane), compute sun altitude and azimuth with pysolar and assert that 16:30 gives alt ≈ 22.7° and az ≈ 258.5° measured clockwise from north. In EPSG:7856, build each building's shadow by sweeping its footprint along a vector of length height / tan(alt) pointing to az + 180° (union of the footprint, its translated copy and the quads swept by each edge). Add tree canopy discs offset by tree_h / tan(alt), union per slot and clip to the bbox + 200 m. Then sunFraction per edge = 1 − (edge ∩ shadow length) / edge length, and 0 when alt ≤ 0. Write shade.json per the contract, save a PNG of the 16:30 shadows over the buildings to data/cache/check_1630.png, and run validate.py.
```

If it slips: compute hourly slots only and copy each into its four 15-minute slots (the contract is unchanged).

Note: Use Opus for this one. An STRtree plus prepared geometries keeps 51 slots × a few thousand edges to seconds.

#### D4 · Buildings → buildings.geojson with the height fallback
`11:00–11:20` · needs D1 · feeds D5

Done when:
- OSM footprints for the bbox plus 100 m, because buildings just outside still cast shade in.
- height_m from OSM height, else building:levels × 3.2, else 6; height_source set.
- Counts by height_source printed. That's the honest answer if a judge asks about heights.

Prompt:
```text
Fetch OSM building footprints for the bbox plus a 100 m buffer with osmnx and cache them in data/cache/. Set height_m from the height tag (parse values like '12 m'), else building:levels × 3.2, else 6, and set height_source to osm, levels or default. Write web/public/data/buildings.geojson per the contract in [lon, lat]. Print counts by height_source and run validate.py.
```

If it slips: If the AURIN / Geoscape login worked tonight, swap in better heights whenever there's time.

#### D5 · Real shade.json from real graph + buildings
`11:30–12:00` · needs D2, D3, D4 · feeds IC1, D6, D7, W5, P1 · Claude Code model: Opus

Done when:
- The shadow engine runs on the real graph and buildings, and shade.json passes validate.py.
- The sunFraction histograms at 09:00, 12:00 and 16:30 look plausible: not everything 0 or everything 1.
- Pushed and deployed (G3); tag demo-ok-1 after Aadit's check.

Prompt:
```text
Merge the shadows worktree into this branch, point data/shadows.py at the real graph.json and buildings.geojson, and run it. Print a histogram of sunFraction at 09:00, 12:00 and 16:30 and the share of edges in full shade. If everything is 0 or everything is 1, stop: that's an azimuth or CRS bug. Regenerate check_1630.png, run validate.py and ship.
```

If it slips: Hourly slots copied into the 15-minute slots.

#### D6 · Trees → trees.geojson, tree shade included
`12:00–12:30` · needs D5

Done when:
- Street and park trees in the bbox as points with canopy_radius_m and height_m (defaults 4 m and 8 m).
- Tree shadows are in shade.json and the rebuild is deployed.
- The 12:00 histogram before and after shows how much shade trees add.

Prompt:
```text
Load the tree source chosen tonight (the BCC 'Protected Vegetation, Council Vegetation' export if it has individual tree points, otherwise OSM natural=tree nodes plus tree_row lines sampled every 8 m), clip it to the bbox and write web/public/data/trees.geojson per the contract, with canopy_radius_m and height_m from crown width / 2 and height fields if present, else 4 m and 8 m. Rerun the shadow build so tree shade is included, compare the 12:00 histogram before and after, run validate.py and ship.
```

If it slips: No usable tree source: hand-place trees along the 3 demo routes from Mapillary photos.

Note: At noon, trees are most of the shade that exists, so this is what makes 12:00 interesting.

#### D7 · Shadow overlay files + one-command build.py
`12:30–13:15` · needs D5 · feeds D8, W6

Done when:
- If Q1 is yes: web/public/data/shadows/HHMM.geojson for each daytime slot (union per slot, simplified to 0.5 m, 6-decimal coordinates).
- data/build.py runs the whole pipeline from cache in one command and merges ai/out/awnings.json when present.
- Total size of web/public/data printed; keep it under about 5 MB for phones.

Prompt:
```text
Have data/shadows.py also write each daytime slot's shadow union to web/public/data/shadows/HHMM.geojson, simplified with a 0.5 m tolerance in EPSG:7856 and coordinates rounded to 6 decimals. Then make data/build.py run graph, buildings, trees, shadows, shade and the awnings merge from cache in one command, print each file's size and the total, and run validate.py at the end.
```

#### D8 · Merge verified awnings into shade.json
`13:30–14:00` · needs A5, D7 · feeds D9

Done when:
- Only verified: true entries merged, with sunFraction *= (1 − covered_fraction).
- Printed: edges changed, and sun-minutes on each demo pair before vs after.
- Final shade.json deployed (G5).

Prompt:
```text
Pull main to get ai/out/awnings.json and check it with validate.py. In build.py apply only verified: true entries: for every slot, sunFraction *= (1 − covered_fraction). Print how many edges changed and, for the pairs in docs/demo-routes.md, the shady route's sun-minutes before and after. Rebuild, validate and ship.
```

#### D9 · Data QA + limits note for the pitch
`14:00–14:30` · needs D8, P1 · feeds P3

Done when:
- validate.py is clean on the deployed files.
- With Aadit: each demo pair at 09:00, 12:00 and 16:30 still shows a different shady route.
- A 10-line limits note posted on the pitch issue: height sources, tree source, awning coverage, approximations.

Prompt:
```text
Run validate.py against web/public/data/. Then summarise for the pitch in under 10 lines: buildings by height_source, tree count and source, awning edges and covered metres, and anything approximated. Post it as a comment on the P2 issue.
```

### AI + Pitch (Aadit)

#### A0 · Mapillary + API key check, hook draft
`9:00–9:45` · feeds A2

Done when:
- The Mapillary token and Anthropic key both work (one tiny call each) and live in .env, not the repo.
- Image count and newest capture year in the bbox noted for the 10:45 tripwire.
- awnings.json contract reviewed and the kind list agreed.
- Hook line for slide 1 drafted.

Prompt:
```text
Using MAPILLARY_TOKEN from .env, count images in the bbox from CLAUDE.md with the Mapillary Graph API v4 images endpoint (fields id, captured_at) and print counts by year. Then make one tiny claude-haiku-5-5 call to confirm the Anthropic key works. Don't print either key.
```

#### A1 · awnings.json stub with 3 hand-labelled edges
`9:45–10:15` · needs D0 · stub first

Done when:
- ai/out/awnings.json in contract shape with 3 entries keyed to fixture edge IDs.
- Passes data/validate.py ai/out/awnings.json.
- After 11:00, re-keyed to 3 real edges near the venue.

Prompt:
```text
Create ai/out/awnings.json per contracts/data-formats.md with 3 entries keyed to edge IDs from contracts/fixtures/graph.json (kind awning, covered_fraction 0.8, confidence 0.9, verified true, image_ids []). Check it with data/validate.py ai/out/awnings.json and ship.
```

#### A2 · Fetch Mapillary images for the bbox
`10:15–11:00` · needs A0 · feeds A3

Done when:
- Fetched by bbox, not per edge, so this never waits on graph.json.
- ai/cache/images/<id>.jpg at 1024 px plus ai/cache/images.jsonl (id, lon, lat, compass_angle, captured_at, is_pano, sequence).
- Panoramas skipped, pre-2018 captures dropped, thinned to about 1 image per 10 m per sequence, capped at 1,500.
- Resumable; prints totals by year.

Prompt:
```text
Write ai/fetch_images.py: call the Mapillary Graph API v4 images endpoint for the bbox in CLAUDE.md (MAPILLARY_TOKEN from .env) with fields id, computed_geometry, compass_angle, captured_at, is_pano, sequence, thumb_1024_url. If a request comes back at the page limit, split the bbox into tiles. Skip panoramas and captures before 2018, thin each sequence to about one image per 10 m, and cap at 1,500, newest first. Download thumb_1024_url straight away (the URLs expire) to ai/cache/images/<id>.jpg and append metadata to ai/cache/images.jsonl. Skip anything already cached. Print totals by year.
```

If it slips: under about 200 usable images, hand-label the main streets near the venue now, and still run the pipeline on what exists for the stats.

#### A3 · Vision pass with Haiku: left and right footpath
`11:00–12:00` · needs A2 · feeds A4

Done when:
- Prompt calibrated on 20 images you labelled by eye (at least 16 of 20 agree) before the full run.
- Every cached image has a line in ai/cache/detections.jsonl with left and right footpath results.
- The full run goes in the background or a second worktree while you start A4.

Prompt:
```text
Write ai/detect.py. For each image in ai/cache/images.jsonl without a line in ai/cache/detections.jsonl, send the image to claude-haiku-5-5 and ask whether the footpath on the LEFT and on the RIGHT of the camera is covered overhead (awning, verandah, shade sail, covered walkway; trees don't count). Force JSON with a tool schema: {left: {covered, kind, confidence}, right: {covered, kind, confidence}, reason}. Run 8 requests at a time with exponential backoff on 429 and 529, append each result as it lands, and print progress and the positive rate. First run only the 20 images in ai/calibration.json and show agreement with my labels.
```

Note: Make ai/calibration.json first: 20 image IDs with your own left and right labels. It takes 5 minutes and saves the run.

#### A4 · Verifier pass with Sonnet on every positive
`12:15–12:45` · needs A3 · feeds A5

Done when:
- Every positive side re-checked in a fresh request that sees only the image and the claim.
- Verified only when both passes agree it's covered; the reject rate is printed.
- ai/cache/verified.jsonl written and resumable.

Prompt:
```text
Write ai/verify.py. For every side marked covered in detections.jsonl, ask claude-sonnet-5-5 in a fresh request (show only the image and the claim, such as 'left footpath covered by an awning', never the first pass's reasoning) to judge independently whether that side is covered and by what. Mark it verified only when both agree it's covered. Use the same tool-schema JSON, concurrency, backoff and resume as detect.py. Write ai/cache/verified.jsonl and print positives, verified and % rejected.
```

Note: Write it and launch the full run by about 12:30; it keeps running in the background while you do P1.

#### P1 · Find the demo routes → docs/demo-routes.md
`12:30–13:00` · needs D5, W1, IC1 · feeds D9, A7, W7, P2

Done when:
- docs/demo-routes.md: 3 pairs from the venue where shady ≠ shortest at 09:00, 12:00 and 16:30, with extra minutes and sun-minutes saved.
- 5 preset destinations (name + lon/lat) for Eric's presets.ts.
- Uses the real router from web/src/routing/; no second router.

Prompt:
```text
Write docs/find-demo-routes.ts that imports the router from web/src/routing/ (don't reimplement it), loads web/public/data/graph.json and shade.json, and from the venue node tries every node 150 to 500 m away at slots 09:00, 12:00 and 16:30 with α = 5. Keep pairs where the shady route adds under 25% distance, rank them by sun-minutes saved, and write the top 3 pairs plus 5 named preset destinations (nearest landmark or street corner, with lon/lat) to docs/demo-routes.md. Run it with npx tsx.
```

Note: The verifier (A4) keeps running in the background while you do this. Candidates if inside the box: Brunswick St Mall, Chinatown Mall, Fortitude Valley station, McWhirters.

#### A5 · Aggregate per edge → ai/out/awnings.json
`13:00–13:30` · needs A4, D2 · feeds D8, A6

Done when:
- Each image side becomes an observation snapped to the nearest edge within 15 m.
- covered_fraction = verified covered observations / all observations on that edge.
- ai/out/awnings.json validates; edges covered and covered metres printed; shipped.

Prompt:
```text
Write ai/aggregate.py. Load web/public/data/graph.json (frozen) plus the detections and verified results. In EPSG:7856, turn each image side into an observation point 6 m left or right of the camera, perpendicular to its compass_angle, and snap it to the nearest edge within 15 m (drop it otherwise). Per edge: covered_fraction = verified covered observations / all observations, confidence = mean confidence, kind = most common kind, image_ids = the positive images, verified = true; skip edges with no verified cover. Write ai/out/awnings.json per the contract, check it with data/validate.py, and print edges covered and total covered metres.
```

Note: If the graph only has street centrelines (no separate sidewalks), both sides snap to the same edge. Use the better side per image, since a walker can cross to the shady side.

#### A6 · Precision check + stats for the slide
`13:45–14:15` · needs A5 · feeds A7, P2

Done when:
- 30 random verified positives and 10 rejections hand-checked in 5 minutes; precision recorded.
- ai/out/stats.json: images checked, first-pass positives, verified, % rejected by the verifier, edges covered, covered metres, precision.
- The 3 clearest examples (one per kind) in ai/out/examples/ for slide 2.

Prompt:
```text
Write ai/stats.py to compute images checked, first-pass positives, verified, % rejected by the verifier, edges covered and covered metres. Build ai/out/review.html as a static grid of 30 random verified positives and 10 random rejections with their claims so I can count mistakes in 5 minutes, then let me record precision with uv run python stats.py --precision <correct>/30, saved into ai/out/stats.json. Copy the 3 clearest examples, one per kind, to ai/out/examples/.
```

If it slips: if precision is under 80% or awnings change no demo route, switch to A7.

#### A7 · Fallback: hand-label awnings on the demo routes
`14:15–14:45` · needs P1, A6 · fallback, if the awnings pipeline isn't good enough

Done when:
- Awnings on the 3 demo routes labelled by eye from the cached photos: verified true, kind set, image_ids filled.
- The pitch says so: hand-labelled for the demo, with the pipeline and its stats showing how it scales.

Prompt:
```text
For each edge on the shady routes in docs/demo-routes.md, show me the nearest cached Mapillary images from ai/cache/ in a quick HTML contact sheet. I'll list which edges are covered and by what; write those into ai/out/awnings.json (verified true, covered_fraction from my estimate) and check it with data/validate.py.
```

#### P2 · 2 slides, demo script, Q&A crib
`14:15–15:00` · needs P1, A6 · feeds P3

Done when:
- Slide 1 hook: a 34° day, the shortest walk is the worst walk, and the noon sun is 82° up.
- Slide 2: data → shadows → vision + verifier → routing, the vision stats, and a big QR code.
- A 90-second demo script built around the 3 demo pairs, plus the Q&A crib with today's real numbers.

Prompt:
```text
Draft docs/pitch.md: slide 1 (hook: 'It's 34° in Brisbane. The shortest walk is the worst walk.' plus the 82° noon-sun fact), slide 2 (the pipeline in words, the numbers from ai/out/stats.json, a QR to the production URL), and a 90-second demo script that walks the 3 pairs in docs/demo-routes.md and ends at 16:30. Add the judge Q&A crib from docs/ROADMAP.md with today's real numbers filled in.
```

#### P3 · Final numbers, QR test, recording setup
`15:00–15:30` · needs P2, D9 · feeds VID

Done when:
- Every number on the slides matches the deployed data (stats.json and the D9 limits note).
- The QR on the slide tested from two phones.
- Screen recording works on the demo phone; phones and laptop charged.

Prompt:
```text
Check every number in docs/pitch.md against ai/out/stats.json and the D9 limits comment, and list any mismatch with the correct value.
```

### Web (Eric) (ericliswan)

#### W0 · Run the plan hour, link Vercel, create the board
`9:00–9:45` · feeds W1

Done when:
- Plan hour kept to time; Q1 to Q7 decided and written into contracts/.
- Vercel project imported from the repo with Root Directory web and framework Vite, so every push to main deploys.
- bash docs/seed-issues.sh run once at 9:35; labels and issues exist.
- Basemap: OpenFreeMap positron style (no API key; light, so shadows read).

Note: You own the clock: call each agenda item and cut debates at 2 minutes by taking the recommended default.

#### W1 · Map + fixture load + Dijkstra (shortest and shady)
`9:45–10:20` · needs D1, W0 · feeds W2, P1 · stub first

Done when:
- Vite + TypeScript + MapLibre app loads graph.json and shade.json from web/public/data/ via import.meta.env.BASE_URL.
- Dijkstra with a binary heap in web/src/routing/, costed as in CLAUDE.md.
- Shortest (α = 0) and shady (α = 5) routes drawn in two colours with a legend.
- npm run build passes.

Prompt:
```text
Scaffold a Vite + TypeScript app in web/ with MapLibre GL and the OpenFreeMap positron style. Load graph.json and shade.json from web/public/data/ using import.meta.env.BASE_URL. In web/src/routing/ implement Dijkstra with a binary heap over the undirected graph, edge cost = length_m × (1 + α × sunFraction[slot]), plus a summary helper returning distance and sun-minutes (Σ length_m × sunFraction / 1.3 / 60). Draw the shortest (α = 0) and shady (α = 5) routes between two fixture nodes in different colours with a legend. Run npm run build.
```

Note: Starts on the fixtures Data pushes at about 9:50, before validate.py is finished.

#### W2 · Deploy check + QR page → demo-ok-0
`10:20–10:30` · needs W1 · feeds W3

Done when:
- The production URL serves the app from main with no console errors.
- web/public/qr.png and web/public/qr.html (big QR with the URL underneath).
- Opened on a phone; tag demo-ok-0 (G1).

Prompt:
```text
Push and confirm the Vercel production URL serves the app (data files load, no console errors). Generate web/public/qr.png for that URL with npx qrcode, add web/public/qr.html that shows it full-screen with the URL underneath, ship, and check both on the production URL.
```

If it slips: make this the priority; everything else demos through it.

#### W3 · Destination picker (origin fixed at the venue)
`10:30–11:15` · needs W2 · feeds W4

Done when:
- The origin is fixed at the venue entrance node (Q2).
- Tapping the map makes the nearest graph node the destination; routes recompute in under 100 ms.
- 5 preset chips, placeholders until P1 delivers the real ones at 13:00.

Prompt:
```text
Add a destination picker. The origin is fixed at the venue (a constant in web/src/ui/presets.ts, snapped to the nearest graph node). Tapping the map snaps to the nearest node and sets the destination. Add 5 preset destination chips from the same file (placeholders for now). Recompute both routes on every change and log the routing time; keep it under 100 ms.
```

#### W4 · Results card: shortest vs shadiest, sun minutes
`11:15–12:00` · needs W3 · feeds W5

Done when:
- For each route: distance, walking time at 1.3 m/s, sun minutes; for shadiest also extra minutes and % less sun.
- A one-thumb bottom sheet on phones, colours matching the route lines.

Prompt:
```text
Add a results card as a bottom sheet on phones: for shortest and shadiest show distance, walking time at 1.3 m/s and sun minutes, and for shadiest the extra minutes and % less sun than shortest. Colour-match the route lines. Run npm run build and check it at 390 px wide.
```

#### W5 · Time slider + shade-hunger slider on real data
`12:00–12:45` · needs W4, D5 · feeds W6

Done when:
- The time slider snaps to the 51 slots and defaults to the current Brisbane time, clamped to 06:00 to 18:30.
- α shade-hunger slider from 0 to 10, default 5.
- Any change recomputes routes and the card instantly; the label reads like '4:30 pm · sun 23° up'.
- Works on the real shade.json.

Prompt:
```text
Add a time slider that snaps to the 51 slots in shade.json and defaults to the current Brisbane time (UTC+10, clamped to 06:00 to 18:30), and a shade-hunger slider for α from 0 to 10 (default 5). Any change recomputes both routes and the card immediately. Show the slot as '4:30 pm · sun 23° up' using sun[slot].alt_deg. Test with the real data now on main.
```

#### W6 · 2D shadow overlay for the current slot
`12:45–13:30` · needs W5, D7 · feeds IC2, W7

Done when:
- Q1 yes: the slot's shadows/HHMM.geojson drawn as a translucent fill under the routes, with neighbouring slots prefetched so dragging is smooth.
- Q1 no, or a file missing: street edges coloured by sunFraction for the current slot.

Prompt:
```text
Draw the current slot's shadows: fetch web/public/data/shadows/HHMM.geojson into one MapLibre fill layer under the route lines at about 35% opacity, prefetch the neighbouring slots, and swap the source data when the time slider moves. If a file is missing, fall back to colouring street edges by sunFraction (sun warm, shade cool).
```

Note: Build it against the fixture shadows; the real files land with D7 at about 13:15.

#### W7 · Mobile polish on iPhone Safari + real presets
`13:30–14:00` · needs W6, P1 · feeds W8

Done when:
- The 5 presets from docs/demo-routes.md are in web/src/ui/presets.ts.
- Tested on an iPhone in Safari: safe areas, tap targets of 44 px or more, no sideways scroll, sliders easy with one thumb.
- First load under about 2 s on 4G, with a loading state while data fetches.

Prompt:
```text
Copy the 5 presets from docs/demo-routes.md into web/src/ui/presets.ts. Then polish for iPhone Safari: respect safe-area insets, make every tap target at least 44 px, remove any sideways scroll, and make both sliders easy to use with one thumb. Add a loading state while data fetches, then check bundle and data sizes and lazy-load anything not needed for the first route.
```

#### W8 · 3D shade view (stretch, laptop-only)
`14:00–14:30` · needs W7 · stretch, best once G4 is met

Done when:
- A 2D/3D toggle lazy-loads web/src/three/ with import(); three.js isn't in the first load.
- Extruded buildings, trees and a sun DirectionalLight with shadow maps that follow the time slider; both routes drawn.
- Laptop-only behind the toggle; hidden on touch devices.

Prompt:
```text
In web/src/three/index.ts implement createShadeView(el, data) with three.js and load it with a dynamic import() from a 2D/3D toggle hidden on touch devices. Convert [lon, lat] to local metres around the bbox centre (east = +X, north = −Z, up = +Y), extrude buildings to height_m, render trees as an InstancedMesh trunk plus canopy, and add a DirectionalLight in the direction (sin az·cos alt, sin alt, −cos az·cos alt) with an orthographic shadow camera covering ±400 m at 2048 px. setSlot follows the time slider and showRoutes draws both routes 0.5 m above the ground in the 2D legend colours. Check that 16:30 shadows point ENE.
```

Note: If it isn't working when the team wants to wrap up, delete the toggle and ship without it.

### Team (everyone)

#### PLAN · Plan hour: all hands, one shared Claude session
`9:00–9:45`

Done when:
- Everything on the G0 checklist is true.

Note: Use the minute-by-minute agenda as a guide. Eric keeps time; Data drives the shared Claude session.

#### SU1 · Stand-up
`10:30–10:35`

Done when:
- Each person: shipped, next, blocked, contract changes (30 s each).
- Is G1 met? If not, the 10:30 tripwire applies.

#### IC1 · Integration check 1 + stand-up
`12:00–12:15` · needs D5 · feeds P1

Done when:
- Aadit runs the demo path on the deployed site from a phone and files bugs (labels: bug + area).
- Stand-up: shipped, next, blocked, contract changes. One person reads the credit total from /usage.
- G3 met → tag demo-ok-1.

Note: Before anyone eats: start long-running agent jobs (vision pass, shade rebuild).

#### IC2 · Integration check 2 + stand-up
`13:30–13:45` · needs W6

Done when:
- Aadit runs all 3 demo pairs on the deployed site from a phone and files bugs.
- Stand-up plus credit check. Decide the 13:30 tripwire (3D stretch or not) out loud.
- G4 met → tag demo-ok-2.

#### SU4 · Stand-up (bugs only)
`15:00–15:05`

Done when:
- Only demo-path bugs are discussed. Anything else waits until after judging.

#### VID · Backup video + demo-ok-final tag
`15:30–15:45` · needs P3 · feeds R1

Done when:
- Screen recording on a phone of the full demo path on the deployed site: 3 pairs, ending at 16:30.
- A short clip of the 3D view from the laptop.
- git tag demo-ok-final && git push origin demo-ok-final (G7).

#### R1 · Rehearsal 1: timed, on a phone, deployed site
`15:45–16:00` · needs VID · feeds R2

Done when:
- Full pitch and demo inside the time limit.
- Fix only what breaks the demo path.

#### R2 · Rehearsal 2
`16:00–16:15` · needs R1 · feeds POST

Done when:
- Same run again, with the person who will hold the phone holding it.

#### POST · Post the link in #showcase
`16:15–16:30` · needs R2

Done when:
- Production URL, repo link and a one-line description posted with some margin before the submission deadline (G8).

## Judge Q&A crib

Fill in the bracketed numbers from `ai/out/stats.json` and the D9 limits note.

**Isn't this Cool Walks or inShade?**  
They model shade from above: heights, terrain, canopy. In late November Brisbane's noon sun is 82° up, so building shadows almost vanish; the shade that's left is awnings, verandahs and trees, which height data can't see. Our vision pass finds it.

**How do you know the vision model is right?**  
A second, separate verifier pass re-checks every positive and rejected [X]%. We hand-checked 30 verified positives: [Y]% precision.

**How accurate are the building heights?**  
OSM heights where tagged, levels × 3.2 m otherwise, 6 m as a last resort ([N]% tagged here). Near noon it barely matters, because awnings and trees carry the shade.

**Why precompute instead of calculating live?**  
The sun's path is deterministic, so shade per 15-minute slot is computed once. Routing then runs on the phone in milliseconds, with no server to break.

**Does it scale beyond the Valley?**  
The pipeline runs per bounding box: more Mapillary tiles and more vision calls, which batch well. Cost grows with street length, not with users.

**Why Mapillary?**  
Its street imagery is openly licensed and has a free API, which suits building a dataset from it.

**What about clouds or UV?**  
Our stretch goal: a UV sunburn budget from the forecast UV index.

## Board setup

At 9:35, once `contracts/` is on main, run `bash docs/seed-issues.sh` once from the repo root. It creates 8 labels and 27 issues in time order, and refuses to run if the repo already has issues. Plan-hour jobs aren't issues, and fallback tasks are opened when the team decides they're needed.
## Area guardrails

At 9:35 each person creates `.claude/settings.local.json` (git-ignored) with their block, then restarts `claude` **from the repo root**, because the `/` paths are anchored at the directory you start in. The shared `.claude/settings.json` already blocks `.env`, force-pushes, pushes to main and `git reset --hard` for everyone.

Eric (web):
```json
{ "permissions": { "deny": [
  "Edit(/data/**)", "Edit(/contracts/**)", "Edit(/ai/**)", "Edit(/docs/**)",
  "Edit(/web/public/data/**)", "Edit(/CLAUDE.md)", "Edit(/.claude/settings.json)", "Edit(/.claude/skills/**)"
] } }
```

Aadit (ai + pitch):
```json
{ "permissions": { "deny": [
  "Edit(/data/**)", "Edit(/contracts/**)", "Edit(/web/**)",
  "Edit(/CLAUDE.md)", "Edit(/.claude/settings.json)", "Edit(/.claude/skills/**)"
] } }
```

Musa (data + contracts):
```json
{ "permissions": { "deny": [
  "Edit(/ai/**)", "Edit(/docs/**)",
  "Edit(/web/src/**)", "Edit(/web/index.html)", "Edit(/web/package.json)", "Edit(/web/vite.config.ts)"
] } }
```

Limits: a deny can't make an exception, so Musa's block lists Eric's web files one by one rather than denying `web/**` and allowing `web/public/data/`. Edit rules also don't stop a shell command from writing a file. The CLAUDE.md rule and `/ship`'s area check are the real guard, so these blocks are a seatbelt and don't replace them.
