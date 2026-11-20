# Data QA + limits note (D9)

**First pass on PLACEHOLDER inputs. Needs rerun on real inputs.** `validate.py` on `web/public/data/`: all OK.
- **Graph, buildings, trees, shade are FIXTURES** (identical to `contracts/fixtures/`; Overpass unreachable). Graph: 10 nodes, 13 edges, 1,196 m ("ladder" of two streets).
- **Buildings:** 4 total: 2 `osm`, 1 `levels`, 1 `default` (6 m). Hand-made, not OSM-derived.
- **Trees:** 4, source `manual` (hand-placed); no BCC or OSM tree data used.
- **Awnings:** the 3 hand-labelled fixture entries (verandah 0.6, awning 0.8, covered walkway 0.7), all `verified: true`; 3 edges, 202 m covered of 1,196 m. `ai/out/awnings.json` does not exist (no Mapillary/vision output).
- **Shade:** `sun[]` is real (NOAA); `sunFraction` is hand-shaped to make routes differ, NOT derived from the fixture buildings/trees; the 3 awnings are already merged in. A `build.py --fixtures` run on this input gives near-all-sun (0.97 to 1.00 mean), so the geometry is untested at scale.
- **Merge check:** `data/check_awnings_merge.py` passes (verified only; `sunFraction *= 1 - covered_fraction`).
- **Approximated:** height fallback (OSM `height`, else levels x 3.2, else 6 m); tree canopy radius 4 m / height 8 m defaults; walking speed 1.3 m/s; shadow polygons simplified to 0.5 m and clipped to bbox + 200 m.
- **Not modelled:** UV, reflected heat, tree seasonality, covered areas not visible in street photos, anything outside the 600 x 600 m bbox.
