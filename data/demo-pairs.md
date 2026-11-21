# Demo pairs for P1 (draft from Data, for Aadit)

Candidate destinations for `docs/demo-routes.md` and the 5 preset chips in `web/src/ui/presets.ts`.
Origin is always the venue. Numbers are from the real `graph.json` + `shade.json` (building and tree shade only,
**no awnings yet**), shadiest = alpha 5 (the app default), computed with Eric's router logic. Reproduce with
`cd data && python3 demo_pairs.py`, and rerun it after the awnings merge: numbers and the chosen pairs may change.

## How these were picked
- Destinations are **named street intersections** that the graph can snap to exactly, 150 to 500 m from the venue and at least 30 m inside the bbox edge (no demo ending on the map border).
- Every pair has a shadiest route that differs from the shortest at 09:00, 12:00 and 16:30, with a detour of 25% or less at most times.
- Intersections are not places a judge knows. I could not query OSM for landmarks (Overpass is blocked here), so **please swap in a named place near each node** (café, plaza, station entrance) and check it snaps to the same node. Coordinates below are the node positions.

## The five
| # | Label | Node | lon, lat | Straight-line from venue |
|---|---|---|---|---|
| 1 | Duncan St & Wickham St | `n_f677a08c` | 153.033039, -27.458118 | 262 m |
| 2 | Boundary St & Dodge Ln | `n_5abc6f9c` | 153.032174, -27.461987 | 222 m |
| 3 | Boundary St & Ivory St | `n_a3c07730` | 153.033119, -27.462171 | 282 m |
| 4 | Barry Pde & Gipps St | `n_a6498936` | 153.031508, -27.457932 | 235 m |
| 5 | Macrossan St & Queen St | `n_8e224ba7` | 153.03146, -27.462369 | 255 m |

## Numbers (venue → destination, alpha 5)

### Duncan St & Wickham St
Smallest detour of the set (+2 to +5%). Best story for a judge: nearly the same walk, noticeably less sun at 09:00 and 16:30. Weak at 12:00 (0.2 min).

| Time | Shortest | Shadiest | Sun-min saved | Extra distance | Shadiest goes via |
|---|---|---|---|---|---|
| 09:00 | 292 m, 3.0 sun-min | 306 m, 1.3 sun-min | 1.7 | +5% | Duncan Street |
| 12:00 | 292 m, 3.6 sun-min | 298 m, 3.4 sun-min | 0.2 | +2% | Wickham Street |
| 16:30 | 292 m, 2.9 sun-min | 298 m, 1.7 sun-min | 1.2 | +2% | Wickham Street |

### Boundary St & Dodge Ln
Most consistent saving at all three times (1.0 to 1.9 min). The shady route is different at 09:00, 12:00 and 16:30, so dragging the time slider visibly changes it (Gotha St in the morning and afternoon, Ann St at midday).

| Time | Shortest | Shadiest | Sun-min saved | Extra distance | Shadiest goes via |
|---|---|---|---|---|---|
| 09:00 | 347 m, 4.2 sun-min | 431 m, 2.3 sun-min | 1.9 | +24% | Gotha Street > Dodge Lane |
| 12:00 | 347 m, 4.2 sun-min | 411 m, 2.7 sun-min | 1.5 | +19% | Ann Street > Boundary Street |
| 16:30 | 347 m, 2.9 sun-min | 405 m, 1.9 sun-min | 1.0 | +17% | Gotha Street > Dodge Lane |

### Boundary St & Ivory St
Biggest saving (up to 2.3 min at 09:00) but a long walk (443 m shortest) and +35% at 09:00. Use as the 'maximum shade' example, not the first demo.

| Time | Shortest | Shadiest | Sun-min saved | Extra distance | Shadiest goes via |
|---|---|---|---|---|---|
| 09:00 | 443 m, 5.4 sun-min | 598 m, 3.1 sun-min | 2.3 | +35% | Macrossan Street > Boundary Street |
| 12:00 | 443 m, 5.4 sun-min | 508 m, 4.0 sun-min | 1.5 | +15% | Ann Street > Boundary Street |
| 16:30 | 443 m, 3.2 sun-min | 541 m, 2.1 sun-min | 1.1 | +22% | Boundary Street |

### Barry Pde & Gipps St
Time-slider showpiece: shadiest equals the shortest-ish route at 12:00 (+0%) but takes a different route via Gotha St / Barry Pde at 16:30.

| Time | Shortest | Shadiest | Sun-min saved | Extra distance | Shadiest goes via |
|---|---|---|---|---|---|
| 09:00 | 311 m, 3.8 sun-min | 389 m, 2.4 sun-min | 1.4 | +25% | Gipps Street |
| 12:00 | 311 m, 3.8 sun-min | 312 m, 3.5 sun-min | 0.3 | +0% | Gipps Street |
| 16:30 | 311 m, 2.6 sun-min | 382 m, 1.3 sun-min | 1.3 | +23% | Gotha Street > Barry Parade > Gipps Street |

