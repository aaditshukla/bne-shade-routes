# Shade Router: pitch (P2)

Numbers come from `ai/out/stats.json` (A6) and `data/QA.md` (D9 limits note), checked 21 Nov 2026.
Items marked **TODO** can only be filled once Data reruns the awnings merge (D8) or the production URL is confirmed.

## Slide 1: the hook

**It's 34° in Brisbane. The shortest walk is the worst walk.**

- At noon in late November the sun is **82° up**. Buildings cast almost no shadow (a 20 m tower throws about 3 m).
- The shade that's left is **awnings, verandahs and trees**, and height data can't see them.
- Shade Router finds them, and routes you through them.

## Slide 2: how it works

Four steps, all precomputed, so the phone does the routing and there is no server:

1. **Data**: OSM street graph, building heights and Brisbane City Council tree canopy for a 600 × 600 m patch around the venue.
2. **Shadows**: sun position every 15 minutes (06:00 to 18:30, 51 slots), shadows cast from buildings and trees, turned into a sun fraction per street segment.
3. **Vision + verifier**: Claude Haiku looks at Mapillary street photos for covered footpaths; Claude Sonnet re-checks every positive in a separate request.
4. **Routing**: in the browser, cost = length × (1 + α × sun fraction). Slide the time and the shade, and the route, move.

The vision numbers:

| | |
|---|---|
| Street photos checked | **460** (920 footpath sides) |
| First-pass positives (Haiku) | **173** (18.8%) |
| Verified by Sonnet | **92** |
| Rejected by the verifier | **81 (47%)** |
| Hand-checked precision (30 verified positives) | **27/30 = 90%** |
| Street segments with real cover found | **55** |
| Covered footpath | **1,174 m** (43 awning, 7 covered walkway, 5 verandah) |

**QR code:** `web/public/qr.png` → production URL. **TODO:** confirm the production URL and test the QR from two phones (P3).

## 90-second demo script

Phone in hand, deployed site, start is always the venue. Pairs are from `data/demo-pairs.md`; the chip names are placeholders until the preset chips are named, and the savings below are **before awnings**. **TODO:** replace with post-D8 numbers.

| Time | Say | Do |
|---|---|---|
| 0:00 | "Scan the QR and you're here. It's 09:00 and you want to get to Duncan and Wickham." | Open the site, pick chip 1. |
| 0:10 | "Grey is the shortest route, green is the shadiest. Almost the same walk (+5%), but 1.3 minutes in the sun instead of 3.0." | Point at the result card. |
| 0:30 | "Now it's noon. The sun is 82° up, buildings give almost nothing." | Drag the slider to 12:00. Shadows shrink. |
| 0:40 | "This is where the vision pass matters: awnings and verandahs that height data can't see." | Show an awning edge on the map. |
| 0:55 | "Different destination: Boundary and Dodge Lane. Watch the shady route change as I drag the slider." | Chip 2. Drag through 09:00 (Gotha St), 12:00 (Ann St), 16:30 (Gotha St). |
| 1:15 | "16:30, sun low from the west. Shadows are long, the route flips again." | Chip 4 (Barry Pde & Gipps St), slider at 16:30. |
| 1:25 | "460 photos, a second model verifying every find, 90% precision on our hand check. Scan the code and try it." | Show the QR. |

Backup if the network fails: the screen recording from VID.

## Judge Q&A crib

**Isn't this Cool Walks or inShade?**
They model shade from above: heights, terrain, canopy. In late November Brisbane's noon sun is 82° up, so building shadows almost vanish. The shade that's left is awnings, verandahs and trees, which height data can't see. Our vision pass finds it.

**How do you know the vision model is right?**
A second, separate verifier pass re-checks every positive and rejected **47%** (81 of 173). We hand-checked 30 verified positives: **90%** precision (27 of 30).

**How accurate are the building heights?**
OSM heights where tagged, levels × 3.2 m otherwise, 6 m as a last resort. Here **4%** are OSM-tagged, **10%** come from levels and **87%** use the 6 m default (of 368 buildings), so building shade is understated at 09:00 and 16:30. Near noon it barely matters, because awnings and trees carry the shade.

**What about trees?**
574 tree discs at a 4 m radius and 8 m height. Only 1 comes from OSM; the rest are Brisbane City Council protected-vegetation canopy filled with discs. They are canopy extents on Council and protected land, not surveyed trees, so trees on private land are missing. Credit: Brisbane City Council open data (CC-BY 4.0).

**How much sun does it save?**
Honestly, small: 0.2 to 2.3 sun-minutes on 3 to 7 minute walks (before awnings). It's "less sun for almost the same walk", not "avoid the sun". Midday is the weakest time. **TODO:** add the post-awnings figures from D8.

**Why precompute instead of calculating live?**
The sun's path is deterministic, so shade per 15-minute slot is computed once. Routing then runs on the phone in milliseconds, with no server to break.

**Does it scale beyond the Valley?**
The pipeline runs per bounding box: more Mapillary tiles and more vision calls, which batch well. Cost grows with street length, not with users. The demo covers 55 covered segments from 460 photos; a larger area needs more photos per street.

**Why Mapillary?**
Its street imagery is openly licensed and has a free API, which suits building a dataset from it.

**What about clouds or UV?**
Our stretch goal: a UV sunburn budget from the forecast UV index.

**Limits to volunteer:** awnings come from photos of varying age (2018 onwards), so some may have changed; coverage depends on where Mapillary photos exist; shadows are approximate (6 m default heights, tree discs).
