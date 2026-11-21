# Data QA + limits note (D9)

**Third pass, on REAL OSM, BCC and awning inputs, with the verified awnings merged into `shade.json` (D8).** `ai/out/awnings.json` (generated 2026-11-21) is merged: 55 of 55 entries are `verified: true` and every one changed its edge. `check_awnings_merge.py` re-computed the contract rule on the real run and passes. Numbers below are final unless the graph, buildings or awnings change.
`validate.py` on `web/public/data/`: all OK (graph, shade, buildings, trees, awnings, 50 of 50 daytime slot files). `awnings.json` is copied in next to `shade.json` so `validate.py` can cross-check its edge ids against the graph.

- **Graph (OSM walk network):** 798 nodes, 960 edges, 19.02 km, longest edge 29.9 m (split to 30 m or less). Edge IDs are deterministic and now frozen (two builds gave byte-identical `graph.json`). The venue is a map pin 17 m from the nearest street edge, joined to it.
- **Buildings (OSM, bbox + 100 m):** 368. Height source: `osm` 13 (4%), `levels` 36 (10%), `default` 6 m 319 (87%). Median height 6 m; 15 buildings are 20 m or taller, tallest 150 m. 48 footprints reaching beyond bbox + 100 m and 2 with unusable geometry were dropped.
- **Trees:** 574 discs, all at the 4 m radius / 8 m height defaults. OSM has just 1 tree here. The other 573 come from Brisbane City Council "Protected Vegetation" polygons (Council Vegetation and Significant Urban Vegetation, CC-BY 4.0): 17 canopy polygons in the bbox, filled with discs on a 5.5 m grid. These are canopy EXTENTS on Council and protected land, not surveyed trees; trees on private land or not protected are missing. Credit "Brisbane City Council open data".
- **Shade (all 51 slots, from the shadow engine):** 16:30 sun is 22.7 deg up at azimuth 258.5 deg; the tallest building's shadow falls 313 m toward bearing 78 deg (ENE), as expected. Mean sunFraction and share of edges in full shade / full sun:

  | Slot | Mean sunFraction | Full shade (<0.05) | Full sun (>0.95) |
  |---|---|---|---|
  | 09:00 | 0.82 | 11% | 74% |
  | 12:00 | 0.94 | 3% | 89% |
  | 16:30 | 0.58 | 28% | 45% |

  Adding the BCC canopy moved 12:00 from mean 0.97 / 95% full sun to 0.94 / 89%; adding the awnings moved it to 0.91 / 84% (full shade 3% to 5%). Midday is still mostly sun: the sun is 80 deg up, so buildings cast almost no shadow, and the awnings only cover 55 of 960 edges. Before the awnings the 09:00 / 16:30 means were 0.82 / 0.58.
- **Awnings (AI vision + verifier, merged by D8):** 55 edges, all verified: 43 `awning`, 7 `covered_walkway`, 5 `verandah` (5.7% of the 960 edges). They span 1174.5 m of street; weighted by `covered_fraction` the covered length is 640.5 m (3.4% of the 19.0 km network). Vision stats are in `ai/out/stats.json` (460 photos, 92 verified sides, hand-checked precision 27/30 = 90%). Rule applied: `sunFraction *= (1 - covered_fraction)` for every slot, `verified: true` only.
- **Demo pairs (venue to 5 intersections, alpha 5, own Dijkstra with the router's cost; details in `data/demo-pairs.md`):** the awnings lower the *shortest* route's sun minutes too, so savings shift rather than simply grow. Sun-min saved by the shadiest route across the five pairs, before awnings to after: 09:00 1.4 to 2.3 -> 1.3 to 2.5; 12:00 0.2 to 1.5 -> 0.7 to 1.2 (the weak midday pairs gain: Duncan & Wickham 0.2 -> 0.7, Barry & Gipps 0.3 -> 1.0); 16:30 0.8 to 1.2 -> 0.8 to 1.4. Trade-off: Boundary St & Dodge Ln at 09:00 now needs +43% distance (was +24%) because the shadiest route detours through Macrossan St and Diddams Ln for awnings. This is not Eric's router, so check the web app agrees.
- **Size:** `web/public/data` is about 4.3 MB (shadow overlays about 3.6 MB), under the 5 MB phone budget.
- **Approximated:** the building height fallback (87% of buildings use the 6 m default, so real heights differ); tree canopy radius 4 m and height 8 m everywhere; BCC polygons turned into discs; walking speed 1.3 m/s; shadow polygons simplified to 0.5 m and clipped to bbox + 200 m; `sunFraction` rounded to 0.01.
- **Not modelled:** UV, reflected heat, tree seasonality, cloud, covered areas that are not yet detected from street photos, anything outside the 600 x 600 m bbox.