### Macrossan St & Queen St
Cheap afternoon win (+3% distance, 0.8 min saved at 16:30); at 09:00 and 12:00 it saves 1.5 to 1.7 min for +20%.

| Time | Shortest | Shadiest | Sun-min saved | Extra distance | Shadiest goes via |
|---|---|---|---|---|---|
| 09:00 | 321 m, 3.8 sun-min | 386 m, 2.1 sun-min | 1.7 | +20% | Venue access |
| 12:00 | 321 m, 3.9 sun-min | 386 m, 2.4 sun-min | 1.5 | +20% | Venue access |
| 16:30 | 321 m, 2.5 sun-min | 330 m, 1.8 sun-min | 0.8 | +3% | Venue access |

## Honest limits for the pitch
- Savings are **0.2 to 2.3 sun-minutes** per walk. That is real but small: walks here are 3 to 7 minutes. Pitch it as "less sun for almost the same walk", not "avoid the sun".
- **12:00 is the weakest time** (sun about 80 degrees up, buildings cast almost no shadow; most edges are full sun). Awnings are what should change that, so rerun this after the awnings merge and prefer pairs that improve at midday.
- Building heights are mostly the 6 m default (87%) and trees are canopy-extent discs, so building shade is understated at 09:00 and 16:30 (see `data/QA.md`).
- Pair order for the chips: 1 first (small detour, easy to explain), 2 for the time-slider demo, 4 as the second slider example.

## After the awnings merge (D8, 21 Nov)

Same script rerun on `shade.json` with 55 verified awning edges. Sun-minutes dropped on every pair, and midday now saves 0.7 to 1.2 min (was 0.2 to 1.5, mostly 0.2 to 0.3 on pairs 1 and 4). Routes still differ between shortest and shadiest on every pair. Pair 2 now changes route across the day (Macrossan > Diddams Lane at 09:00 and 16:30, Ann Street at 12:00), good for the slider; pair 1 now uses the same shadiest route at 12:00 and 16:30.

```

Duncan St & Wickham St  n_f677a08c
  09:00  shortest 292 m 2.4 sun-min | shadiest 321 m 1.2 sun-min | saves 1.3 (+10% distance) | via Venue access > Wickham Street > Duncan Street
  12:00  shortest 292 m 2.9 sun-min | shadiest 298 m 2.2 sun-min | saves 0.7 (+2% distance) | via Venue access > Wickham Street
  16:30  shortest 292 m 2.4 sun-min | shadiest 298 m 1.3 sun-min | saves 1.1 (+2% distance) | via Venue access > Wickham Street

Boundary St & Dodge Ln  n_5abc6f9c
  09:00  shortest 347 m 3.8 sun-min | shadiest 495 m 1.8 sun-min | saves 2.0 (+43% distance) | via Venue access > Macrossan Street > Diddams Lane > Boundary Street
  12:00  shortest 347 m 3.8 sun-min | shadiest 411 m 2.6 sun-min | saves 1.2 (+19% distance) | via Venue access > Ann Street > Boundary Street
  16:30  shortest 347 m 2.8 sun-min | shadiest 439 m 1.5 sun-min | saves 1.3 (+27% distance) | via Venue access > Macrossan Street > Diddams Lane > Boundary Street

Boundary St & Ivory St  n_a3c07730
  09:00  shortest 443 m 4.8 sun-min | shadiest 598 m 2.3 sun-min | saves 2.5 (+35% distance) | via Venue access > Macrossan Street > Boundary Street
  12:00  shortest 443 m 4.9 sun-min | shadiest 508 m 3.7 sun-min | saves 1.2 (+15% distance) | via Venue access > Ann Street > Boundary Street
  16:30  shortest 443 m 3.2 sun-min | shadiest 541 m 1.8 sun-min | saves 1.4 (+22% distance) | via Venue access > Boundary Street

Barry Pde & Gipps St  n_a6498936
  09:00  shortest 311 m 3.7 sun-min | shadiest 390 m 2.1 sun-min | saves 1.5 (+25% distance) | via Venue access > Wickham Street > Gipps Street
  12:00  shortest 311 m 3.7 sun-min | shadiest 312 m 2.7 sun-min | saves 1.0 (+0% distance) | via Venue access > Gipps Street
  16:30  shortest 311 m 2.6 sun-min | shadiest 382 m 1.3 sun-min | saves 1.3 (+23% distance) | via Venue access > Gotha Street > Barry Parade > Gipps Street

Macrossan St & Queen St  n_8e224ba7
  09:00  shortest 321 m 2.8 sun-min | shadiest 386 m 1.4 sun-min | saves 1.4 (+20% distance) | via Venue access
  12:00  shortest 321 m 2.9 sun-min | shadiest 386 m 1.7 sun-min | saves 1.2 (+20% distance) | via Venue access
  16:30  shortest 321 m 2.1 sun-min | shadiest 330 m 1.4 sun-min | saves 0.8 (+3% distance) | via Venue access
```
