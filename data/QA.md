# Data QA + limits note (D9)

**Second pass on REAL OSM and BCC inputs (main at `99489ed`). Awnings are NOT in yet:** `ai/out/awnings.json` does not exist, so `shade.json` is building + tree shade only. Rerun after D8 before any awning number goes on a slide.
`validate.py` on `web/public/data/`: all OK (graph, shade, buildings, trees, 50 of 50 daytime slot files). No `awnings.json` is committed.

- **Graph (OSM walk network):** 798 nodes, 960 edges, 19.02 km, longest edge 29.9 m (split to 30 m or less). Edge IDs are deterministic and now frozen (two builds gave byte-identical `graph.json`). The venue is a map pin 17 m from the nearest street edge, joined to it.
- **Buildings (OSM, bbox + 100 m):** 368. Height source: `osm` 13 (4%), `levels` 36 (10%), `default` 6 m 319 (87%). Median height 6 m; 15 buildings are 20 m or taller, tallest 150 m. 48 footprints reaching beyond bbox + 100 m and 2 with unusable geometry were dropped.
- **Trees:** 574 discs, all at the 4 m radius / 8 m height defaults. OSM has just 1 tree here. The other 573 come from Brisbane City Council "Protected Vegetation" polygons (Council Vegetation and Significant Urban Vegetation, CC-BY 4.0): 17 canopy polygons in the bbox, filled with discs on a 5.5 m grid. These are canopy EXTENTS on Council and protected land, not surveyed trees; trees on private land or not protected are missing. Credit "Brisbane City Council open data".
- **Shade (all 51 slots, from the shadow engine):** 16:30 sun is 22.7 deg up at azimuth 258.5 deg; the tallest building's shadow falls 313 m toward bearing 78 deg (ENE), as expected. Mean sunFraction and share of edges in full shade / full sun:

  | Slot | Mean sunFraction | Full shade (<0.05) | Full sun (>0.95) |
  |---|---|---|---|
  | 09:00 | 0.82 | 11% | 74% |
  | 12:00 | 0.94 | 3% | 89% |
  | 16:30 | 0.58 | 28% | 45% |

  Adding the BCC canopy moved 12:00 from mean 0.97 / 95% full sun to 0.94 / 89%. Midday is nearly all sun with building and tree shade alone: the sun is 80 deg up, so buildings cast almost no shadow. Awnings and verandahs are what should create midday shade.
- **Routing check (own Dijkstra on the real files, from the venue, alpha 5, destinations 150 to 500 m away, 602 nodes):** the shady route differs from the shortest for 465 (09:00), 341 (12:00) and 403 (16:30) destinations; 276, 295 and 369 of those add under 25% distance. Best pair per time: 09:00 saves 2.7 sun-min for +7% distance; 12:00 saves 1.6 sun-min for +2%; 16:30 saves 3.1 sun-min for +2%. This is not Eric's router, and some of the best nodes sit on the bbox edge, so pick named landmarks for the demo.
- **Size:** `web/public/data` is about 4.3 MB (shadow overlays about 3.6 MB), under the 5 MB phone budget.
- **Approximated:** the building height fallback (87% of buildings use the 6 m default, so real heights differ); tree canopy radius 4 m and height 8 m everywhere; BCC polygons turned into discs; walking speed 1.3 m/s; shadow polygons simplified to 0.5 m and clipped to bbox + 200 m; `sunFraction` rounded to 0.01.
- **Not modelled:** UV, reflected heat, tree seasonality, cloud, covered areas that are not yet detected from street photos, anything outside the 600 x 600 m bbox.
- **Still to do:** rerun D8 (awnings merge) on the real graph once `ai/out/awnings.json` lands, then update the awnings line here (edges covered, covered metres, sun-minutes on the demo pairs before and after).
