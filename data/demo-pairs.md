# Demo pairs for P1 (draft from Data, for Aadit)

Candidate destinations for `docs/demo-routes.md` and the 5 preset chips in `web/src/ui/presets.ts`.
Origin is always the venue. Numbers are from the real `graph.json` + `shade.json` (building and tree shade plus the
**verified awnings merged in D8**), shadiest = alpha 5 (the app default), computed with Eric's router logic. Reproduce with
`cd data && python3 demo_pairs.py`. This is the post-awnings rerun (before-awnings numbers are in git history at `fc5b227`). Awnings lowered the shortest route's sun minutes too, so savings moved a little.

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

## Numbers (venue to destination, alpha 5, awnings merged)

### Duncan St & Wickham St
Still the smallest detour at 12:00 and 16:30 (+2%); 09:00 now takes +10% via Wickham then Duncan. Midday improved (0.2 to 0.7 min) now that awnings count.

| Time | Shortest | Shadiest | Sun-min saved | Extra distance | Shadiest goes via |
|---|---|---|---|---|---|
| 09:00 | 292 m, 2.4 sun-min | 321 m, 1.2 sun-min | 1.3 | +10% | Wickham Street > Duncan Street |
| 12:00 | 292 m, 2.9 sun-min | 298 m, 2.2 sun-min | 0.7 | +2% | Wickham Street |
| 16:30 | 292 m, 2.4 sun-min | 298 m, 1.3 sun-min | 1.1 | +2% | Wickham Street |

### Boundary St & Dodge Ln
Saves 1.2 to 2.0 min at every time and the route changes with the slider (Ann St at midday, Macrossan > Diddams Ln > Boundary St at 09:00 and 16:30), but the 09:00 detour is +43%, which is long for this pair.

| Time | Shortest | Shadiest | Sun-min saved | Extra distance | Shadiest goes via |
|---|---|---|---|---|---|
| 09:00 | 347 m, 3.8 sun-min | 495 m, 1.8 sun-min | 2.0 | +43% | Macrossan Street > Diddams Lane > Boundary Street |
| 12:00 | 347 m, 3.8 sun-min | 411 m, 2.6 sun-min | 1.2 | +19% | Ann Street > Boundary Street |
| 16:30 | 347 m, 2.8 sun-min | 439 m, 1.5 sun-min | 1.3 | +27% | Macrossan Street > Diddams Lane > Boundary Street |

### Boundary St & Ivory St
Biggest saving (2.5 min at 09:00) but a long walk (443 m shortest) and +35% at 09:00. Use as the 'maximum shade' example, not the first demo.

| Time | Shortest | Shadiest | Sun-min saved | Extra distance | Shadiest goes via |
|---|---|---|---|---|---|
| 09:00 | 443 m, 4.8 sun-min | 598 m, 2.3 sun-min | 2.5 | +35% | Macrossan Street > Boundary Street |
| 12:00 | 443 m, 4.9 sun-min | 508 m, 3.7 sun-min | 1.2 | +15% | Ann Street > Boundary Street |
| 16:30 | 443 m, 3.2 sun-min | 541 m, 1.8 sun-min | 1.4 | +22% | Boundary Street |

### Barry Pde & Gipps St
Time-slider showpiece: at 12:00 the shadiest route is the shortest-ish route (+0%) and saves 1.0 min now; at 16:30 it goes via Gotha St / Barry Pde, and at 09:00 via Wickham St.

| Time | Shortest | Shadiest | Sun-min saved | Extra distance | Shadiest goes via |
|---|---|---|---|---|---|
| 09:00 | 311 m, 3.7 sun-min | 390 m, 2.1 sun-min | 1.5 | +25% | Wickham Street > Gipps Street |
| 12:00 | 311 m, 3.7 sun-min | 312 m, 2.7 sun-min | 1.0 | +0% | Gipps Street |
| 16:30 | 311 m, 2.6 sun-min | 382 m, 1.3 sun-min | 1.3 | +23% | Gotha Street > Barry Parade > Gipps Street |

### Macrossan St & Queen St
Cheap afternoon win (+3% distance, 0.8 min saved at 16:30); at 09:00 and 12:00 it saves 1.2 to 1.4 min for +20%.

| Time | Shortest | Shadiest | Sun-min saved | Extra distance | Shadiest goes via |
|---|---|---|---|---|---|
| 09:00 | 321 m, 2.8 sun-min | 386 m, 1.4 sun-min | 1.4 | +20% | Venue access only |
| 12:00 | 321 m, 2.9 sun-min | 386 m, 1.7 sun-min | 1.2 | +20% | Venue access only |
| 16:30 | 321 m, 2.1 sun-min | 330 m, 1.4 sun-min | 0.8 | +3% | Venue access only |

## Honest limits for the pitch
- Savings are **0.7 to 2.5 sun-minutes** per walk. That is real but small: walks here are 3 to 7 minutes. Pitch it as "less sun for almost the same walk", not "avoid the sun".
- **12:00 is still the weakest time** (sun about 80 degrees up, buildings cast almost no shadow; 84% of edges are full sun) but the awnings lifted it: all five pairs now save 0.7 to 1.2 min at midday (0.2 to 1.5 before). Only 55 of 960 edges have awnings, so it stays modest.
- Building heights are mostly the 6 m default (87%) and trees are canopy-extent discs, so building shade is understated at 09:00 and 16:30 (see `data/QA.md`).
- Pair order for the chips: 1 first (small detour, easy to explain), 2 for the time-slider demo, 4 as the second slider example.
